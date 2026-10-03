"""The conform pass: bring a raw `project.json` document in line with the current models.

It walks the document alongside the Pydantic models (`models.Project`) and:

- **renames** a key when it is one of the field's `validation_alias=AliasChoices(...)` choices,
  or the field's Python (snake_case) name, to the field's JSON alias (camelCase);
- **fills** a missing field that has a declared `default` / `default_factory` (skipping defaults
  of `None`, which the canonical file leaves out anyway);
- **drops** keys no field claims, recording each one with its value;
- then validates the result; anything still wrong (a missing required field without a default,
  a value of the wrong type) is **unresolved** with its JSON path.

Discriminated unions (nodes by `layer`, cameras by `mode`) are followed by their tag; a missing
tag is filled when exactly one member declares a default for it (e.g. `mode: "frame"`).
Lists, dicts, `Optional` and nested models are walked recursively; scalars are left to the final
validation.
"""

from __future__ import annotations

import types
import typing
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal, Union

from pydantic import AliasChoices, AliasPath, BaseModel, ValidationError
from pydantic.fields import FieldInfo
from pydantic_core import PydanticUndefined

from ..models import Project


@dataclass
class Report:
    renamed: list[dict[str, str]] = field(default_factory=list)  # {from, to} JSON paths
    defaulted: list[dict[str, Any]] = field(default_factory=list)  # {path, value}
    dropped: list[dict[str, Any]] = field(default_factory=list)  # {path, value}
    unresolved: list[dict[str, str]] = field(default_factory=list)  # {rule, path, message}
    steps: list[str] = field(default_factory=list)  # explicit steps applied
    notes: list[str] = field(default_factory=list)  # free text from steps

    def unresolve(self, path: str, message: str) -> None:
        self.unresolved.append({"rule": "MIGRATION_UNRESOLVED", "path": path, "message": message})

    def to_json(self) -> dict[str, Any]:
        return {"steps": self.steps, "renamed": self.renamed, "defaulted": self.defaulted,
                "dropped": self.dropped, "unresolved": self.unresolved, "notes": self.notes}


def _join(path: str, key: str | int) -> str:
    if isinstance(key, int):
        return f"{path}[{key}]"
    return f"{path}.{key}" if path else key


# --- type helpers ----------------------------------------------------------------------------

def _unwrap(tp: Any) -> tuple[Any, str | None]:
    """Strip Annotated layers, returning (type, discriminator from Field metadata if any)."""
    disc = None
    while typing.get_origin(tp) is typing.Annotated:
        args = typing.get_args(tp)
        for meta in args[1:]:
            if isinstance(meta, FieldInfo) and isinstance(meta.discriminator, str):
                disc = meta.discriminator
        tp = args[0]
    return tp, disc


def _is_model(tp: Any) -> bool:
    return isinstance(tp, type) and issubclass(tp, BaseModel)


def _union_args(tp: Any) -> list[Any] | None:
    if typing.get_origin(tp) in (Union, types.UnionType):
        return list(typing.get_args(tp))
    return None


def _tag_values(model: type[BaseModel], tag: str) -> list[Any]:
    f = model.model_fields.get(tag)
    if f is None:
        return []
    tp, _ = _unwrap(f.annotation)
    return list(typing.get_args(tp)) if typing.get_origin(tp) is Literal else []


def _alias(name: str, f: FieldInfo) -> str:
    return f.alias or name


def _old_names(name: str, f: FieldInfo) -> list[str]:
    """Keys that may hold this field in an old file: alias choices, then the Python name."""
    out: list[str] = []
    va = f.validation_alias
    if isinstance(va, AliasChoices):
        out += [c for c in va.choices if isinstance(c, str)]
    elif isinstance(va, str):
        out.append(va)
    elif isinstance(va, AliasPath) and len(va.path) == 1 and isinstance(va.path[0], str):
        out.append(va.path[0])
    out.append(name)
    alias = _alias(name, f)
    return [k for k in dict.fromkeys(out) if k != alias]


