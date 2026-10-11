"""`MeasuredSlide`: one slide's measurements and pixels, loaded lazily, for the rules.

Rules read only what the browser measured (`SlideMeasure`) and what it drew (the PNGs). Nothing
here estimates text geometry: line rects, sizes and colors all come from the browser.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import cached_property
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from ..models import (
    FRAME_DEFAULTS,
    FrameCamera,
    MeasuredNode,
    Project,
    Slide,
    SlideMeasure,
)
from .contrast import oklab_l
from .geometry import R, union_all
from .thresholds import Thresholds

LEVEL_RANK = {"expressive": -1, "display": 0, "headline": 1, "subhead": 2, "body": 3, "caption": 4}


def dilate(mask: np.ndarray, r: int) -> np.ndarray:
    """Square (Chebyshev) dilation by r pixels: OR of the mask shifted by -r..r on each axis."""
    padded = np.pad(mask, r)
    h, w = mask.shape
    rows = np.zeros((h + 2 * r, w), dtype=bool)
    for d in range(2 * r + 1):
        rows |= padded[:, d:d + w]
    out = np.zeros((h, w), dtype=bool)
    for d in range(2 * r + 1):
        out |= rows[d:d + h, :]
    return out


@dataclass
class Block:
    """A visible element as the layout rules see it: its ink rectangle and identity."""

    id: str
    name: str
    layer: str
    rect: R
    node: MeasuredNode | None = None
    ids: list[str] = field(default_factory=list)  # node ids (several for the subject)

    @property
    def level(self) -> str | None:
        return self.node.level if self.node else None

    @property
    def group(self) -> str | None:
        return self.node.group if self.node else None


class MeasuredSlide:
    def __init__(self, project: Project, slide: Slide, measure: SlideMeasure, cache_dir: Path,
                 thresholds: Thresholds, position: int):
        self.project = project
        self.slide = slide
        self.measure = measure
        self.cache_dir = Path(cache_dir)
        self.t = thresholds
        self.guide = thresholds.guide
        self.position = position  # 1-based
        self.width, self.height = measure.width, measure.height
        self.memo: dict[str, Any] = {}  # rules sharing expensive results (e.g. contrast scores)
        self._sources = {n.id: n for n in slide.nodes}

    # --- identity ------------------------------------------------------------------------
    @property
    def id(self) -> str:
        return self.slide.id

    def source(self, node_id: str) -> Any:
        """The project node behind a measured node."""
        return self._sources.get(node_id)

    def name(self, node_id: str) -> str:
        n = self._sources.get(node_id)
        return (n.name or n.id) if n else node_id

    def node(self, node_id: str) -> MeasuredNode | None:
        return next((n for n in self.measure.nodes if n.id == node_id), None)

    # --- nodes -----------------------------------------------------------------------------
    @cached_property
    def text_nodes(self) -> list[MeasuredNode]:
        return [n for n in self.measure.nodes if n.layer == "type" and n.lines]

    @cached_property
    def reading_text(self) -> list[MeasuredNode]:
        """Text that is meant to be read: not decorative, with a style and a level."""
        return [n for n in self.text_nodes if not n.decorative and n.style and n.level]

    @property
    def image_nodes(self) -> list[MeasuredNode]:
        return [n for n in self.measure.nodes if n.layer == "image"]

    @property
    def render_nodes(self) -> list[MeasuredNode]:
        return [n for n in self.measure.nodes if n.layer == "render"]

    @staticmethod
    def line_rects(node: MeasuredNode) -> list[R]:
        return [R.of(line.rect) for line in node.lines or []]

    def ink(self, node: MeasuredNode) -> R:
        """Text: the union of its ink line rects. Images: the bounds of its opaque pixels."""
        if node.lines:
            return union_all(self.line_rects(node)) or R.of(node.box)
        if node.layer == "image":
            return self.image_ink(node) or R.of(node.box)
        return R.of(node.box)

    def image_ink(self, node: MeasuredNode) -> R | None:
        mask = self.mask("image")
        if mask is None:
            return None
        box = self.clip(R.of(node.box))
        if box is None:
            return None
        x0, y0, x1, y1 = self.px(box)
        ys, xs = np.nonzero(mask[y0:y1, x0:x1] > 0.5)
        if len(xs) == 0:
            return None
        return R.from_edges(x0 + xs.min(), y0 + ys.min(), x0 + xs.max() + 1, y0 + ys.max() + 1)

    @cached_property
    def top_level(self) -> str | None:
        levels = [n.level for n in self.reading_text if n.level]
        return min(levels, key=LEVEL_RANK.__getitem__) if levels else None

    @cached_property
    def subject_block(self) -> Block | None:
        if not self.measure.subject or not self.render_nodes:
            return None
        ids = [n.id for n in self.render_nodes]
        return Block("subject", " + ".join(self.name(i) for i in ids), "render",
                     R.of(self.measure.subject.bounds), None, ids)

    @cached_property
    def blocks(self) -> list[Block]:
        """Every visible non-ground element: text blocks, images, and the subject as one block."""
        out = [Block(n.id, self.name(n.id), n.layer, self.ink(n), n, [n.id])
               for n in self.measure.nodes if n.layer in ("type", "image") and (n.lines or n.layer == "image")]
        if self.subject_block:
            out.append(self.subject_block)
        return out

    # --- pixels ----------------------------------------------------------------------------
    def _load(self, rel: str | None, mode: str) -> np.ndarray | None:
        if not rel:
            return None
        path = self.cache_dir / rel
        if not path.exists():
            return None
        with Image.open(path) as im:
            im = im.convert(mode)
            if im.size != (self.width, self.height):
                im = im.resize((self.width, self.height))
            return np.asarray(im, dtype=np.float32) / 255.0

    @cached_property
    def image(self) -> np.ndarray | None:
        """The final composite, RGB float 0..1."""
        return self._load(self.measure.slide_png, "RGB")

    @cached_property
    def background(self) -> np.ndarray | None:
        """The composite without the type layer, RGB float 0..1 (contrast is sampled here)."""
        return self._load(self.measure.background_only, "RGB")

    def mask(self, layer: str) -> np.ndarray | None:
        """A layer's alpha, float 0..1, shape (h, w)."""
        key = f"mask:{layer}"
        if key not in self.memo:
            self.memo[key] = self._load(self.measure.layers.get(layer), "L")
        return self.memo[key]

    @cached_property
    def subject_mask(self) -> np.ndarray | None:
        """The 3D subject's silhouette (render layer alpha, without shadows), boolean."""
        if not self.measure.subject:
            return None
        m = self.mask("render")
        return None if m is None else m > 0.5

    @cached_property
    def lightness(self) -> np.ndarray | None:
        return None if self.image is None else oklab_l(self.image)

    def clip(self, r: R) -> R | None:
        return r.intersect(R(0, 0, self.width, self.height))

    @staticmethod
    def px(r: R) -> tuple[int, int, int, int]:
        """Integer pixel edges (x0, y0, x1, y1) covering a rect."""
        return int(np.floor(r.x)), int(np.floor(r.y)), int(np.ceil(r.x1)), int(np.ceil(r.y1))

    def rect_mask(self, rects: list[R]) -> np.ndarray:
        m = np.zeros((self.height, self.width), dtype=bool)
        for r in rects:
            c = self.clip(r)
            if c is not None:
                x0, y0, x1, y1 = self.px(c)
                m[y0:y1, x0:x1] = True
        return m

    def text_ink_mask(self, node: MeasuredNode) -> np.ndarray:
        """The node's glyph pixels: its line rects ∩ the type layer's alpha (rects if no mask)."""
        rects = self.rect_mask(self.line_rects(node))
        alpha = self.mask("type")
        if alpha is not None:
            glyphs = rects & (alpha > 0.5)
            if glyphs.any():
                return glyphs
        return rects

    def pixels(self, img: np.ndarray, r: R) -> np.ndarray | None:
        c = self.clip(r)
        if c is None:
            return None
        x0, y0, x1, y1 = self.px(c)
        patch = img[y0:y1, x0:x1]
        return patch if patch.size else None

    # --- fixes -----------------------------------------------------------------------------
    def camera(self) -> dict[str, float] | None:
        """The frame camera's effective values, or None for a free camera."""
        cam = self.slide.camera
        if cam is None:
            return dict(FRAME_DEFAULTS)
        if isinstance(cam, FrameCamera):
            vals = dict(FRAME_DEFAULTS)
            vals.update({k: v for k, v in cam.model_dump().items() if k in vals and v is not None})
            return vals
        return None

    def move_fix(self, node_id: str, dx: float = 0.0, dy: float = 0.0) -> str:
        """A concrete edit that moves a node by (dx, dy) px: its box.x/box.y, or camera.x/y."""
        src = self.source(node_id)
        if src is not None and getattr(src, "box", None) is not None:
            stack = getattr(src.data, "stack", None)
            parts = [f"box.x to {src.box.x + 100 * dx / self.width:.1f}"] if dx else []
            if dy and stack is not None:  # a stacked block's y comes from its gap
                gap = stack.gap + (dy if stack.below else -dy) / self.guide.u
                parts.append(f"data.stack.gap to {round(gap * 4) / 4:g} (u)")
            elif dy:
                parts.append(f"box.y to {src.box.y + 100 * dy / self.height:.1f}")
            return f"Set '{self.name(node_id)}' " + " and ".join(parts) if parts else "No move needed"
        cam = self.camera()
        if cam is None:
            return f"Move the subject {dx:+.0f}px, {dy:+.0f}px (free camera: adjust camera.target)"
        parts = [f"camera.{axis} to {cam[axis] + 100 * d / size:.1f}"
                 for axis, d, size in (("x", dx, self.width), ("y", dy, self.height)) if d]
        return "Set " + " and ".join(parts) if parts else "No move needed"

    def camera_height_fix(self, factor: float) -> str:
        cam = self.camera()
        if cam is None:
            return "switch to camera.mode 'frame' and set camera.height"
        return f"camera.height to {max(1.0, min(200.0, cam['height'] * factor)):.0f}"
