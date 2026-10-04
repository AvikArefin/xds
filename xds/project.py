"""Load, check, hash, save and watch a project directory.

The gate: every load, save, audit and export validates `project.json` with the Pydantic models
and then checks references between its parts (roles, assets, designs, objects, colors, paths).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from .models import (
    SCHEMA_VERSION,
    Finding,
    GroundNode,
    ImageNode,
    Project,
    RenderNode,
    TypeNode,
    now,
)

PROJECT_FILE = "project.json"
SOURCE_DIRS = ("designs", "screens", "assets", "fonts")
HASH_LENGTH = 16
RESOURCES = Path(__file__).parent / "resources"

# The gate's codes (design-rules §4.7). Always errors; an exception can't waive them.
STRUCTURAL_RULES = frozenset({
    "INVALID_JSON", "SCHEMA_INVALID", "MIGRATION_NEEDED", "PATH_ESCAPE", "PATH_LOCATION",
    "MISSING_FILE", "UNKNOWN_FORMAT", "UNKNOWN_FONT", "UNKNOWN_COLOR", "UNKNOWN_ROLE",
    "UNKNOWN_ASSET", "ASSET_KIND", "UNKNOWN_MATERIAL", "UNKNOWN_OBJECT", "UNKNOWN_DESIGN",
    "UNKNOWN_SCREEN", "NOT_A_MODEL", "UNKNOWN_RULE", "UNKNOWN_THRESHOLD", "NOT_WAIVABLE",
    "DESIGN_INVALID", "DESIGN_UNKNOWN_PARAM", "DESIGN_BAD_EXPRESSION", "DESIGN_VALUE_TYPE",
    "UNKNOWN_PART", "UNKNOWN_CLIP", "PART_OUT_OF_RANGE", "MODEL_INVALID",
    "SCREEN_ASPECT_MISMATCH",
})


class XdsError(Exception):
    """An error with a stable code. The API maps it to `{ ok: false, error }`."""

    def __init__(self, code: str, message: str, *, status: int = 400, path: str | None = None,
                 details: Any = None):
        super().__init__(message)
        self.code, self.message, self.status, self.path, self.details = (
            code, message, status, path, details)

    def to_json(self) -> dict[str, Any]:
        err: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.path is not None:
            err["path"] = self.path
        if self.details is not None:
            err["details"] = self.details
        return err


# --- paths -----------------------------------------------------------------------------------

def resolve_inside(root: Path, rel: str) -> Path:
    """Resolve a project-relative path, refusing anything that leaves the project."""
    if not rel or rel.startswith(("/", "\\")) or re.match(r"^[A-Za-z]:", rel) or ".." in Path(rel).parts:
        raise XdsError("PATH_ESCAPE", f"'{rel}' must be a project-relative path without '..'",
                       status=400, path=rel)
    root = root.resolve()
    target = (root / rel).resolve()
    if target != root and root not in target.parents:
        raise XdsError("PATH_ESCAPE", f"'{rel}' resolves outside the project", status=400, path=rel)
    return target


def resolve_asset(root: Path, rel: str) -> Path:
    """Resolve an asset path: `xds:` paths name a file in the xds library (see library.py),
    anything else is project-relative."""
    from . import library

    return library.resolve(rel) if library.is_library_path(rel) else resolve_inside(root, rel)


# --- hashing ---------------------------------------------------------------------------------

def source_files(root: Path) -> list[Path]:
    """The files the source hash covers: project.json, designs/, screens/, assets/, fonts/."""
    files = [root / PROJECT_FILE] if (root / PROJECT_FILE).exists() else []
    for d in SOURCE_DIRS:
        base = root / d
        if base.is_dir():
            files += [p for p in base.rglob("*") if p.is_file() and not p.name.startswith(".")]
    return sorted(files, key=lambda p: p.relative_to(root).as_posix())


def file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def source_hash(root: Path) -> str:
    """sha256 over `path:sha256` lines of every source file, sorted by path (dataflow §8)."""
    lines = [f"{p.relative_to(root).as_posix()}:{file_hash(p)}" for p in source_files(root)]
    return hashlib.sha256("\n".join(lines).encode()).hexdigest()[:HASH_LENGTH]


def project_file_hash(root: Path) -> str:
    """Hash of project.json alone; a save's `baseHash` is compared against this."""
    p = root / PROJECT_FILE
    return file_hash(p)[:HASH_LENGTH] if p.exists() else ""


# --- loading ---------------------------------------------------------------------------------

def _json_path(loc: tuple[Any, ...], raw: Any) -> str:
    """Turn a Pydantic error location into a JSON path over the raw document (camelCase)."""
    parts: list[str] = []
    for item in loc:
        if isinstance(item, int):
            parts.append(f"[{item}]")
        elif item in ("ground", "image", "type", "render", "frame", "free") and parts:
            continue  # discriminated-union tags, not keys
        else:
            parts.append(("." if parts else "") + str(item))
    return "".join(parts) or "$"


