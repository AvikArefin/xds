"""Subject and lighting (design-rules §4.6, lighting-and-backgrounds §1.6 and §3.5).

SCREEN_ASPECT_MISMATCH is structural and checked by `models3d.check_project`, not here.
"""

from __future__ import annotations

import math
from typing import TYPE_CHECKING, Iterator

import numpy as np

from ..contrast import apca_lc_y, apca_y
from ..geometry import R
from ..measured import dilate
from ...models import Edit
from ..registry import Hit, rule

if TYPE_CHECKING:
    from ..measured import MeasuredSlide
    from ..thresholds import Thresholds

FAMILY = "subject"
SECTORS = 12  # the separation ring is judged per angular sector around the silhouette


def _lit_pixels(s: MeasuredSlide) -> np.ndarray | None:
    """Silhouette pixels without device screens (screens are unlit UI, not the product's light)."""
    sub = s.subject_mask
    if sub is None or s.lightness is None:
        return None
    if s.measure.screens:
        sub = sub & ~s.rect_mask([R.of(sc.rect) for sc in s.measure.screens])
    return sub if sub.any() else None


def _lighting_fix(s: MeasuredSlide, delta: float, look: str) -> str:
    b = s.project.slide_lighting(s.slide).brightness
    return f"Set lighting.brightness to {max(-1.0, min(1.0, b + delta)):.1f}, or lighting.look '{look}'"


