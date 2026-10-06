"""Small rectangle helpers for the rules (pixel space, origin top-left, y down)."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable

from ..models import Rect


@dataclass(frozen=True)
class R:
    x: float
    y: float
    w: float
    h: float

    @classmethod
    def of(cls, r: Rect | R) -> R:
        return cls(r.x, r.y, r.w, r.h)

    @classmethod
    def from_edges(cls, x0: float, y0: float, x1: float, y1: float) -> R:
        x0, y0, x1, y1 = float(x0), float(y0), float(x1), float(y1)  # mask bboxes arrive as numpy ints
        return cls(x0, y0, max(0.0, x1 - x0), max(0.0, y1 - y0))

    @property
    def x1(self) -> float:
        return self.x + self.w

    @property
    def y1(self) -> float:
        return self.y + self.h

    @property
    def cx(self) -> float:
        return self.x + self.w / 2

    @property
    def cy(self) -> float:
        return self.y + self.h / 2

    @property
    def area(self) -> float:
        return self.w * self.h

    def intersect(self, o: R) -> R | None:
        x0, y0 = max(self.x, o.x), max(self.y, o.y)
        x1, y1 = min(self.x1, o.x1), min(self.y1, o.y1)
        if x1 <= x0 or y1 <= y0:
            return None
        return R.from_edges(x0, y0, x1, y1)

    def union(self, o: R) -> R:
        return R.from_edges(min(self.x, o.x), min(self.y, o.y), max(self.x1, o.x1), max(self.y1, o.y1))

    def expand(self, d: float) -> R:
        return R(self.x - d, self.y - d, self.w + 2 * d, self.h + 2 * d)

    def gap(self, o: R) -> float:
        """Euclidean distance between the two rectangles (0 when they touch or overlap)."""
        dx = max(0.0, o.x - self.x1, self.x - o.x1)
        dy = max(0.0, o.y - self.y1, self.y - o.y1)
        return math.hypot(dx, dy)

    def h_overlap(self, o: R) -> float:
        return min(self.x1, o.x1) - max(self.x, o.x)

    def v_overlap(self, o: R) -> float:
        return min(self.y1, o.y1) - max(self.y, o.y)

    def gap_region(self, o: R) -> R:
        """The rectangle spanning the space between two rectangles (for annotations)."""
        x0, x1 = sorted((self.x1, o.x) if self.x1 <= o.x else (o.x1, self.x))
        y0, y1 = sorted((self.y1, o.y) if self.y1 <= o.y else (o.y1, self.y))
        if self.h_overlap(o) > 0:
            x0, x1 = max(self.x, o.x), min(self.x1, o.x1)
        if self.v_overlap(o) > 0:
            y0, y1 = max(self.y, o.y), min(self.y1, o.y1)
        return R.from_edges(x0, y0, max(x1, x0 + 1), max(y1, y0 + 1))

    def to_model(self) -> Rect:
        return Rect(x=round(self.x, 1), y=round(self.y, 1), w=round(self.w, 1), h=round(self.h, 1))


def union_all(rects: Iterable[R]) -> R | None:
    out: R | None = None
    for r in rects:
        out = r if out is None else out.union(r)
    return out
