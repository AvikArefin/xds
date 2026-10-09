"""`xds measure`: where the text lands, without rendering the slide.

Headless Chromium lays out only the type layer (no 3D, no backgrounds, no images), so this takes
about a second for a whole deck instead of a full render. For every text block it reports the
real line breaks, the ink extent, the height the box must have, stacked positions (`data.stack`)
and the contrast minimum for its size; then it runs the audit rules that need nothing but text
geometry (sizes, lines, widows, overlaps, clipping, margins, text-to-text spacing). Contrast, the
product, images and composition need `xds audit`.
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any, Callable

from . import project as proj
from .audit import registry
from .audit.engine import audit_slide
from .audit.measured import MeasuredSlide
from .audit.thresholds import Thresholds, build
from .models import Finding, MeasuredNode, Project, SlideMeasure, TypeNode

# Rules that hold on a text-only measurement (no masks, no subject, no images).
TEXT_RULES = frozenset(
    {name for name, spec in registry.RULES.items() if spec.family == "type"}
    | {"TEXT_OVERLAP", "TEXT_CROWDED", "TEXT_CLIPPED", "IN_SAFE_ZONE", "OUTSIDE_MARGIN",
       "ALIGN_NEAR_MISS", "MARGIN_NEAR_MISS", "SPACING_INCONSISTENT", "SPACING_OFF_SCALE"}
)

Progress = Callable[[str], None]


def _pct(v: float, total: float) -> float:
    return round(100 * v / total, 2)


def node_report(n: MeasuredNode, src: TypeNode, project: Project, t: Thresholds) -> dict[str, Any]:
    W, H = project.format.width, project.format.height
    lines = n.lines or []
    style = n.style
    band = t.band(n.level)
    row: dict[str, Any] = {
        "id": n.id, "name": src.name or src.id, "role": n.role, "level": n.level,
        "lines": [line.text for line in lines], "lineCount": len(lines),
        "box": {"x": _pct(n.box.x, W), "y": _pct(n.box.y, H), "w": _pct(n.box.w, W), "h": _pct(n.box.h, H)},
        "overflow": bool(n.overflow),
    }
    if band:
        row["maxLines"] = band.max_lines
    if style:
        displayed = style.size * t.guide.k
        lc_min, size_band = t.lc_band(displayed, style.weight)
        row.update(font=style.font, size=style.size, weight=style.weight,
                   lineHeightPx=style.line_height, displayedPx=round(displayed, 1),
                   contrast={"lcMin": lc_min, "sizeBand": size_band})
    if lines:
        x0 = min(line.rect.x for line in lines)
        y0 = min(line.rect.y for line in lines)
        x1 = max(line.rect.x + line.rect.w for line in lines)
        y1 = max(line.rect.y + line.rect.h for line in lines)
        row["ink"] = {"x": _pct(x0, W), "y": _pct(y0, H), "w": _pct(x1 - x0, W), "h": _pct(y1 - y0, H),
                      "bottom": _pct(y1, H), "px": {"x": round(x0, 1), "y": round(y0, 1),
                                                    "w": round(x1 - x0, 1), "h": round(y1 - y0, 1)}}
        last = lines[-1].text.split()
        longest = max(line.rect.w for line in lines) or 1
        forced = "\n" in src.data.text and src.data.text.split("\n")[-1].strip() == lines[-1].text.strip()
        row["widow"] = len(lines) > 1 and not forced and (
            len(last) < 2 or lines[-1].rect.w / longest < t["widowRatio"])
    if n.content_height is not None:
        row["textHeight"] = _pct(n.content_height, H)
        row["fitH"] = round(100 * (n.content_height + 1) / H + 0.005, 2)  # the smallest box.h that holds it
    if src.data.stack:
        s = src.data.stack
        row["stack"] = {"below" if s.below else "above": s.anchor, "gap": s.gap, "y": row["box"]["y"]}
    return row


def measure(path: str | Path, *, slide_ids: list[str] | None = None,
            progress: Progress = lambda s: None) -> dict[str, Any]:
    from . import browser

    loaded = proj.load(path)
    project = loaded.require()
    wanted = slide_ids or [s.id for s in project.slides]
    unknown = [s for s in wanted if project.slide(s) is None]
    if unknown:
        raise proj.XdsError("UNKNOWN_SLIDE", f"no slide {', '.join(map(repr, unknown))}", status=404)
    measures = browser.measure_text(loaded.root, project, wanted, progress=progress)
    t = build(project)
    off = set(project.rules.off) if project.rules else set()
    skip = off | (set(registry.RULES) - TEXT_RULES)
    positions = {s.id: i + 1 for i, s in enumerate(project.slides)}
    slides = []
    with tempfile.TemporaryDirectory() as tmp:  # no pixels: the rules that need them don't run
        for sid in wanted:
            slide = project.slide(sid)
            m: SlideMeasure = measures[sid]
            ms = MeasuredSlide(project, slide, m, Path(tmp), t, positions[sid])
            findings: list[Finding] = audit_slide(ms, t, skip)
            sources = {n.id: n for n in slide.nodes if isinstance(n, TypeNode)}
            nodes = [node_report(n, sources[n.id], project, t) for n in m.nodes
                     if n.layer == "type" and n.id in sources]
            slides.append({"slideId": sid, "name": slide.name, "nodes": nodes,
                           "findings": [f.model_dump(mode="json", by_alias=True, exclude_none=True)
                                        for f in findings]})
    return {"hash": loaded.hash, "format": project.format.preset or
            f"{project.format.width}x{project.format.height}", "unit": t.u, "slides": slides,
            "checks": sorted(TEXT_RULES - off)}


def text(report: dict[str, Any]) -> str:
    out = []
    for s in report["slides"]:
        out.append(f"{s['slideId']}  {s['name']}".rstrip())
        for n in s["nodes"]:
            head = f"  {n['id']:<14} {n.get('level') or '?'} {n.get('size', 0):g}px"
            if n.get("contrast"):
                head += f" · needs Lc ≥ {n['contrast']['lcMin']:g} ({n['contrast']['sizeBand']})"
            out.append(head)
            out.append("      " + " / ".join(f"\"{line}\"" for line in n["lines"])
                       + f"  ({n['lineCount']} line{'s' if n['lineCount'] != 1 else ''}"
                       + (f", max {n['maxLines']}" if n.get("maxLines") else "") + ")")
            b = n["box"]
            geo = f"box x {b['x']:g} y {b['y']:g} w {b['w']:g} h {b['h']:g}"
            if n.get("ink"):
                geo += f" · ink y {n['ink']['y']:g}–{n['ink']['bottom']:g}"
            if n.get("fitH") is not None:
                geo += (f" · text needs h ≥ {n['fitH']:g}" + ("  ← OVERFLOWS" if n["overflow"] else ""))
            out.append("      " + geo)
            if n.get("stack"):
                st = n["stack"]
                where = "below" if "below" in st else "above"
                out.append(f"      stacked {where} {st[where]} + {st['gap']:g}u → y {st['y']:g}")
            if n.get("widow"):
                out.append("      widow: the last line is one word or very short")
        for f in s["findings"]:
            out.append(f"  {f['severity']:<5} {f['rule']}: {f['message']}")
            if f.get("fix"):
                out.append(f"        fix: {f['fix']}")
        out.append("")
    out.append("text-only checks; `xds audit` adds contrast, the product, images and composition")
    return "\n".join(out)
