"""A builder for synthetic audit cases: a project, SlideMeasure JSON and PNGs in a tmp cache.

No browser: text "ink" is drawn as filled line rectangles in the type mask and composite.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from xds.audit import engine
from xds.models import AuditReport, Project

LEVEL_ROLES = ("expressive", "display", "headline", "subhead", "body", "caption")


def rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


class Case:
    def __init__(self, tmp: Path, *, width: int = 1080, height: int = 1350,
                 preset: str | None = "instagram-portrait", background: str = "#ffffff"):
        self.tmp = Path(tmp)
        self.w, self.h = width, height
        self.preset = preset
        self.background = background
        self.bg = np.zeros((height, width, 3), dtype=np.uint8)
        self.bg[:] = rgb(background)
        self.masks = {layer: np.zeros((height, width), dtype=np.uint8) for layer in ("ground", "render", "image", "type")}
        self.masks["ground"][:] = 255
        self.text_draws: list[tuple[list[tuple[int, int, int, int]], str]] = []
        self.nodes: list[dict[str, Any]] = [{
            "id": "ground", "name": "Ground", "layer": "ground",
            "box": {"x": 0, "y": 0, "w": 100, "h": 100}, "data": {"design": "plain"}}]
        self.measured: list[dict[str, Any]] = [
            {"id": "ground", "layer": "ground", "box": {"x": 0, "y": 0, "w": width, "h": height}}]
        self.subject: dict[str, Any] | None = None
        self.screens: list[dict[str, Any]] = []
        self.project_screens: list[dict[str, Any]] = []
        self.expression: dict[str, Any] | None = None   # brand.expression
        self.lighting: dict[str, Any] | None = None     # the slide's lighting override

    # --- content ----------------------------------------------------------------------------
    def _box(self, x: float, y: float, w: float, h: float) -> dict[str, float]:
        return {"x": 100 * x / self.w, "y": 100 * y / self.h, "w": 100 * w / self.w, "h": 100 * h / self.h}

    def text(self, id: str, x: float, y: float, lines: list[str], *, size: float = 70,
             level: str = "headline", widths: list[float] | None = None, color: str = "#111111",
             weight: int = 700, line_height: float | None = None, align: str = "left",
             group: str | None = None, decorative: bool = False, uppercase: bool = False,
             letter_spacing: float = 0.0, overflow: bool = False, font: str = "Inter",
             exceptions: list[dict[str, str]] | None = None, source: str | None = None,
             rotation: float = 0, treat: dict[str, Any] | None = None) -> None:
        """A text node; `source` is data.text (default: the lines joined with explicit breaks).
        `treat` adds fields to data (skew, stroke, extrude, …); `rotation` sets box.rotation."""
        lh = line_height or {"expressive": 0.9, "display": 1.0, "headline": 1.1, "subhead": 1.2}.get(level, 1.45) * size
        rects, mlines = [], []
        for i, text in enumerate(lines):
            w = widths[i] if widths else len(text) * size * 0.5
            ry = y + i * lh
            rects.append((int(x), int(ry), int(x + w), int(ry + lh)))
            mlines.append({"text": text, "rect": {"x": x, "y": ry, "w": w, "h": lh}, "baseline": ry + 0.8 * lh})
        bw = max(r[2] for r in rects) - x
        bh = len(lines) * lh
        for x0, y0, x1, y1 in rects:
            self.masks["type"][max(0, y0):max(0, y1), max(0, x0):max(0, x1)] = 255
        self.text_draws.append((rects, color))
        data: dict[str, Any] = {"text": source if source is not None else "\n".join(lines), "role": level, "align": align}
        if group:
            data["group"] = group
        if decorative:
            data["decorative"] = True
        if treat:
            data.update(treat)
        node = {"id": id, "name": id.title(), "layer": "type", "box": self._box(x, y, bw, bh), "data": data}
        if rotation:
            node["box"]["rotation"] = rotation
        if exceptions:
            node["exceptions"] = exceptions
        self.nodes.append(node)
        self.measured.append({
            "id": id, "layer": "type", "box": {"x": x, "y": y, "w": bw, "h": bh}, "lines": mlines,
            "style": {"font": font, "size": size, "weight": weight, "lineHeight": lh,
                      "letterSpacing": letter_spacing, "color": color, "uppercase": uppercase},
            "overflow": overflow, "role": level, "level": level, "align": align,
            "group": group, "decorative": decorative})

    def image(self, id: str, x: int, y: int, w: int, h: int, color: str = "#3366cc") -> None:
        self.bg[y:y + h, x:x + w] = rgb(color)
        self.masks["image"][y:y + h, x:x + w] = 255
        self.nodes.append({"id": id, "name": id.title(), "layer": "image", "box": self._box(x, y, w, h),
                           "data": {"asset": "photo"}})
        self.measured.append({"id": id, "layer": "image", "box": {"x": x, "y": y, "w": w, "h": h}})

    def shape(self, id: str, x: int, y: int, w: int, h: int, shape: str = "star-8", *,
              stroke: float | None = 0.5, fill: str | None = None, params: dict[str, float] | None = None,
              rotation: float = 0) -> None:
        """An ornament on the image layer (nothing is drawn: the expression rules read the source)."""
        data: dict[str, Any] = {"shape": shape}
        if stroke is not None:
            data["stroke"] = {"width": stroke}
        if fill:
            data["fill"] = fill
        if params:
            data["params"] = params
        node = {"id": id, "name": id.title(), "layer": "image", "box": self._box(x, y, w, h), "data": data}
        if rotation:
            node["box"]["rotation"] = rotation
        self.nodes.append(node)
        self.measured.append({"id": id, "layer": "image", "box": {"x": x, "y": y, "w": w, "h": h}})

    def product(self, x: int, y: int, w: int, h: int, *, color: str | np.ndarray = "#808080",
                camera: dict[str, Any] | None = None, box: tuple[float, float, float, float] | None = None) -> None:
        """A rectangular 'subject' in the render layer."""
        x0, y0, x1, y1 = max(0, x), max(0, y), min(self.w, x + w), min(self.h, y + h)
        self.bg[y0:y1, x0:x1] = rgb(color) if isinstance(color, str) else color
        self.masks["render"][y0:y1, x0:x1] = 255
        self.nodes.append({"id": "bottle", "name": "Bottle", "layer": "render", "data": {"object": "bottle"}})
        bx, by, bw, bh = box or (x, y, w, h)
        self.measured.append({"id": "bottle", "layer": "render", "box": {"x": bx, "y": by, "w": bw, "h": bh}})
        self.subject = {"bounds": {"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0},
                        "coverage": (x1 - x0) * (y1 - y0) / (self.w * self.h)}
        self.camera = camera

    # --- output -----------------------------------------------------------------------------
    def project(self, *, rules: dict[str, Any] | None = None,
                slide_exceptions: list[dict[str, str]] | None = None) -> Project:
        slide: dict[str, Any] = {"id": "s1", "name": "One", "nodes": self.nodes}
        if slide_exceptions:
            slide["exceptions"] = slide_exceptions
        if getattr(self, "camera", None):
            slide["camera"] = self.camera
        if self.lighting:
            slide["lighting"] = self.lighting
        doc: dict[str, Any] = {
            "id": "test", "name": "Test",
            "format": {"preset": self.preset, "width": self.w, "height": self.h},
            "brand": {"colors": [{"name": "ink", "hex": "#111111"}, {"name": "paper", "hex": "#ffffff"},
                                 {"name": "night", "hex": "#101820"}],
                      "typography": {lv: {"level": lv, "font": "Inter"} for lv in LEVEL_ROLES}},
            "objects": [{"id": "bottle", "name": "Bottle", "kind": "box"}],
            "screens": self.project_screens,
            "slides": [slide],
        }
        if rules:
            doc["rules"] = rules
        if self.expression:
            doc["brand"]["expression"] = self.expression
        return Project.model_validate(doc)

    def write(self) -> Path:
        cache = self.tmp / "cache"
        for d in ("slides", "measure", "masks", "background"):
            (cache / d).mkdir(parents=True, exist_ok=True)
        composite = self.bg.copy()
        for rects, color in self.text_draws:
            for x0, y0, x1, y1 in rects:
                composite[max(0, y0):max(0, y1), max(0, x0):max(0, x1)] = rgb(color)
        Image.fromarray(composite).save(cache / "slides/1-s1.png")
        Image.fromarray(self.bg).save(cache / "background/s1.png")
        layers = {}
        for layer, m in self.masks.items():
            Image.fromarray(m, mode="L").save(cache / f"masks/s1-{layer}.png")
            layers[layer] = f"masks/s1-{layer}.png"
        measure = {"slideId": "s1", "width": self.w, "height": self.h, "nodes": self.measured,
                   "subject": self.subject, "screens": self.screens, "layers": layers,
                   "backgroundOnly": "background/s1.png", "slidePng": "slides/1-s1.png"}
        (cache / "measure/s1.json").write_text(json.dumps(measure))
        return cache

    def run(self, **kw: Any) -> AuditReport:
        project = self.project(**kw)
        return engine.run(project, self.write(), "hash123")


def rules_of(report: AuditReport, status: str | None = "open") -> dict[str, list]:
    out: dict[str, list] = {}
    for f in report.findings:
        if status is None or f.status == status:
            out.setdefault(f.rule, []).append(f)
    return out
