"""Composition and attention (design-rules §4.5)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Iterator

import numpy as np

from ..geometry import R, union_all
from ..measured import LEVEL_RANK, dilate
from ..registry import Hit, rule

if TYPE_CHECKING:
    from ..measured import MeasuredSlide
    from ..thresholds import Thresholds

FAMILY = "composition"


def _saliency(s: MeasuredSlide) -> np.ndarray | None:
    if "saliency" not in s.memo:
        from ..saliency import saliency_map

        s.memo["saliency"] = None if s.image is None else saliency_map(s.image)
    return s.memo["saliency"]


def _ground_names(s: MeasuredSlide) -> str:
    names = [f"'{s.name(n.id)}'" for n in s.measure.nodes if n.layer == "ground"]
    return ", ".join(names) or "the background"


@rule("ATTENTION_ON_BACKGROUND", family=FAMILY, severity="warn", thresholds=("attention.top", "attention.share"))
def attention_on_background(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """The eye should land on what matters, not on the background.

    Of the most salient pixels (OpenCV spectral residual), at least half should fall on the
    subject or the top-level text.
    """
    sal = _saliency(s)
    if sal is None:
        return
    from ..saliency import halo, top_mask

    target = np.zeros(sal.shape, dtype=bool)
    if s.subject_mask is not None:
        target |= s.subject_mask
    tops = [n for n in s.reading_text if n.level == s.top_level]
    for n in tops:
        target |= s.rect_mask(s.line_rects(n))
    if not target.any():
        return
    target = dilate(target, halo(sal.shape))  # the map is coarse: count its halo as on target
    top = top_mask(sal, t["attention.top"])
    share = 100 * float((top & target).sum()) / max(1, int(top.sum()))
    if share >= t["attention.share"]:
        return
    ys, xs = np.nonzero(top & ~target)
    region = R.from_edges(xs.min(), ys.min(), xs.max() + 1, ys.max() + 1) if len(xs) else None
    cam = f"set {s.camera_height_fix(1.2)}" if s.subject_block else "enlarge the top-level text"
    yield Hit(
        nodes=[n.id for n in tops] + (s.subject_block.ids if s.subject_block else []), region=region,
        message=f"Only {share:.0f} % of the most eye-catching pixels are on the subject or the headline.",
        measured={"sharePct": round(share, 1)}, expected={"sharePctMin": t["attention.share"]},
        fix=f"Calm {_ground_names(s)} (lower its contrast/accent values in data.values), or {cam}",
    )


def _owner(s: MeasuredSlide, r: R) -> str | None:
    """The block a salient region mostly lies on (allowing for the map's halo), or None."""
    from ..saliency import halo

    pad = halo((s.height, s.width))
    for b in s.blocks:
        hit = b.rect.expand(pad).intersect(r)
        if hit is not None and hit.area >= 0.5 * r.area:
            return b.id
    return None


@rule("ATTENTION_SPLIT", family=FAMILY, severity="info", thresholds=("attention.top", "attention.split"))
def attention_split(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """One focal point per slide: two equally strong regions split the first look."""
    sal = _saliency(s)
    if sal is None:
        return
    from ..saliency import regions, top_mask

    found = regions(top_mask(sal, t["attention.top"]), sal)
    if len(found) < 2:
        return
    (ra, ma), (rb, mb) = found[:2]
    if mb / ma < t["attention.split"] or ra.gap(rb) < 0.1 * s.guide.s:
        return
    owner_a, owner_b = _owner(s, ra), _owner(s, rb)
    if owner_a is not None and owner_a == owner_b:
        return  # two peaks on the same element are one focal point
    yield Hit(
        region=ra.union(rb),
        message="Two separate regions draw the eye about equally.",
        measured={"ratio": round(mb / ma, 2)}, expected={"ratioMax": t["attention.split"]},
        fix="Make one of them clearly dominant: enlarge it (data.size / camera.height) or tone the other down",
    )


@rule("COMPETING_HEADLINES", family=FAMILY, severity="warn")
def competing_headlines(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """One message per slide: two top-level blocks compete for it."""
    level = s.top_level
    if level is None or level in ("body", "caption"):
        return
    tops = [n for n in s.reading_text if n.level == level]
    if len(tops) < 2 or (tops[0].group and all(n.group == tops[0].group for n in tops)):
        return
    names = ", ".join(f"'{s.name(n.id)}'" for n in tops)
    yield Hit(
        nodes=[n.id for n in tops], region=union_all(s.ink(n) for n in tops),
        message=f"{len(tops)} {level} blocks compete: {names}.",
        measured={"topLevelBlocks": len(tops)}, expected={"topLevelBlocks": 1},
        fix=f"Give '{s.name(tops[-1].id)}' a lower-level data.role, or put them in one data.group",
    )


@rule("HIERARCHY_ORDER", family=FAMILY, severity="warn", thresholds=("kickerGap",))
def hierarchy_order(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Read the most important thing first.

    A lower-level block before the top-level block in reading order (top → bottom, left →
    right), unless it sits directly above it as a kicker (within kickerGap × its line height).
    """
    level = s.top_level
    if level is None:
        return
    order = sorted(s.reading_text, key=lambda n: (round(s.ink(n).y), s.ink(n).x))
    top = next(n for n in order if n.level == level)
    ti = s.ink(top)
    for n in order[: order.index(top)]:
        if LEVEL_RANK[n.level] <= LEVEL_RANK[level]:
            continue
        ni = s.ink(n)
        kicker = ni.h_overlap(ti) > 0 and 0 <= ti.y - ni.y1 <= t["kickerGap"] * n.style.line_height
        if kicker:
            continue
        yield Hit(
            nodes=[n.id, top.id], region=ni.union(ti),
            message=f"'{s.name(n.id)}' ({n.level}) is read before '{s.name(top.id)}' ({level}).",
            measured={"before": n.id}, expected={"first": top.id},
            fix=s.move_fix(n.id, dy=ti.y1 + t.u * 2 - ni.y) + f" (below '{s.name(top.id)}'), "
                "or place it directly above as a kicker",
            edits=s.move_edits(n.id, dy=ti.y1 + t.u * 2 - ni.y),
        )


@rule("POSITION_NEAR_MISS", family=FAMILY, severity="info", thresholds=("positionNearMiss",))
def position_near_miss(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Commit to the center or to a third.

    Checks the subject's and images' centers on both axes, and centered text horizontally.
    """
    lo, hi = (v * s.guide.s / 100 for v in t["positionNearMiss"])
    lines_x = {"center": s.width / 2, "left third": s.width / 3, "right third": 2 * s.width / 3}
    lines_y = {"center": s.height / 2, "upper third": s.height / 3, "lower third": 2 * s.height / 3}
    for b in s.blocks:
        axes = []
        if b.layer in ("render", "image") or (b.node and b.node.align == "center"):
            axes.append(("x", b.rect.cx, lines_x))
        if b.layer in ("render", "image"):
            axes.append(("y", b.rect.cy, lines_y))
        for axis, c, lines in axes:
            name, d = min(((k, v - c) for k, v in lines.items()), key=lambda kv: abs(kv[1]))
            if lo <= abs(d) <= hi:
                yield Hit(
                    nodes=b.ids, region=b.rect,
                    message=f"'{b.name}' is {abs(d):.0f}px off the {name} — close, but not on it.",
                    measured={"axis": axis, "offsetPx": round(abs(d), 1)},
                    expected={"offsetPx": f"0 or > {hi:.0f}"},
                    fix=s.move_fix(b.id, dx=d if axis == "x" else 0, dy=d if axis == "y" else 0)
                    + f" to sit on the {name}",
                    edits=s.move_edits(b.id, dx=d if axis == "x" else 0, dy=d if axis == "y" else 0),
                )
                break


@rule("LOPSIDED", family=FAMILY, severity="info", thresholds=("lopsided",))
def lopsided(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Balance: the visual mass shouldn't pile up on one side.

    Mass = the alpha of the non-ground layers × their lightness contrast with the background.
    """
    if s.lightness is None:
        return
    alpha = np.zeros((s.height, s.width), dtype=np.float32)
    for layer in ("render", "image", "type"):
        m = s.mask(layer)
        if m is not None:
            alpha = np.maximum(alpha, m)
    if not alpha.any():
        return
    bg = s.lightness[alpha < 0.5]
    base = float(np.median(bg)) if bg.size else 0.5
    mass = alpha * np.abs(s.lightness - base)
    total = float(mass.sum())
    if total <= 0:
        return
    ys, xs = np.mgrid[0:s.height, 0:s.width]
    cx, cy = float((mass * xs).sum() / total), float((mass * ys).sum() / total)
    dx, dy = cx - s.width / 2, cy - s.height / 2
    dist = float(np.hypot(dx, dy))
    if dist <= t["lopsided"] * s.guide.s:
        return
    side = ("right" if dx > 0 else "left") if abs(dx) >= abs(dy) else ("bottom" if dy > 0 else "top")
    opposite = {"right": "left", "left": "right", "top": "bottom", "bottom": "top"}[side]
    heavy = max(s.blocks, key=lambda b: b.rect.area, default=None)
    move = s.move_fix(heavy.id, dx=-dx / 2, dy=-dy / 2) if heavy else "Move content toward the center"
    yield Hit(
        nodes=heavy.ids if heavy else [], region=R(cx - 10, cy - 10, 20, 20),
        message=f"The visual weight sits {dist:.0f}px toward the {side} with nothing to balance it.",
        measured={"offsetPx": round(dist, 1)}, expected={"offsetPxMax": round(t["lopsided"] * s.guide.s)},
        fix=f"{move}, or add a counterweight on the {opposite}",
    )


@rule("CROWDED", family=FAMILY, severity="warn", thresholds=("crowded",))
def crowded(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Negative space is what makes a layout breathe."""
    c = s.guide.content
    area = R.from_edges(c["x0"], c["y0"], c["x1"], c["y1"])
    covered = s.rect_mask([r for n in s.text_nodes for r in s.line_rects(n)])
    if s.subject_mask is not None:
        covered |= s.subject_mask
    img = s.mask("image")
    if img is not None:
        covered |= img > 0.5
    x0, y0, x1, y1 = s.px(area)
    window = covered[y0:y1, x0:x1]
    if not window.size:
        return
    pct = 100 * float(window.mean())
    if pct <= t["crowded"]:
        return
    yield Hit(
        nodes=[i for b in s.blocks for i in b.ids], region=area,
        message=f"Content covers {pct:.0f} % of the content area.",
        measured={"coveragePct": round(pct, 1)}, expected={"coveragePctMax": t["crowded"]},
        fix=f"Free space: {'set ' + s.camera_height_fix(0.8) if s.subject_block else 'shrink the image'}, or cut text",
    )


@rule("TOO_MANY_ELEMENTS", family=FAMILY, severity="warn", thresholds=("blocks",))
def too_many_elements(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """A glance takes in a handful of things; more is clutter."""
    count = len(s.text_nodes) + len(s.image_nodes) + len(s.render_nodes)
    if count <= t["blocks"]:
        return
    yield Hit(
        nodes=[n.id for n in s.measure.nodes if n.layer != "ground"],
        message=f"The slide has {count} visible blocks.",
        measured={"blocks": count}, expected={"blocksMax": t["blocks"]},
        fix=f"Remove or merge {count - t['blocks']:.0f} blocks (set hidden, or combine text into one node)",
    )


@rule("UNCOVERED_CANVAS", family=FAMILY, severity="error")
def uncovered_canvas(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Every pixel of the slide is painted on purpose: a full-canvas background sits at the back.

    There is no page color under the layers, so a slide whose ground layer doesn't cover the
    whole canvas (visible, unrotated, opaque, box 0–100 %) exports with holes.
    """
    from ...migrate.steps.m0003_ground_paints_canvas import covers_canvas

    nodes = [n.model_dump(mode="json", by_alias=True) for n in s.slide.nodes]
    if any(covers_canvas(n) for n in nodes):
        return
    grounds = [n["id"] for n in nodes if n["layer"] == "ground"]
    yield Hit(
        message="Nothing paints the whole canvas: parts of this slide would be empty.",
        fix="Add a full-canvas background at the back of the ground layer, e.g. design 'solid' "
            "(`xds design add . solid`) with box {x: 0, y: 0, w: 100, h: 100}, or make an existing "
            "background cover the canvas.",
        nodes=grounds,
    )
