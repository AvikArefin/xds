"""`xds reflow`: retarget a project to another format without wrecking the layout.

Boxes are percent of the canvas, so a bare format change stretches a portrait layout sideways and
leaves every px type size out of its new band. Reflow re-projects each 2D box **relative to the
content area** (the canvas inside the margins, which the new format derives afresh), keeps images
and shapes at their aspect ratio, and rescales explicit px type sizes by the ratio of the new
level band default to the old. What is already format-relative is left alone: `scale` factors,
stack gaps (in u), pins (the layout engine re-resolves them), `place` and the camera, rotation.

`reflow(doc, target)` is pure: it returns the new document and a report of what moved. The CLI
writes it through the validated save path (a format change is a big save, so the snapshot is
taken first); the API returns it for the editor to commit as one undoable edit.
"""

from __future__ import annotations

import copy
from typing import Any

from . import formats
from .models import Format, Project


def _content(fmt: Format, overrides: dict[str, Any] | None) -> tuple[formats.Guide, dict[str, float]]:
    g = formats.derive(fmt, overrides)
    c = g.content
    return g, {"x0": c["x0"], "y0": c["y0"], "w": c["x1"] - c["x0"], "h": c["y1"] - c["y0"]}


def _r(v: float) -> float:
    return round(v, 3)


def _full_canvas(box: dict[str, Any]) -> bool:
    e = 1e-6
    return (box["x"] <= e and box["y"] <= e and box["x"] + box["w"] >= 100 - e
            and box["y"] + box["h"] >= 100 - e)


def _reproject(box: dict[str, Any], src: dict[str, float], dst: dict[str, float],
               sw: int, sh: int, dw: int, dh: int, keep_aspect: bool) -> dict[str, Any]:
    """A percent box of the source canvas → a percent box of the target canvas, with the same
    place and size relative to the content area."""
    # percent → px of the source canvas
    x, y, w, h = box["x"] * sw / 100, box["y"] * sh / 100, box["w"] * sw / 100, box["h"] * sh / 100
    # relative to the source content area, then onto the target's
    fx, fy = (x - src["x0"]) / src["w"], (y - src["y0"]) / src["h"]
    rw, rh = dst["w"] / src["w"], dst["h"] / src["h"]
    nx, ny, nw, nh = dst["x0"] + fx * dst["w"], dst["y0"] + fy * dst["h"], w * rw, h * rh
    if keep_aspect and w > 0 and h > 0:
        # contain the original aspect in the reprojected box, centered
        aspect = w / h
        cw, ch = (nw, nw / aspect) if nw / nh <= aspect else (nh * aspect, nh)
        nx, ny, nw, nh = nx + (nw - cw) / 2, ny + (nh - ch) / 2, cw, ch
    out = dict(box)
    out.update({"x": _r(nx / dw * 100), "y": _r(ny / dh * 100),
                "w": _r(max(0.01, nw / dw * 100)), "h": _r(max(0.01, nh / dh * 100))})
    return out


def reflow(doc: dict[str, Any], target: Format) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return `(new_doc, report)`; `doc` (the raw project JSON) is not modified."""
    source = Format.model_validate(doc["format"])
    overrides = (doc.get("rules") or {}).get("set") if isinstance(doc.get("rules"), dict) else None
    sg, src = _content(source, overrides)
    dg, dst = _content(target, overrides)
    sw, sh, dw, dh = source.width, source.height, target.width, target.height
    out = copy.deepcopy(doc)
    report: dict[str, Any] = {
        "from": source.model_dump(mode="json", exclude_none=True),
        "to": target.model_dump(mode="json", exclude_none=True),
        "boxes": [], "sizes": [], "roles": [],
    }

    def band_ratio(level: str | None) -> float:
        a = sg.bands.get(level or "body")
        b = dg.bands.get(level or "body")
        return (b.default / a.default) if a and b and a.default else 1.0

    typography = (out.get("brand") or {}).get("typography") or {}
    for name, role in typography.items():
        if isinstance(role, dict) and role.get("size"):
            new = max(1, round(role["size"] * band_ratio(role.get("level"))))
            if new != role["size"]:
                report["roles"].append({"role": name, "size": [role["size"], new]})
                role["size"] = new

    for slide in out.get("slides") or []:
        for node in slide.get("nodes") or []:
            layer = node.get("layer")
            box = node.get("box")
            if layer == "render" or not isinstance(box, dict):
                continue
            if layer == "ground" and _full_canvas(box):
                continue
            keep_aspect = layer == "image"
            new = _reproject(box, src, dst, sw, sh, dw, dh, keep_aspect)
            if any(new[k] != box[k] for k in ("x", "y", "w", "h")):
                report["boxes"].append({"slide": slide.get("id"), "node": node.get("id"),
                                        "box": [{k: box[k] for k in ("x", "y", "w", "h")},
                                                {k: new[k] for k in ("x", "y", "w", "h")}]})
                node["box"] = new
            data = node.get("data") or {}
            if layer == "type" and data.get("size"):
                role = typography.get(data.get("role")) if isinstance(typography, dict) else None
                level = role.get("level") if isinstance(role, dict) else None
                ns = max(1, round(data["size"] * band_ratio(level)))
                if ns != data["size"]:
                    report["sizes"].append({"slide": slide.get("id"), "node": node.get("id"),
                                            "size": [data["size"], ns]})
                    data["size"] = ns

    out["format"] = target.model_dump(mode="json", exclude_none=True)
    report["summary"] = {"boxes": len(report["boxes"]), "sizes": len(report["sizes"]),
                         "roles": len(report["roles"])}
    return out, report


def reflow_project(root: Any, target: Format, *, dry_run: bool = False) -> dict[str, Any]:
    """Reflow the project on disk through the validated save path (dry run: report only)."""
    from . import project as proj

    root = proj.find_root(root)
    doc = proj.read_raw(root)
    Project.model_validate(doc)  # a broken file can't be reflowed meaningfully
    new, report = reflow(doc, target)
    result: dict[str, Any] = {"root": str(root), "dryRun": dry_run, "written": False, **report}
    if not dry_run:
        saved = proj.save(root, new, None)
        result.update({"written": True, **saved})
    return result


def report_text(r: dict[str, Any]) -> str:
    f, t = r["from"], r["to"]
    lines = [f"{f.get('preset') or 'custom'} {f['width']}×{f['height']} → "
             f"{t.get('preset') or 'custom'} {t['width']}×{t['height']}"
             + (" (dry run)" if r.get("dryRun") else "" if r.get("written") else "")]
    for x in r["roles"]:
        lines.append(f"  role {x['role']:<14} size {x['size'][0]} → {x['size'][1]} px")
    for x in r["sizes"]:
        lines.append(f"  {x['slide']}/{x['node']:<20} size {x['size'][0]} → {x['size'][1]} px")
    for x in r["boxes"]:
        a, b = x["box"]
        lines.append(f"  {x['slide']}/{x['node']:<20} box {a['x']:.1f},{a['y']:.1f} {a['w']:.1f}×{a['h']:.1f}"
                     f" → {b['x']:.1f},{b['y']:.1f} {b['w']:.1f}×{b['h']:.1f}")
    s = r["summary"]
    lines.append(f"{s['boxes']} boxes, {s['sizes']} node sizes, {s['roles']} role sizes changed"
                 + ("; written, run the audit" if r.get("written") else ""))
    return "\n".join(lines)