def _default(f: FieldInfo) -> Any:
    if f.default_factory is not None:
        return f.default_factory()  # type: ignore[call-arg]
    return f.default


# --- the walk --------------------------------------------------------------------------------

def conform_value(value: Any, tp: Any, path: str, report: Report) -> Any:
    tp, disc = _unwrap(tp)
    if value is None:
        return None
    members = _union_args(tp)
    if members is not None:
        non_none = [m for m in members if m is not type(None)]
        models = [_unwrap(m)[0] for m in non_none if _is_model(_unwrap(m)[0])]
        if disc and isinstance(value, dict):
            return _conform_tagged(value, models, disc, path, report)
        if len(non_none) == 1:
            return conform_value(value, non_none[0], path, report)
        if len(models) == 1 and isinstance(value, dict):
            return conform_value(value, models[0], path, report)
        return value  # a union of scalars: final validation decides
    if _is_model(tp):
        return conform_model(value, tp, path, report) if isinstance(value, dict) else value
    origin = typing.get_origin(tp)
    if origin is list and isinstance(value, list):
        (item,) = typing.get_args(tp) or (Any,)
        return [conform_value(v, item, _join(path, i), report) for i, v in enumerate(value)]
    if origin is dict and isinstance(value, dict):
        _, item = typing.get_args(tp) or (Any, Any)
        return {k: conform_value(v, item, _join(path, k), report) for k, v in value.items()}
    return value


def _conform_tagged(value: dict[str, Any], models: list[type[BaseModel]], tag: str, path: str,
                    report: Report) -> Any:
    by_tag = {v: m for m in models for v in _tag_values(m, tag)}
    tag_alias = next((_alias(tag, m.model_fields[tag]) for m in models if tag in m.model_fields), tag)
    if tag_alias not in value:
        defaults = [m for m in models if m.model_fields[tag].default is not PydanticUndefined]
        if len(defaults) == 1:
            value = {**value, tag_alias: defaults[0].model_fields[tag].default}
            report.defaulted.append({"path": _join(path, tag_alias), "value": value[tag_alias]})
    model = by_tag.get(value.get(tag_alias))
    if model is None:
        return value  # unknown or missing tag: final validation reports it
    return conform_model(value, model, path, report)


def conform_model(value: dict[str, Any], model: type[BaseModel], path: str,
                  report: Report) -> dict[str, Any]:
    out: dict[str, Any] = {}
    claimed: set[str] = set()
    for name, f in model.model_fields.items():
        alias = _alias(name, f)
        key = alias if alias in value else next((k for k in _old_names(name, f) if k in value), None)
        if key is None:
            default = _default(f) if not f.is_required() else PydanticUndefined
            if default is not PydanticUndefined and default is not None:
                dumped = _dump(default)
                out[alias] = dumped
                report.defaulted.append({"path": _join(path, alias), "value": dumped})
            continue
        claimed.add(key)
        if key != alias:
            report.renamed.append({"from": _join(path, key), "to": _join(path, alias)})
        out[alias] = conform_value(value[key], f.annotation, _join(path, alias), report)
    for key, v in value.items():
        if key not in claimed:
            report.dropped.append({"path": _join(path, key), "value": v})
    return out


def _dump(v: Any) -> Any:
    if isinstance(v, BaseModel):
        return v.model_dump(mode="json", by_alias=True, exclude_none=True)
    if isinstance(v, (list, tuple)):
        return [_dump(x) for x in v]
    if isinstance(v, dict):
        return {k: _dump(x) for k, x in v.items()}
    if isinstance(v, datetime):
        return v.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return v


def conform(doc: dict[str, Any], report: Report) -> dict[str, Any] | None:
    """Conform a document to `Project`. Returns the canonical JSON, or None if unresolved."""
    from ..project import _json_path

    conformed = conform_model(doc, Project, "", report)
    try:
        project = Project.model_validate(conformed)
    except ValidationError as e:
        for err in e.errors(include_url=False):
            p = _json_path(err["loc"], conformed)
            report.unresolve(p, f"{p}: {err['msg']}")
        return None
    return project.to_json()