@rule("SUBJECT_TOO_SMALL", family=FAMILY, severity="warn", thresholds=("subject.height",))
def subject_too_small(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """A hero that is too small gets lost; the product should own the frame."""
    yield from _subject_height(s, t, small=True)


@rule("SUBJECT_TOO_LARGE", family=FAMILY, severity="warn", thresholds=("subject.height",))
def subject_too_large(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """A hero that fills the canvas leaves no room for the message or for air."""
    yield from _subject_height(s, t, small=False)


def _subject_height(s: MeasuredSlide, t: Thresholds, *, small: bool) -> Iterator[Hit]:
    if s.subject_block is None:
        return
    lo, hi = t["subject.height"]
    pct = 100 * s.subject_block.rect.h / s.height
    if (small and pct >= lo) or (not small and pct <= hi):
        return
    goal = min(hi, lo + 10) if small else max(lo, hi - 10)
    yield Hit(
        nodes=s.subject_block.ids, region=s.subject_block.rect,
        message=f"The subject '{s.subject_block.name}' is {pct:.0f} % of the canvas height.",
        measured={"heightPct": round(pct, 1)}, expected={"heightPct": [lo, hi]},
        fix=f"Set {s.camera_height_fix(goal / pct)}",
        edits=s.camera_height_edits(goal / pct),
    )


@rule("SUBJECT_OVEREXPOSED", family=FAMILY, severity="warn",
      thresholds=("subject.highlightL", "subject.overexposed"))
def subject_overexposed(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Clipped highlights lose the product's shape and material."""
    lit = _lit_pixels(s)
    if lit is None:
        return
    L = s.lightness[lit]
    pct = 100 * float((L > t["subject.highlightL"]).mean())
    if pct <= t["subject.overexposed"]:
        return
    yield Hit(
        nodes=s.subject_block.ids, region=s.subject_block.rect,
        message=f"{pct:.0f} % of '{s.subject_block.name}' is blown out to white.",
        measured={"clippedPct": round(pct, 1)}, expected={"clippedPctMax": t["subject.overexposed"]},
        fix=_lighting_fix(s, -0.3, "contrast"), edits=s.lighting_edits(-0.3),
    )


@rule("SUBJECT_UNDEREXPOSED", family=FAMILY, severity="warn",
      thresholds=("subject.darkMedian", "subject.blackL", "subject.blackShare"))
def subject_underexposed(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Crushed shadows turn the product into a dark hole."""
    lit = _lit_pixels(s)
    if lit is None:
        return
    L = s.lightness[lit]
    median = float(np.median(L))
    black = 100 * float((L < t["subject.blackL"]).mean())
    if median >= t["subject.darkMedian"] or black <= t["subject.blackShare"]:
        return
    yield Hit(
        nodes=s.subject_block.ids, region=s.subject_block.rect,
        message=f"'{s.subject_block.name}' is underexposed: median lightness {median:.2f}, {black:.0f} % crushed.",
        measured={"medianL": round(median, 3), "crushedPct": round(black, 1)},
        expected={"medianLMin": t["subject.darkMedian"], "crushedPctMax": t["subject.blackShare"]},
        fix=_lighting_fix(s, 0.3, "rim"), edits=s.lighting_edits(0.3),
    )


@rule("SUBJECT_LOW_SEPARATION", family=FAMILY, severity="warn", thresholds=("subject.separation",))
def subject_low_separation(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """The product must separate from what is directly behind it, by luminance, not just hue.

    Compares the silhouette's inner edge ring with the background just outside it, per angular
    sector, and scores the median sector.
    """
    sub = s.subject_mask
    if sub is None or s.image is None or not sub.any():
        return
    r = max(2, t.u // 2)
    inner = sub & dilate(~sub, r)  # silhouette pixels within r of the outside
    outer = dilate(sub, r) & ~sub
    if not inner.any() or not outer.any():
        return
    Y = apca_y(s.image)
    ys, xs = np.nonzero(sub)
    cy, cx = ys.mean(), xs.mean()
    hh, ww = np.mgrid[0:s.height, 0:s.width]
    sector = ((np.arctan2(hh - cy, ww - cx) + math.pi) / (2 * math.pi) * SECTORS).astype(int) % SECTORS
    scores = []
    for k in range(SECTORS):
        a, b = inner & (sector == k), outer & (sector == k)
        if a.sum() >= 4 and b.sum() >= 4:
            scores.append(abs(float(apca_lc_y(Y[a].mean(), Y[b].mean()))))
    if not scores:
        return
    lc = float(np.median(scores))
    if lc >= t["subject.separation"]:
        return
    yield Hit(
        nodes=s.subject_block.ids, region=s.subject_block.rect.expand(r),
        message=f"'{s.subject_block.name}' blends into the background at its edge (Lc {lc:.0f}).",
        measured={"edgeLc": round(lc, 1)}, expected={"edgeLcMin": t["subject.separation"]},
        fix="Change the ground's tone behind the product (its design data.values), set lighting.look 'rim', "
            "or use a spotlight ground design",
    )


@rule("SUBJECT_CLOSE_TO_TEXT", family=FAMILY, severity="warn", thresholds=("subject.textGap",))
def subject_close_to_text(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Breathing room: text that nearly touches the product looks cramped.

    Fires when the silhouette is within subject.textGap px of a text line without lying under it
    (that is TEXT_OVER_SUBJECT).
    """
    sub = s.subject_mask
    if sub is None or s.subject_block is None:
        return
    gap = t["subject.textGap"]
    for n in s.text_nodes:
        rects = s.line_rects(n)
        if (s.rect_mask(rects) & sub).any():
            continue
        near = s.rect_mask([r.expand(gap) for r in rects]) & sub
        if not near.any():
            continue
        ys, xs = np.nonzero(near)
        region = R.from_edges(xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
        ink = s.ink(n)
        dy = (region.y - gap - ink.y1) if ink.cy < region.cy else (region.y1 + gap - ink.y)
        yield Hit(
            nodes=[n.id, *s.subject_block.ids], region=region.union(ink.intersect(region.expand(gap)) or region),
            message=f"'{s.name(n.id)}' comes within {gap}px of the subject.",
            measured={"withinPx": gap}, expected={"gapPxMin": gap},
            fix=s.move_fix(n.id, dy=dy) + f", or set {s.camera_height_fix(0.9)}",
            edits=s.move_edits(n.id, dy=dy),
        )


def _screen_scale(screen) -> float:
    return screen.scale or (3.0 if screen.width < 600 else 2.0)


@rule("SCREEN_DETAIL_TOO_SMALL", family=FAMILY, severity="warn", thresholds=("screen.bodyPx", "screen.readable"))
def screen_detail_too_small(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """UI on a device must stay legible on the slide, or it reads as texture.

    Assumes the screen page's body text is screen.bodyPx CSS px and checks what that becomes on
    the slide against readable(screen.readable).
    """
    need = s.guide.readable(t["screen.readable"])
    for sc in s.measure.screens:
        screen = s.project.screen(sc.screen_id)
        if screen is None or sc.displayed_width <= 0:
            continue
        shown = t["screen.bodyPx"] * sc.displayed_width / screen.width
        if shown >= need:
            continue
        factor = need / shown
        yield Hit(
            nodes=[n.id for n in s.render_nodes], region=R.of(sc.rect),
            message=(f"Body text on screen '{sc.screen_id}' shows at about {shown:.0f}px on the slide; "
                     f"it needs {need:.0f}px to read."),
            measured={"bodyPxOnSlide": round(shown, 1)}, expected={"bodyPxOnSlideMin": round(need, 1)},
            fix=(f"Set {s.camera_height_fix(factor)} to enlarge the device, or use "
                 f"≥ {t['screen.bodyPx'] * factor:.0f}px body type and fewer rows in the screen"),
        )


@rule("SCREEN_LOW_RES", family=FAMILY, severity="warn", thresholds=("screen.texelRatio",))
def screen_low_res(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """A screen texture with too few pixels looks soft next to the crisp render."""
    for sc in s.measure.screens:
        screen = s.project.screen(sc.screen_id)
        if screen is None or sc.displayed_width <= 0:
            continue
        scale = _screen_scale(screen)
        ratio = screen.width * scale / sc.displayed_width
        if ratio >= t["screen.texelRatio"]:
            continue
        idx = s.project.screens.index(screen)
        new = min(4.0, math.ceil(10 * t["screen.texelRatio"] * sc.displayed_width / screen.width) / 10)
        yield Hit(
            nodes=[n.id for n in s.render_nodes], region=R.of(sc.rect),
            message=f"Screen '{sc.screen_id}' has {ratio:.2f} texture px per slide px; it will look soft.",
            measured={"texelRatio": round(ratio, 2), "scale": scale},
            expected={"texelRatioMin": t["screen.texelRatio"]},
            fix=f"Set screens[{idx}].scale to {new:g}",
            edits=[Edit(path=f"screens.{idx}.scale", value=new)],
        )