def schema_findings(err: ValidationError, raw: Any) -> list[Finding]:
    out = []
    for e in err.errors(include_url=False):
        path = _json_path(e["loc"], raw)
        out.append(Finding(rule="SCHEMA_INVALID", family="check", severity="error",
                           path=path, message=f"{path}: {e['msg']}",
                           fix="Correct the value to match the schema (docs/data-models.md)."))
    return out


@dataclass
class Loaded:
    root: Path
    raw: dict[str, Any] | None
    project: Project | None
    hash: str  # source hash (all source files)
    file_hash: str  # project.json only (the save guard)
    findings: list[Finding] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.project is not None and not any(f.severity == "error" for f in self.findings)

    def require(self) -> Project:
        """The validated project, or an XdsError listing the gate's findings."""
        if not self.ok or self.project is None:
            raise XdsError("CHECK_FAILED", f"{len(self.findings)} structural problem(s) in "
                           f"{self.root}", status=422,
                           details=[f.model_dump(mode="json", by_alias=True, exclude_none=True)
                                    for f in self.findings])
        return self.project


def find_root(path: str | Path) -> Path:
    root = Path(path).expanduser().resolve()
    if root.is_file() and root.name == PROJECT_FILE:
        root = root.parent
    if not (root / PROJECT_FILE).exists():
        raise XdsError("NOT_A_PROJECT", f"no {PROJECT_FILE} in {root}", status=404)
    return root


