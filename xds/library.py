"""The xds library: device models and brand logos that ship with xds, and the shared font library
(fonts.py).

Projects reference a library model by an asset path starting with `xds:` (for example
`xds:models/iphone-17-pro/model.glb`) instead of copying the file. `resolve` maps that path into
`xds/library/`; `project.resolve_asset` sends `xds:` paths here and everything else into the
project. `xds model vendor` copies a library model into a project that has to travel without xds.

Each model is a folder `xds/library/models/<id>/` with `model.glb` (normalized to the model
conventions by `scripts/build_library_models.py`) and `model.json`:

    { "name": "...", "description": "...",
      "screens": { "<mesh>": { "device": "<screens.DEVICES key>" } },
      "parts": { "<node>": "what it is / how it moves" } }

Each brand is a folder `xds/library/brands/<id>/` with its logo SVGs and `brand.json`:

    { "name": "...", "description": "...", "colors": { "<name>": "#rrggbb" },
      "logos": { "<file>.svg": "which background it is for, when to use it" } }

A logo's id is `<brand>/<file stem>` (`cortextech/full-logomark`); `add_logo` registers it as an
`svg` asset by reference (`xds:brands/<brand>/<file>`). Files in the folder that `logos` doesn't
list (PNG copies for tools outside xds) are not offered to projects.
"""

from __future__ import annotations

import json
import re
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


# --- brand logos ---------------------------------------------------------------------------

def _svg_size(file: Path) -> tuple[float, float] | None:
    head = file.read_text(encoding="utf-8", errors="replace")[:2000]
    box = re.search(r'viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)', head)
    return (float(box[1]), float(box[2])) if box else None


def brands() -> list[dict[str, Any]]:
    """Every library brand: its brand.json, with each logo's id, asset path and size."""
    base = DIR / "brands"
    out = []
    for d in sorted(base.iterdir()) if base.is_dir() else []:
        meta_file = d / "brand.json"
        if not (d.is_dir() and meta_file.is_file()):
            continue
        meta = json.loads(meta_file.read_text(encoding="utf-8"))
        logos = []
        for file, description in meta.get("logos", {}).items():
            f = d / file
            if not f.is_file():
                continue
            size = _svg_size(f) if f.suffix == ".svg" else None
            logos.append({"id": f"{d.name}/{f.stem}", "brand": d.name, "file": file,
                          "path": f"{PREFIX}brands/{d.name}/{file}", "description": description,
                          "width": size[0] if size else None, "height": size[1] if size else None})
        out.append({"id": d.name, "name": meta.get("name", d.name),
                    "description": meta.get("description", ""), "colors": meta.get("colors", {}),
                    "logos": logos})
    return out


def logos() -> list[dict[str, Any]]:
    return [logo for b in brands() for logo in b["logos"]]


def logo(logo_id: str) -> dict[str, Any]:
    for item in logos():
        if logo_id in (item["id"], item["path"]):
            return item
    raise XdsError("UNKNOWN_LIBRARY_LOGO", f"No library logo '{logo_id}'. Run `xds logo library`.",
                   status=404, details={"logos": [item["id"] for item in logos()]})


def add_logo(root: Path, logo_id: str, *, id: str | None = None) -> dict[str, Any]:
    """`xds logo add`: register a library logo as an `svg` asset by reference (nothing is copied).
    Adding the same logo again returns the asset it already has."""
    from .models import Asset, Project
    from .project import read_raw, write_project

    meta = logo(logo_id)
    root = Path(root).resolve()
    project = Project.model_validate(read_raw(root))
    same = next((a for a in project.assets if a.path == meta["path"]), None)
    if same and (id is None or id == same.id):
        return {"id": same.id, "path": same.path, "added": False, "logo": meta}
    id = id or re.sub(r"[^a-z0-9-]+", "-", meta["id"].replace("/", "-").lower()).strip("-")
    if project.asset(id):
        raise XdsError("ASSET_EXISTS", f"An asset '{id}' already exists; pass another --id.",
                       status=409)
    project.assets.append(Asset(id=id, path=meta["path"], kind="svg"))
    write_project(root, project)
    return {"id": id, "path": meta["path"], "added": True, "logo": meta}
