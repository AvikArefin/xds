"""Spacing and alignment (design-rules §4.2)."""

from __future__ import annotations

from itertools import combinations
from typing import TYPE_CHECKING, Iterator

from ..geometry import union_all
from ..registry import Hit, rule

if TYPE_CHECKING:
    from ..measured import Block, MeasuredSlide
    from ..thresholds import Thresholds

FAMILY = "spacing"


def _layout_blocks(s: MeasuredSlide) -> list[Block]:
    """Blocks the spacing rules compare: everything but full-bleed images."""
    canvas = s.width * s.height
    return [b for b in s.blocks if not (b.layer == "image" and b.rect.area >= 0.95 * canvas)]


def _stack(blocks: list[Block]) -> list[tuple[Block, Block, float]]:
    """Vertically adjacent pairs (top to bottom, overlapping horizontally) with their gap."""
    out = []
    ordered = sorted(blocks, key=lambda b: b.rect.y)
    for i, a in enumerate(ordered):
        below = [b for b in ordered[i + 1:] if b.rect.h_overlap(a.rect) > 0 and b.rect.y >= a.rect.y1 - 0.5]
        if below:
            b = min(below, key=lambda b: b.rect.y)
            out.append((a, b, max(0.0, b.rect.y - a.rect.y1)))
    return out


def groups(s: MeasuredSlide) -> list[tuple[str, list[Block]]]:
    """Declared groups (TypeData.group), then ungrouped text blocks clustered by vertical gap.

    A stack of ungrouped blocks splits into clusters wherever a gap is more than 1.5× the
    smallest gap in the stack, or more than 6u: blocks that far apart are separate elements,
    not a group with a loose gap.
    """
    if "groups" in s.memo:
        return s.memo["groups"]
    texts = [b for b in s.blocks if b.layer == "type"]
    out: dict[str, list[Block]] = {}
    for b in texts:
        if b.group:
            out.setdefault(b.group, []).append(b)
    result = [(name, members) for name, members in out.items() if len(members) >= 2]
    loose = [b for b in texts if not b.group]
    pairs = _stack(loose)
    if pairs:
        smallest = max(1.0, min(g for _, _, g in pairs))
        clusters: list[list[Block]] = []
        index: dict[str, int] = {}
        for a, b, gap in pairs:
            if gap > 1.5 * smallest or gap > 6 * s.guide.u:
                continue
            ia, ib = index.get(a.id), index.get(b.id)
            if ia is None and ib is None:
                clusters.append([a, b])
                index[a.id] = index[b.id] = len(clusters) - 1
            elif ia is not None and ib is None:
                clusters[ia].append(b)
                index[b.id] = ia
            elif ib is not None and ia is None:
                clusters[ib].append(a)
                index[a.id] = ib
        for c in clusters:
            result.append((" + ".join(f"'{b.name}'" for b in c), c))
    s.memo["groups"] = result
    return result