def read_raw(root: Path) -> dict[str, Any]:
    try:
        return json.loads((root / PROJECT_FILE).read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise XdsError("INVALID_JSON", f"project.json is not valid JSON: {e}", status=422) from e


def load(path: str | Path, *, deep: bool = True) -> Loaded:
    """Read and validate a project. Never raises for content problems: they become findings.

    `deep` also runs the checks that open other files (designs, GLB models, screens).
    """
    root = find_root(path)
    shash, fhash = source_hash(root), project_file_hash(root)
    try:
        raw = read_raw(root)
    except XdsError as e:
        return Loaded(root, None, None, shash, fhash, [Finding(
            rule="INVALID_JSON", family="check", severity="error", message=e.message)])

    version = raw.get("schemaVersion") if isinstance(raw, dict) else None
    if version != SCHEMA_VERSION:
        return Loaded(root, raw, None, shash, fhash, [Finding(
            rule="MIGRATION_NEEDED", family="check", severity="error", path="schemaVersion",
            message=f"schemaVersion is {version!r}; this XDS reads {SCHEMA_VERSION}.",
            fix=f"Run `xds migrate {root}`.")])
    try:
        project = Project.model_validate(raw)
    except ValidationError as e:
        return Loaded(root, raw, None, shash, fhash, schema_findings(e, raw))

    return Loaded(root, raw, project, shash, fhash, check_references(root, project, deep=deep))


# --- reference checks ------------------------------------------------------------------------

def _f(rule: str, path: str, message: str, fix: str = "", nodes: list[str] | None = None,
       slide_id: str | None = None) -> Finding:
    return Finding(rule=rule, family="check", severity="error", path=path, message=message,
                   fix=fix, nodes=nodes or [], slide_id=slide_id)


def check_references(root: Path, p: Project, *, deep: bool = True) -> list[Finding]:
    """Every cross-reference and file in the project. Structural: always errors, never waivable."""
    from . import formats

    out: list[Finding] = []
    colors = {c.name for c in p.brand.colors}
    families = {f.family for f in p.fonts}
    assets = {a.id: a for a in p.assets}
    objects = {o.id: o for o in p.objects}
    materials = {m.id for m in p.materials}
    screens = {s.id: s for s in p.screens}

    def color(token: str | None, path: str, **kw: Any) -> None:
        if token is not None and token not in colors:
            out.append(_f("UNKNOWN_COLOR", path, f"'{token}' is not a brand color.",
                          f"Use one of: {', '.join(sorted(colors))}.", **kw))

    def file(rel: str, path: str, under: str | None = None) -> Path | None:
        library = under in ("assets", "fonts") and rel.startswith("xds:")
        try:
            target = resolve_asset(root, rel) if library else resolve_inside(root, rel)
        except XdsError as e:
            out.append(_f("PATH_ESCAPE", path, e.message))
            return None
        if under and not library and not rel.replace("\\", "/").startswith(under + "/"):
            out.append(_f("PATH_LOCATION", path, f"'{rel}' must be under {under}/."))
        if not target.exists():
            out.append(_f("MISSING_FILE", path, f"'{rel}' does not exist."
                          + ((" Run `xds fonts fetch` to download it into the font library."
                              if under == "fonts" else
                              " Run `xds model library` for the models xds ships.") if library else "")))
            return None
        return target

    if p.format.preset and p.format.preset not in formats.CATALOG:
        out.append(_f("UNKNOWN_FORMAT", "format.preset", f"'{p.format.preset}' is not a format preset.",
                      f"Use one of: {', '.join(formats.CATALOG)} (or omit it for a custom size)."))

    for name, role in p.brand.typography.items():
        if role.font not in families:
            out.append(_f("UNKNOWN_FONT", f"brand.typography.{name}.font",
                          f"Role '{name}' uses font '{role.font}', which has no file in `fonts`.",
                          "Register the font (`xds fonts fetch`) or pick a registered family."))
        color(role.color, f"brand.typography.{name}.color")

    for i, f in enumerate(p.fonts):
        file(f.path, f"fonts[{i}].path", "fonts")
    for i, a in enumerate(p.assets):
        target = file(a.path, f"assets[{i}].path", "assets")
        if target and a.kind == "model" and target.suffix.lower() != ".glb":
            out.append(_f("ASSET_KIND", f"assets[{i}].path",
                          f"Model asset '{a.id}' must be a .glb file.",
                          "Import it with `xds model add`, which converts .gltf and .dae."))
    for i, s in enumerate(p.screens):
        file(s.path, f"screens[{i}].path", "screens")
    if p.lighting:
        color(p.lighting.tint, "lighting.tint")

    for i, o in enumerate(p.objects):
        if o.asset is not None:
            a = assets.get(o.asset)
            if a is None:
                out.append(_f("UNKNOWN_ASSET", f"objects[{i}].asset", f"No asset '{o.asset}'."))
            elif a.kind != "model":
                out.append(_f("ASSET_KIND", f"objects[{i}].asset",
                              f"Object '{o.id}' needs a model asset; '{a.id}' is {a.kind}."))
        if o.material is not None and o.material not in materials:
            out.append(_f("UNKNOWN_MATERIAL", f"objects[{i}].material", f"No material '{o.material}'."))

    designs_used: dict[str, list[tuple[str, GroundNode, str]]] = {}
    from .audit import registry  # rule names, for exceptions and rules overrides

    known_rules = registry.rule_names()
    structural = STRUCTURAL_RULES

    def exceptions(excs: list[Any] | None, path: str, **kw: Any) -> None:
        for j, e in enumerate(excs or []):
            if e.rule in structural:
                out.append(_f("NOT_WAIVABLE", f"{path}[{j}].rule",
                              f"'{e.rule}' is structural and can't be waived.", **kw))
            elif known_rules and e.rule not in known_rules:
                out.append(_f("UNKNOWN_RULE", f"{path}[{j}].rule", f"No audit rule '{e.rule}'.",
                              "See `xds rules` for the names.", **kw))

    if p.rules:
        for key in p.rules.off:
            if known_rules and key not in known_rules:
                out.append(_f("UNKNOWN_RULE", "rules.off", f"No audit rule '{key}'."))
        known_keys = registry.threshold_keys()
        for key in p.rules.set:
            if known_keys and key not in known_keys:
                out.append(_f("UNKNOWN_THRESHOLD", f"rules.set.{key}", f"No threshold '{key}'.",
                              "See `xds rules --json` for the names."))

    for si, slide in enumerate(p.slides):
        sp = f"slides[{si}]"
        color(slide.background, f"{sp}.background", slide_id=slide.id)
        if slide.lighting:
            color(slide.lighting.tint, f"{sp}.lighting.tint", slide_id=slide.id)
        exceptions(slide.exceptions, f"{sp}.exceptions", slide_id=slide.id)
        for ni, node in enumerate(slide.nodes):
            np_ = f"{sp}.nodes[{ni}]"
            kw = {"nodes": [node.id], "slide_id": slide.id}
            exceptions(node.exceptions, f"{np_}.exceptions", **kw)
            if isinstance(node, TypeNode):
                if node.data.role not in p.brand.typography:
                    out.append(_f("UNKNOWN_ROLE", f"{np_}.data.role",
                                  f"'{node.data.role}' is not a type role.",
                                  "Declare it under brand.typography (with a level).", **kw))
                color(node.data.color, f"{np_}.data.color", **kw)
            elif isinstance(node, ImageNode):
                a = assets.get(node.data.asset)
                if a is None or a.kind not in ("image", "svg"):
                    out.append(_f("UNKNOWN_ASSET", f"{np_}.data.asset",
                                  f"'{node.data.asset}' is not an image or svg asset.", **kw))
            elif isinstance(node, GroundNode):
                designs_used.setdefault(node.data.design, []).append((np_, node, slide.id))
                if not (root / "designs" / f"{node.data.design}.svg").exists():
                    out.append(_f("UNKNOWN_DESIGN", f"{np_}.data.design",
                                  f"No design 'designs/{node.data.design}.svg'.",
                                  "Add one with `xds design add`.", **kw))
            elif isinstance(node, RenderNode):
                o = objects.get(node.data.object)
                if o is None:
                    out.append(_f("UNKNOWN_OBJECT", f"{np_}.data.object",
                                  f"No scene object '{node.data.object}'.", **kw))
                for mesh, sid in (node.data.screens or {}).items():
                    if sid not in screens:
                        out.append(_f("UNKNOWN_SCREEN", f"{np_}.data.screens.{mesh}",
                                      f"No screen '{sid}'.", "Add one with `xds screen add`.", **kw))
                if (node.data.parts or node.data.animation or node.data.screens) and o and o.kind != "model":
                    out.append(_f("NOT_A_MODEL", f"{np_}.data",
                                  "parts, animation and screens need a model object.", **kw))

    if deep:
        from . import designs, models3d

        out += designs.check(root, p, designs_used)
        out += models3d.check_project(root, p)
    return out


# --- saving ----------------------------------------------------------------------------------

def dumps(doc: dict[str, Any]) -> str:
    return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"


def write_atomic(path: Path, text: str) -> None:
    tmp = path.with_name(path.name + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def save(path: str | Path, doc: dict[str, Any], base_hash: str | None) -> dict[str, str]:
    """Validate, guard against outside changes, stamp `updatedAt`, and replace project.json.

    Returns `{ hash, fileHash }`. Raises `XdsError` 422 (invalid) or 409 (`SAVE_CONFLICT`).
    """
    root = find_root(path)
    try:
        project = Project.model_validate(doc)
    except ValidationError as e:
        raise XdsError("VALIDATION_FAILED", "the project does not match the schema", status=422,
                       details=[f.model_dump(mode="json", by_alias=True, exclude_none=True)
                                for f in schema_findings(e, doc)]) from e
    current = project_file_hash(root)
    if base_hash is not None and base_hash != current:
        raise XdsError("SAVE_CONFLICT", "project.json changed on disk since it was loaded",
                       status=409, details={"hash": current})
    project.updated_at = now()
    write_atomic(root / PROJECT_FILE, dumps(project.to_json()))
    return {"hash": source_hash(root), "fileHash": project_file_hash(root)}


def write_project(root: Path, project: Project) -> None:
    """Write a project from Python code (CLI commands that register things)."""
    project.updated_at = now()
    write_atomic(root / PROJECT_FILE, dumps(project.to_json()))


# --- scaffolding -----------------------------------------------------------------------------

def init(path: str | Path, *, name: str | None = None, preset: str = "instagram-portrait") -> Path:
    """Copy the content-neutral template and fill in the id, name and format."""
    from . import formats

    root = Path(path).expanduser().resolve()
    if (root / PROJECT_FILE).exists():
        raise XdsError("PROJECT_EXISTS", f"{root} already has a project.json", status=409)
    if preset not in formats.CATALOG:
        raise XdsError("UNKNOWN_FORMAT", f"'{preset}' is not a format preset", status=422)
    root.mkdir(parents=True, exist_ok=True)
    template = RESOURCES / "template"
    for src in template.rglob("*"):
        rel = src.relative_to(template)
        dst = root / rel
        if src.is_dir():
            dst.mkdir(parents=True, exist_ok=True)
        elif not dst.exists():
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
    for d in ("designs", "screens", "assets", "fonts", "sources"):
        (root / d).mkdir(exist_ok=True)

    doc = json.loads((template / PROJECT_FILE).read_text())
    slug = re.sub(r"[^a-z0-9]+", "-", (name or root.name).lower()).strip("-") or "project"
    prof = formats.CATALOG[preset]
    doc.update(id=slug, name=name or root.name,
               format={"preset": preset, "width": prof.width, "height": prof.height})
    stamp = now()
    project = Project.model_validate(doc)
    project.created_at = project.updated_at = stamp
    write_atomic(root / PROJECT_FILE, dumps(project.to_json()))
    return root


# --- watching --------------------------------------------------------------------------------

def is_source_path(root: Path, path: Path) -> bool:
    try:
        rel = path.resolve().relative_to(root.resolve())
    except ValueError:
        return False
    if not rel.parts or rel.name.endswith(".tmp"):
        return False
    return rel.as_posix() == PROJECT_FILE or rel.parts[0] in SOURCE_DIRS


async def watch(root: Path, stop: Any = None) -> AsyncIterator[str]:
    """Yield the new source hash whenever a source file changes on disk."""
    from watchfiles import awatch

    last = source_hash(root)
    async for changes in awatch(root, stop_event=stop, debounce=150, recursive=True):
        if not any(is_source_path(root, Path(p)) for _, p in changes):
            continue
        h = source_hash(root)
        if h != last:
            last = h
            yield h
