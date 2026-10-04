"""The built-in model library: device models that ship with xds and stay with it.

Projects reference a library model by an asset path starting with `xds:` (for example
`xds:models/iphone-17-pro/model.glb`) instead of copying the file. `resolve` maps that path into
`xds/library/`; `project.resolve_asset` sends `xds:` paths here and everything else into the
project. `xds model vendor` copies a library model into a project that has to travel without xds.

Each model is a folder `xds/library/models/<id>/` with `model.glb` (normalized to the model
conventions by `scripts/build_library_models.py`) and `model.json`:

    { "name": "...", "description": "...",
      "screens": { "<mesh>": { "device": "<screens.DEVICES key>" } },
      "parts": { "<node>": "what it is / how it moves" } }
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .project import XdsError

DIR = Path(__file__).parent / "library"
PREFIX = "xds:"


def is_library_path(rel: str) -> bool:
    return rel.startswith(PREFIX)


def model_path(model_id: str) -> str:
    """The asset path a project stores for a library model."""
    return f"{PREFIX}models/{model_id}/model.glb"


def resolve(rel: str) -> Path:
    """Resolve an `xds:` path inside the library, refusing anything that leaves it."""
    inner = rel[len(PREFIX):]
    if not inner or inner.startswith(("/", "\\")) or ".." in Path(inner).parts:
        raise XdsError("PATH_ESCAPE", f"'{rel}' must name a file inside the xds library",
                       status=400, path=rel)
    base = DIR.resolve()
    target = (base / inner).resolve()
    if base not in target.parents:
        raise XdsError("PATH_ESCAPE", f"'{rel}' resolves outside the xds library", status=400,
                       path=rel)
    return target


def models() -> list[dict[str, Any]]:
    """Every library model: id, asset path, and its model.json."""
    out = []
    for d in sorted((DIR / "models").iterdir()):
        meta_file, glb = d / "model.json", d / "model.glb"
        if d.is_dir() and meta_file.is_file() and glb.is_file():
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
            out.append({"id": d.name, "path": model_path(d.name), "bytes": glb.stat().st_size, **meta})
    return out


def model(model_id: str) -> dict[str, Any]:
    for m in models():
        if m["id"] == model_id:
            return m
    raise XdsError("UNKNOWN_LIBRARY_MODEL", f"No library model '{model_id}'.", status=404,
                   details={"models": [m["id"] for m in models()]})
