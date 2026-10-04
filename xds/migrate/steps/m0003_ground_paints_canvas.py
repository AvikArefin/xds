"""v2 → v3: the slide's page color is gone; the ground layer paints the whole canvas.

v2 had two answers to "what is behind everything": `Slide.background` (a flat color token) and
the ground layer (designs, usually full-canvas). They disagreed silently: a full-canvas design
hid the page color, which still showed in the editor as the slide's "Background".

For each slide: if a visible, unrotated, opaque ground node already covers the whole canvas, the
page color was never visible and is dropped. Otherwise a `solid` ground node in that color goes
at the very back, so the slide looks exactly as before. The `solid` design is copied into
`designs/` when a slide needs it (the runner writes `report.files`); `doc["__designs"]` (design
id → SVG text) lets the step reuse a compatible existing one.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

STARTER = Path(__file__).parents[2] / "resources" / "designs" / "solid.svg"
_META = re.compile(r'<metadata id="xds-design">(.*?)</metadata>', re.S)
EPS = 1e-6


def covers_canvas(node: dict[str, Any]) -> bool:
    """A ground node that paints every pixel of the canvas (as far as its box can tell)."""
    if node.get("layer") != "ground" or node.get("hidden"):
        return False
    b = node.get("box") or {}
    try:
        x, y, w, h = float(b["x"]), float(b["y"]), float(b["w"]), float(b["h"])
    except (KeyError, TypeError, ValueError):
        return False
    return (x <= EPS and y <= EPS and x + w >= 100 - EPS and y + h >= 100 - EPS
            and float(b.get("rotation", 0)) % 360 == 0 and float(b.get("opacity", 1)) >= 1)


def _solid_id(designs: dict[str, str]) -> tuple[str, bool]:
    """The design id to use for a solid fill, and whether it must be written."""
    for design_id, text in designs.items():
        if design_id == "solid" or design_id.startswith("solid-"):
            m = _META.search(text)
            try:
                params = {p.get("name"): p.get("type") for p in json.loads(m.group(1))["params"]} if m else {}
            except (ValueError, KeyError, TypeError):
                params = {}
            if params == {"color": "color"}:
                return design_id, False
    design_id, k = "solid", 2
    while design_id in designs:
        design_id, k = f"solid-{k}", k + 1
    return design_id, True


def upgrade(doc: dict[str, Any], report: Any) -> dict[str, Any]:
    designs = dict(doc.pop("__designs", None) or {})
    files = getattr(report, "files", None)
    if files is None:
        report.files = files = {}
    for rel, text in files.items():  # an earlier step may have rewritten designs
        if rel.startswith("designs/") and rel.endswith(".svg"):
            designs[Path(rel).stem] = text

    slides = doc.get("slides") or []
    taken = {n.get("id") for s in slides for n in s.get("nodes") or []}
    solid, write = None, False
    added = dropped = 0
    for s in slides:
        color = s.pop("background", None)
        nodes = s.setdefault("nodes", [])
        if any(covers_canvas(n) for n in nodes):
            dropped += color is not None
            continue
        if solid is None:
            solid, write = _solid_id(designs)
        node_id, k = f"{s.get('id', 'slide')}-background", 2
        while node_id in taken:
            node_id, k = f"{s.get('id', 'slide')}-background-{k}", k + 1
        taken.add(node_id)
        node: dict[str, Any] = {"id": node_id, "name": "Background", "layer": "ground",
                                "box": {"x": 0, "y": 0, "w": 100, "h": 100},
                                "data": {"design": solid}}
        if color:
            node["data"]["values"] = {"color": color}
        nodes.insert(0, node)  # first in the array = the back of the ground layer
        added += 1
    if write and solid:
        files[f"designs/{solid}.svg"] = STARTER.read_text(encoding="utf-8")
    if added:
        report.notes.append(f"{added} slide(s) got a full-canvas '{solid}' background in their old "
                            "page color (the ground layer now paints the canvas)")
    if dropped:
        report.notes.append(f"{dropped} slide(s) dropped a page color that a full-canvas "
                            "background already hid")
    return doc