@rule("ALIGN_NEAR_MISS", family=FAMILY, severity="warn", thresholds=("alignNearMiss",))
def align_near_miss(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Align exactly, or separate clearly.

    Two blocks whose left, center or right edges differ by 1 to u/2 px (and none of them is
    exactly aligned) look like a failed alignment.
    """
    lo, hi = t["alignNearMiss"]
    for a, b in combinations(_layout_blocks(s), 2):
        diffs = {"left": b.rect.x - a.rect.x, "center": b.rect.cx - a.rect.cx, "right": b.rect.x1 - a.rect.x1}
        if any(abs(d) < lo for d in diffs.values()):
            continue
        near = {k: d for k, d in diffs.items() if lo <= abs(d) <= hi}
        if not near:
            continue
        edge, d = min(near.items(), key=lambda kv: abs(kv[1]))
        yield Hit(
            nodes=[a.id, b.id], region=a.rect.union(b.rect),
            message=f"The {edge} edges of '{a.name}' and '{b.name}' miss alignment by {abs(d):.1f}px.",
            measured={"edge": edge, "offsetPx": round(abs(d), 1)}, expected={"offsetPx": f"0 or > {hi}"},
            fix=s.move_fix(b.id, dx=-d) + f" to align its {edge} edge with '{a.name}'",
        )


@rule("MARGIN_NEAR_MISS", family=FAMILY, severity="info", thresholds=("marginNearMiss",))
def margin_near_miss(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Snap to the margin.

    A block edge within u/2 of the margin line, but not on it.
    """
    c = s.guide.content
    for b in _layout_blocks(s):
        r = b.rect
        checks = [("left", c["x0"] - r.x, "x"), ("right", c["x1"] - r.x1, "x"),
                  ("top", c["y0"] - r.y, "y"), ("bottom", c["y1"] - r.y1, "y")]
        for side, d, axis in checks:
            if 1 <= abs(d) <= t["marginNearMiss"]:
                yield Hit(
                    nodes=b.ids, region=r,
                    message=f"The {side} edge of '{b.name}' is {abs(d):.1f}px off the margin.",
                    measured={"side": side, "offsetPx": round(abs(d), 1)}, expected={"offsetPx": 0},
                    fix=s.move_fix(b.id, dx=d if axis == "x" else 0, dy=d if axis == "y" else 0)
                    + " to sit on the margin",
                )
                break


@rule("GROUPING_AMBIGUOUS", family=FAMILY, severity="warn", thresholds=("groupingRatio",))
def grouping_ambiguous(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Gestalt proximity: related things sit closer than unrelated ones.

    The largest gap inside a group must be at most ⅔ of the gap to its nearest outside block.
    Groups come from TypeData.group; ungrouped blocks are clustered by gap.
    """
    blocks = _layout_blocks(s)
    for label, members in groups(s):
        ids = {m.id for m in members}
        inner = max(min(a.rect.gap(b.rect) for b in members if b is not a) for a in members)
        outside = [(a.rect.gap(o.rect), a, o) for a in members for o in blocks if o.id not in ids]
        if not outside:
            continue
        gap_out, a, o = min(outside, key=lambda x: x[0])
        limit = t["groupingRatio"] * gap_out
        if inner <= limit:
            continue
        yield Hit(
            nodes=[*ids, o.id], region=union_all(m.rect for m in members),
            message=(f"Group {label} has an inner gap of {inner:.0f}px but sits only {gap_out:.0f}px "
                     f"from '{o.name}', so it's unclear what belongs together."),
            measured={"innerGapPx": round(inner, 1), "outerGapPx": round(gap_out, 1)},
            expected={"innerGapPxMax": round(limit, 1)},
            fix=(f"Tighten the gaps inside the group to ≤ {limit:.0f}px, or move '{o.name}' to "
                 f"≥ {inner / t['groupingRatio']:.0f}px away"),
        )


@rule("SPACING_INCONSISTENT", family=FAMILY, severity="warn", thresholds=("spacingVariation",))
def spacing_inconsistent(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Rhythm: gaps in one stack should be equal.

    In a stack of ≥ 3 blocks of the same group, gaps that differ by more than 20 %.
    """
    for label, members in groups(s):
        pairs = _stack(members)
        if len(pairs) < 2:
            continue
        gaps = [g for _, _, g in pairs]
        lo, hi = min(gaps), max(gaps)
        if hi <= 0 or (hi - lo) / hi <= t["spacingVariation"]:
            continue
        a, b, _ = max(pairs, key=lambda p: p[2])
        target = round(sum(gaps) / len(gaps) / t.u) * t.u or t.u
        yield Hit(
            nodes=[m.id for m in members], region=union_all(m.rect for m in members),
            message=f"Gaps in group {label} vary from {lo:.0f} to {hi:.0f}px.",
            measured={"gapsPx": [round(g, 1) for g in gaps]},
            expected={"maxVariation": t["spacingVariation"]},
            fix=f"Use one gap ({target}px) between all blocks; e.g. " + s.move_fix(b.id, dy=target - hi),
        )


@rule("SPACING_OFF_SCALE", family=FAMILY, severity="info", thresholds=("unit", "spacingTolerance"))
def spacing_off_scale(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """A consistent spacing scale: vertical gaps are multiples of u.

    Each gap between vertically adjacent text or image blocks should be within spacingTolerance
    px of a multiple of u. Gaps beyond the top of the spacing scale are open space, not rhythm.
    """
    largest = s.guide.spacing_scale[-1]
    for a, b, gap in _stack([b for b in _layout_blocks(s) if b.layer != "render"]):
        if gap <= 0 or gap > largest:
            continue
        nearest = max(t.u, round(gap / t.u) * t.u)
        if abs(gap - nearest) <= t["spacingTolerance"]:
            continue
        yield Hit(
            nodes=[a.id, b.id], region=a.rect.gap_region(b.rect),
            message=f"The {gap:.0f}px gap between '{a.name}' and '{b.name}' is off the {t.u}px scale.",
            measured={"gapPx": round(gap, 1)}, expected={"gapPx": nearest},
            fix=s.move_fix(b.id, dy=nearest - gap) + f" (gap {nearest}px)",
        )


@rule("MARGINS_UNEVEN", family=FAMILY, severity="info", thresholds=("marginsUneven",))
def margins_uneven(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Intentional asymmetry is bigger than a few percent.

    Left/right (or top/bottom) content margins that differ by 5–25 % look accidental.
    """
    content = union_all(b.rect for b in _layout_blocks(s))
    if content is None:
        return
    lo, hi = t["marginsUneven"]
    for axis, near, far in (("x", content.x, s.width - content.x1), ("y", content.y, s.height - content.y1)):
        if max(near, far) <= 0:
            continue
        pct = 100 * abs(near - far) / max(near, far)
        if not lo <= pct <= hi:
            continue
        names = ("left", "right") if axis == "x" else ("top", "bottom")
        shift = (far - near) / 2
        yield Hit(
            region=content, nodes=[b.id for b in _layout_blocks(s)],
            message=f"The {names[0]} and {names[1]} margins differ by {pct:.0f} % ({near:.0f} vs {far:.0f}px).",
            measured={names[0]: round(near), names[1]: round(far), "diffPct": round(pct, 1)},
            expected={"diffPct": f"< {lo} or > {hi}"},
            fix=f"Shift all content {shift:+.0f}px along {axis} to balance it, or make the asymmetry clearly bigger",
        )
