"""Collision and masking (design-rules §4.1)."""

from __future__ import annotations

from itertools import combinations
from typing import TYPE_CHECKING, Iterator

import numpy as np

from ..geometry import R, union_all
from ..registry import Hit, rule

if TYPE_CHECKING:
    from ..measured import MeasuredSlide
    from ..thresholds import Thresholds

FAMILY = "collision"


def _tier(pct: float, tiers: list[float]) -> str | None:
    warn, error = tiers
    return "error" if pct > error else "warn" if pct > warn else None


def _bbox(mask: np.ndarray) -> R | None:
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return None
    return R.from_edges(xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)


def _clear_of(s: MeasuredSlide, node_id: str, ink: R, obstacle: R, gap: float) -> str:
    """A move that puts `ink` above or below `obstacle` (whichever is shorter), as a fix."""
    up = obstacle.y - gap - ink.y1
    down = obstacle.y1 + gap - ink.y
    dy = up if abs(up) <= abs(down) else down
    return s.move_fix(node_id, dy=dy)


@rule("TEXT_OVERLAP", family=FAMILY, severity="error")
def text_overlap(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Overlapping text can't be read.

    Compares the ink line rectangles of every pair of text nodes, not their boxes, so generous
    boxes don't false-alarm.
    """
    for a, b in combinations(s.text_nodes, 2):
        hits = [ra.intersect(rb) for ra in s.line_rects(a) for rb in s.line_rects(b)]
        hits = [h for h in hits if h is not None and h.area >= 1]
        if not hits:
            continue
        region = union_all(hits)
        ia, ib = s.ink(a), s.ink(b)
        yield Hit(
            nodes=[a.id, b.id], region=region,
            message=f"'{s.name(a.id)}' and '{s.name(b.id)}' overlap by {sum(h.area for h in hits):.0f} px².",
            measured={"overlapPx": round(sum(h.area for h in hits))},
            expected={"overlapPx": 0, "gapPx": t.u},
            fix=_clear_of(s, b.id, ib, ia, t.u) + f" (clear of '{s.name(a.id)}' by {t.u}px)",
        )


@rule("TEXT_CROWDED", family=FAMILY, severity="warn", thresholds=("crowdedGap", "unit"))
def text_crowded(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """A tangent gap reads as a mistake, not a choice.

    Two text blocks closer than max(u, crowdedGap × the smaller font size) without overlapping.
    """
    for a, b in combinations(s.text_nodes, 2):
        gaps = [(ra.gap(rb), ra, rb) for ra in s.line_rects(a) for rb in s.line_rects(b)]
        gap, ra, rb = min(gaps, key=lambda g: g[0])
        if gap <= 0:
            continue  # overlapping or touching ink: TEXT_OVERLAP's job when it intersects
        sizes = [n.style.size for n in (a, b) if n.style]
        need = max(t.u, t["crowdedGap"] * min(sizes)) if sizes else t.u
        if gap >= need:
            continue
        ia, ib = s.ink(a), s.ink(b)
        first, second = (a, b) if ia.y <= ib.y else (b, a)
        dy = need - gap if ib.v_overlap(ia) <= 0 else 0
        dx = 0 if dy else need - gap
        yield Hit(
            nodes=[a.id, b.id], region=ra.gap_region(rb),
            message=f"'{s.name(a.id)}' and '{s.name(b.id)}' are {gap:.0f}px apart, which reads as touching.",
            measured={"gapPx": round(gap, 1)}, expected={"gapPxMin": round(need, 1)},
            fix=s.move_fix(second.id, dx=dx, dy=dy) + f" (gap ≥ {need:.0f}px), or group them tighter on purpose",
        )


def _text_over(s: MeasuredSlide, t: Thresholds, cover: np.ndarray, what: str,
               other_ids: list[str], obstacle: R | None) -> Iterator[Hit]:
    for n in s.text_nodes:
        ink = s.text_ink_mask(n)
        total = int(ink.sum())
        if not total:
            continue
        over = ink & cover
        pct = 100 * float(over.sum()) / total
        sev = _tier(pct, t["textOver"])
        if not sev:
            continue
        fix = (_clear_of(s, n.id, s.ink(n), obstacle, t.u) if obstacle
               else f"Move '{s.name(n.id)}'")
        yield Hit(
            severity=sev, nodes=[n.id, *other_ids], region=_bbox(over),
            message=f"{pct:.0f} % of '{s.name(n.id)}' lies over {what}.",
            measured={"overPct": round(pct, 1)},
            expected={"warnAbovePct": t["textOver"][0], "errorAbovePct": t["textOver"][1]},
            fix=fix + ", or put a scrim behind the text",
        )


@rule("TEXT_OVER_SUBJECT", family=FAMILY, severity="warn/error", thresholds=("textOver",))
def text_over_subject(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Text on the product hides the product and is hard to read.

    Measures the share of each block's glyph pixels that fall on the subject's silhouette.
    """
    if s.subject_mask is None or s.subject_block is None:
        return
    yield from _text_over(s, t, s.subject_mask, f"the subject '{s.subject_block.name}'",
                          s.subject_block.ids, s.subject_block.rect)


@rule("TEXT_OVER_IMAGE", family=FAMILY, severity="warn/error", thresholds=("textOver",))
def text_over_image(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Text over a picture is hard to read; use a scrim or move the text.

    Measures the share of each block's glyph pixels over an image node's opaque pixels.
    """
    alpha = s.mask("image")
    if alpha is None:
        return
    for img in s.image_nodes:
        cover = (alpha > 0.5) & s.rect_mask([R.of(img.box)])
        if cover.any():
            yield from _text_over(s, t, cover, f"the image '{s.name(img.id)}'", [img.id], s.ink(img))


@rule("SUBJECT_MASKED", family=FAMILY, severity="warn/error", thresholds=("subjectMasked",))
def subject_masked(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """The hero shouldn't be hidden by accident.

    Measures how much of the silhouette is covered by the layers above `render` in layerOrder.
    """
    sub = s.subject_mask
    if sub is None or not sub.any():
        return
    order = s.project.layer_order
    above = order[order.index("render") + 1:]
    cover = np.zeros_like(sub)
    for layer in above:
        m = s.mask(layer)
        if m is not None:
            cover |= m > 0.5
    hidden = sub & cover
    pct = 100 * float(hidden.sum()) / float(sub.sum())
    sev = _tier(pct, t["subjectMasked"])
    if not sev:
        return
    region = _bbox(hidden)
    culprits = [n.id for n in s.measure.nodes if n.layer in above and region
                and R.of(n.box).intersect(region)]
    names = ", ".join(f"'{s.name(i)}'" for i in culprits) or "layers above it"
    yield Hit(
        severity=sev, nodes=[*s.subject_block.ids, *culprits] if s.subject_block else culprits,
        region=region,
        message=f"{pct:.0f} % of the subject is covered by {names}.",
        measured={"maskedPct": round(pct, 1)},
        expected={"warnAbovePct": t["subjectMasked"][0], "errorAbovePct": t["subjectMasked"][1]},
        fix=f"Move {names} off the product, or set {s.camera_height_fix(0.85)} to shrink it into free space",
    )


@rule("SUBJECT_CROPPED", family=FAMILY, severity="warn/info", thresholds=("subjectCrop",))
def subject_cropped(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """A small crop looks like an accident; a big crop looks deliberate.

    Fires when the silhouette touches the canvas edge. The crop size comes from the render
    nodes' projected bounds, which extend past the canvas when the object does.
    """
    sub = s.subject_mask
    if sub is None or s.subject_block is None:
        return
    edges = {"top": sub[0, :].any(), "bottom": sub[-1, :].any(),
             "left": sub[:, 0].any(), "right": sub[:, -1].any()}
    touched = [e for e, hit in edges.items() if hit]
    if not touched:
        return
    full = union_all(R.of(n.box) for n in s.render_nodes)
    inside = s.clip(full) if full else None
    crop = 100 * (1 - inside.area / full.area) if full and inside and full.area else 0.0
    small = crop < t["subjectCrop"]
    yield Hit(
        severity="warn" if small else "info", nodes=s.subject_block.ids,
        region=s.subject_block.rect,
        message=f"The subject is cut by the {', '.join(touched)} edge ({crop:.0f} % cropped).",
        measured={"cropPct": round(crop, 1), "edges": touched},
        expected={"cropPct": f"0 or ≥ {t['subjectCrop']}"},
        fix=(f"Bring it fully into frame: set {s.camera_height_fix(0.85)}" if small
             else "Crop is large enough to read as deliberate; record an exception if intended"),
    )


@rule("TEXT_CLIPPED", family=FAMILY, severity="error")
def text_clipped(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Cut-off text is broken text.

    Fires when the browser reports overflow, or an ink line leaves the canvas.
    """
    canvas = R(0, 0, s.width, s.height)
    for n in s.text_nodes:
        out = [r for r in s.line_rects(n) if r.x < -0.5 or r.y < -0.5
               or r.x1 > canvas.x1 + 0.5 or r.y1 > canvas.y1 + 0.5]
        if not n.overflow and not out:
            continue
        src = s.source(n.id)
        has_box = src is not None and hasattr(src, "box")
        grow = f"set box.h to {min(100.0, src.box.h * 1.3):.1f}" if has_box else "enlarge the box"
        yield Hit(
            nodes=[n.id], region=union_all(out) or R.of(n.box),
            message=f"'{s.name(n.id)}' doesn't fit: its text is cut off.",
            measured={"overflow": bool(n.overflow), "linesOffCanvas": len(out)},
            expected={"overflow": False},
            fix=f"{grow[0].upper()}{grow[1:]}, shorten the text, or lower data.size",
        )


@rule("IN_SAFE_ZONE", family=FAMILY, severity="error")
def in_safe_zone(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """The app's UI will cover anything in a platform safe zone.

    Checks text ink lines and the subject's silhouette against the format's safe zones.
    """
    for z in s.guide.safe_zones:
        zone = R(z.x, z.y, z.w, z.h)
        for n in s.text_nodes:
            hit = union_all(h for r in s.line_rects(n) if (h := r.intersect(zone)) is not None)
            if hit is None:
                continue
            ink = s.ink(n)
            yield Hit(
                nodes=[n.id], region=hit,
                message=f"'{s.name(n.id)}' sits under the {z.name} safe zone, which the app covers.",
                measured={"zone": z.name, "overlapPx": round(hit.area)}, expected={"overlapPx": 0},
                fix=_clear_of(s, n.id, ink, zone, t.u),
            )
        sub = s.subject_mask
        if sub is not None and s.subject_block is not None:
            hit_mask = sub & s.rect_mask([zone])
            if hit_mask.any():
                yield Hit(
                    nodes=s.subject_block.ids, region=_bbox(hit_mask),
                    message=f"The subject reaches into the {z.name} safe zone, which the app covers.",
                    measured={"zone": z.name, "overlapPx": int(hit_mask.sum())},
                    expected={"overlapPx": 0},
                    fix=_clear_of(s, "subject", s.subject_block.rect, zone, t.u)
                    + f", or set {s.camera_height_fix(0.85)}",
                )


@rule("OUTSIDE_MARGIN", family=FAMILY, severity="warn", thresholds=("margin",))
def outside_margin(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Content outside the margin creates edge tension: it feels about to fall off.

    Text ink and image ink only; the ground is exempt, and so are full-bleed images (≥ 95 % of
    the canvas), which act as a background, and blocks already in a safe zone.
    """
    c = s.guide.content
    area = R.from_edges(c["x0"], c["y0"], c["x1"], c["y1"])
    canvas_area = s.width * s.height
    zones = [R(z.x, z.y, z.w, z.h) for z in s.guide.safe_zones]
    for b in s.blocks:
        if b.layer == "render" or any(b.rect.intersect(z) for z in zones):
            continue  # the subject isn't checked; text in a safe zone is IN_SAFE_ZONE's error
        if b.layer == "image" and b.rect.area >= 0.95 * canvas_area:
            continue
        r = b.rect
        dx = max(0.0, area.x - r.x) - max(0.0, r.x1 - area.x1)
        dy = max(0.0, area.y - r.y) - max(0.0, r.y1 - area.y1)
        if abs(dx) < 0.5 and abs(dy) < 0.5:
            continue
        yield Hit(
            nodes=[b.id], region=r,
            message=f"'{b.name}' extends {max(abs(dx), abs(dy)):.0f}px past the {s.guide.m}px margin.",
            measured={"outsidePx": round(max(abs(dx), abs(dy)), 1)}, expected={"marginPx": s.guide.margins},
            fix=s.move_fix(b.id, dx=dx, dy=dy) + " (or narrow its box)",
        )


@rule("EDGES_KISSING", family=FAMILY, severity="warn", thresholds=("edgeKiss",))
def edges_kissing(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Tangency creates visual tension and looks unintended.

    Two elements whose facing edges are within edgeKiss px without overlapping. Text–text pairs
    are TEXT_CROWDED's job and text–subject pairs SUBJECT_CLOSE_TO_TEXT's.
    """
    for a, b in combinations(s.blocks, 2):
        if {a.layer, b.layer} <= {"type", "render"}:
            continue
        if a.rect.intersect(b.rect) is not None:
            continue
        gap = a.rect.gap(b.rect)
        if gap > t["edgeKiss"]:
            continue
        horizontal = a.rect.v_overlap(b.rect) > 0  # side by side → move along x
        first, second = (a, b) if (a.rect.x <= b.rect.x if horizontal else a.rect.y <= b.rect.y) else (b, a)
        push = t.u - gap
        yield Hit(
            nodes=[a.id, b.id], region=a.rect.gap_region(b.rect).expand(2),
            message=f"'{a.name}' and '{b.name}' almost touch ({gap:.0f}px).",
            measured={"gapPx": round(gap, 1)}, expected={"gapPx": f"0 (overlap) or ≥ {t.u}"},
            fix=s.move_fix(second.id, dx=push if horizontal else 0, dy=0 if horizontal else push)
            + f" (≥ {t.u}px apart), or overlap them deliberately",
        )
