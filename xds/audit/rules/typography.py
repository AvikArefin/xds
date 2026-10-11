"""Typography (design-rules §4.3). Decorative text is exempt from these rules, and `expressive`
lettering from the measure and rag rules (LINE_LENGTH, WIDOW, BAD_RAG): it is a graphic, judged
by the expression rules (§8) instead."""

from __future__ import annotations

from typing import TYPE_CHECKING, Iterator

from ...models import LEVELS
from ..geometry import R, union_all
from ..measured import LEVEL_RANK
from ...models import Edit
from ..registry import Hit, rule

if TYPE_CHECKING:
    from ...models import MeasuredNode
    from ..measured import MeasuredSlide
    from ..thresholds import Thresholds

FAMILY = "type"
SIZE_KEYS = tuple(f"{lvl}.size" for lvl in LEVELS)


def _sizes(s: MeasuredSlide) -> list[tuple[float, list[MeasuredNode]]]:
    """Distinct font sizes on the slide (within 0.5 px), ascending, with their nodes."""
    out: list[tuple[float, list[MeasuredNode]]] = []
    for n in sorted(s.reading_text, key=lambda n: n.style.size):
        if out and n.style.size - out[-1][0] <= 0.5:
            out[-1][1].append(n)
        else:
            out.append((n.style.size, [n]))
    return out


def _names(s: MeasuredSlide, nodes: list[MeasuredNode]) -> str:
    return ", ".join(f"'{s.name(n.id)}'" for n in nodes)


def _region(s: MeasuredSlide, nodes: list[MeasuredNode]) -> R | None:
    return union_all(s.ink(n) for n in nodes)


@rule("TEXT_TOO_SMALL", family=FAMILY, severity="error", thresholds=SIZE_KEYS)
def text_too_small(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Legibility on the device: text below its level's minimum can't be read where it's seen.

    The minimum is never below the readable size for the format's viewing width.
    """
    for n in s.reading_text:
        band = t.band(n.level)
        if band and n.style.size < band.min - 0.5:
            yield Hit(
                nodes=[n.id], region=s.ink(n),
                message=(f"'{s.name(n.id)}' is {n.style.size:.0f}px ({n.style.size * s.guide.k:.1f}px on the "
                         f"device), below the {n.level} minimum of {band.min:.0f}px."),
                measured={"sizePx": n.style.size, "displayedPx": round(n.style.size * s.guide.k, 1)},
                expected={"sizePxMin": band.min},
                fix=f"Set data.size to {band.min:.0f} ({n.level} min)",
                edits=[Edit(node_id=n.id, path="data.size", value=float(f"{band.min:.0f}"))],
            )


@rule("TEXT_TOO_LARGE", family=FAMILY, severity="warn", thresholds=SIZE_KEYS)
def text_too_large(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Text above its level's maximum means the level is wrong, or the role is."""
    for n in s.reading_text:
        band = t.band(n.level)
        if band and n.style.size > band.max + 0.5:
            higher = [lv for lv in LEVELS if LEVEL_RANK[lv] < LEVEL_RANK[n.level]]
            alt = f", or use a {higher[-1]} role in data.role" if higher else ""
            yield Hit(
                nodes=[n.id], region=s.ink(n),
                message=f"'{s.name(n.id)}' is {n.style.size:.0f}px, above the {n.level} maximum of {band.max:.0f}px.",
                measured={"sizePx": n.style.size}, expected={"sizePxMax": band.max},
                fix=f"Set data.size to {band.max:.0f} ({n.level} max){alt}",
                edits=[Edit(node_id=n.id, path="data.size", value=float(f"{band.max:.0f}"))],
            )


@rule("HIERARCHY_WEAK", family=FAMILY, severity="warn", thresholds=("hierarchyRatio", "sizeNearMiss"))
def hierarchy_weak(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Levels must be clearly different to read as levels.

    Two adjacent sizes on a slide with a ratio under hierarchyRatio. Ratios within sizeNearMiss
    are reported by SIZE_NEAR_MISS instead.
    """
    sizes = _sizes(s)
    for (small, sn), (big, bn) in zip(sizes, sizes[1:]):
        ratio = big / small
        if ratio < 1 + t["sizeNearMiss"] / 100 or ratio >= t["hierarchyRatio"]:
            continue
        up = small * t["hierarchyRatio"]
        band = t.band(bn[0].level)
        if band and up <= band.max:
            fix = f"Set data.size of {_names(s, bn)} to {up:.0f}"
            edits = [Edit(node_id=n.id, path="data.size", value=float(f"{up:.0f}")) for n in bn]
        else:
            fix = f"Set data.size of {_names(s, sn)} to {big / t['hierarchyRatio']:.0f}"
            edits = [Edit(node_id=n.id, path="data.size", value=float(f"{big / t['hierarchyRatio']:.0f}")) for n in sn]
        yield Hit(
            nodes=[n.id for n in sn + bn], region=_region(s, sn + bn),
            message=f"{_names(s, bn)} ({big:.0f}px) and {_names(s, sn)} ({small:.0f}px) differ by only ×{ratio:.2f}.",
            measured={"ratio": round(ratio, 3), "sizesPx": [small, big]},
            expected={"ratioMin": t["hierarchyRatio"]},
            fix=fix + f" (ratio ≥ {t['hierarchyRatio']})", edits=edits,
        )


@rule("SIZE_NEAR_MISS", family=FAMILY, severity="warn", thresholds=("sizeNearMiss",))
def size_near_miss(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Make two sizes the same, or clearly different.

    Two sizes within sizeNearMiss % of each other but not equal.
    """
    sizes = _sizes(s)
    for (small, sn), (big, bn) in zip(sizes, sizes[1:]):
        pct = 100 * (big - small) / small
        if pct >= t["sizeNearMiss"]:
            continue
        keep, change = (bn, sn) if len(bn) >= len(sn) else (sn, bn)
        yield Hit(
            nodes=[n.id for n in sn + bn], region=_region(s, sn + bn),
            message=f"{_names(s, sn)} ({small:.1f}px) and {_names(s, bn)} ({big:.1f}px) are nearly the same size.",
            measured={"sizesPx": [small, big], "diffPct": round(pct, 1)},
            expected={"diffPct": f"0 or ≥ {t['sizeNearMiss']}"},
            fix=f"Set data.size of {_names(s, change)} to {keep[0].style.size:.0f} to match",
            edits=[Edit(node_id=n.id, path="data.size", value=float(f"{keep[0].style.size:.0f}")) for n in change],
        )


@rule("TOO_MANY_SIZES", family=FAMILY, severity="warn", thresholds=("distinctSizes",))
def too_many_sizes(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Too many sizes on one slide blur the hierarchy."""
    sizes = _sizes(s)
    if len(sizes) <= t["distinctSizes"]:
        return
    yield Hit(
        nodes=[n.id for _, ns in sizes for n in ns],
        message=f"The slide uses {len(sizes)} text sizes: {', '.join(f'{v:.0f}' for v, _ in sizes)}px.",
        measured={"sizes": len(sizes)}, expected={"sizesMax": t["distinctSizes"]},
        fix=f"Remove data.size overrides so blocks follow their role sizes (≤ {t['distinctSizes']} sizes)",
    )


@rule("TOO_MANY_FAMILIES", family=FAMILY, severity="warn", thresholds=("fontFamilies",))
def too_many_families(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """A display face and a text face are enough; more families look unplanned."""
    fams: dict[str, list[str]] = {}
    for n in s.text_nodes:
        if n.style:
            fams.setdefault(n.style.font, []).append(n.id)
    if len(fams) <= t["fontFamilies"]:
        return
    yield Hit(
        nodes=[i for ids in fams.values() for i in ids],
        message=f"The slide uses {len(fams)} font families: {', '.join(fams)}.",
        measured={"families": sorted(fams)}, expected={"familiesMax": t["fontFamilies"]},
        fix=f"Give these roles ≤ {t['fontFamilies']} families (brand.typography[role].font)",
    )


@rule("LINE_LENGTH", family=FAMILY, severity="warn", thresholds=tuple(f"{lv}.chars" for lv in LEVELS))
def line_length(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """A comfortable measure: lines neither too long to track nor too short to flow.

    Characters per line against the level's range. Final lines are only checked for length,
    not shortness.
    """
    for n in s.reading_text:
        band = t.band(n.level)
        if not band or n.level == "expressive":
            continue
        lo, hi = band.chars
        lines = n.lines or []
        counts = [len(line.text.strip()) for line in lines]
        long = [c for c in counts if hi and c > hi]
        short = [c for c in counts[:-1] if lo and c < lo]
        if not long and not short:
            continue
        src = s.source(n.id)
        if long:
            worst, target = max(long), hi
        else:
            worst, target = min(short), lo
        width = (f"set box.w to {src.box.w * target / max(worst, 1):.1f}"
                 if src is not None and hasattr(src, "box") else "change the box width")
        yield Hit(
            nodes=[n.id], region=s.ink(n),
            message=f"'{s.name(n.id)}' has lines of {worst} characters; {n.level} reads best at "
                    f"{lo or 0}–{hi or '∞'}.",
            measured={"charsPerLine": counts}, expected={"chars": [lo, hi]},
            fix=f"{width[0].upper()}{width[1:]} (≈ {target} chars per line)",
        )


@rule("TOO_MANY_LINES", family=FAMILY, severity="warn", thresholds=tuple(f"{lv}.maxLines" for lv in LEVELS))
def too_many_lines(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """A headline that needs five lines is body text."""
    for n in s.reading_text:
        band = t.band(n.level)
        if band and len(n.lines) > band.max_lines:
            yield Hit(
                nodes=[n.id], region=s.ink(n),
                message=f"'{s.name(n.id)}' runs to {len(n.lines)} lines; {n.level} allows {band.max_lines}.",
                measured={"lines": len(n.lines)}, expected={"linesMax": band.max_lines},
                fix=f"Shorten data.text to ≤ {band.max_lines} lines, widen box.w, or use a lower-level data.role",
            )


@rule("LINE_HEIGHT", family=FAMILY, severity="warn", thresholds=tuple(f"{lv}.lineHeight" for lv in LEVELS))
def line_height(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Display text set tight, body text set open.

    Measured from the baseline distance of multi-line blocks (one line has no visible leading).
    """
    for n in s.reading_text:
        band = t.band(n.level)
        if not band or len(n.lines) < 2:
            continue
        steps = sorted(b.baseline - a.baseline for a, b in zip(n.lines, n.lines[1:]))
        ratio = steps[len(steps) // 2] / n.style.size
        lo, hi = band.line_height
        if lo - 0.01 <= ratio <= hi + 0.01:
            continue
        target = min(max(ratio, lo), hi)
        yield Hit(
            nodes=[n.id], region=s.ink(n),
            message=f"'{s.name(n.id)}' is set at line height {ratio:.2f}; {n.level} wants {lo:.2f}–{hi:.2f}.",
            measured={"lineHeight": round(ratio, 3)}, expected={"lineHeight": [lo, hi]},
            fix=f"Set data.lineHeight to {target:.2f}",
            edits=[Edit(node_id=n.id, path="data.lineHeight", value=round(target, 2))],
        )


@rule("WIDOW", family=FAMILY, severity="warn", thresholds=("widowRatio",))
def widow(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """A one-word or very short last line looks ragged and unfinished.

    A last line the author forced with an explicit '\\n' is deliberate and not reported.
    """
    for n in s.reading_text:
        lines = n.lines
        if len(lines) < 2 or n.level == "expressive":
            continue
        last = lines[-1]
        longest = max(line.rect.w for line in lines)
        words = last.text.split()
        ratio = last.rect.w / longest if longest else 1
        if len(words) > 1 and ratio >= t["widowRatio"]:
            continue
        src = s.source(n.id)
        if src is not None and "\n" in src.data.text and \
                src.data.text.split("\n")[-1].strip() == last.text.strip():
            continue  # the author broke the line there on purpose
        prev = lines[-2].text.split()
        hint = f"before '{prev[-1]}'" if prev else "earlier"
        yield Hit(
            nodes=[n.id], region=R.of(last.rect),
            message=f"'{s.name(n.id)}' ends with a widow: '{last.text.strip()}' alone on the last line.",
            measured={"lastLineWords": len(words), "lastLineRatio": round(ratio, 2)},
            expected={"lastLineWordsMin": 2, "lastLineRatioMin": t["widowRatio"]},
            fix=(f"Set data.wrap to 'pretty' (or 'balance' for a headline), add a '\\n' in data.text {hint}, "
                 "or change box.w slightly"),
        )


@rule("BAD_RAG", family=FAMILY, severity="info", thresholds=("ragRatio",))
def bad_rag(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """An uneven edge: in left/right-aligned text, a short non-final line breaks the shape."""
    for n in s.reading_text:
        if n.align == "center" or len(n.lines) < 3 or n.level == "expressive":
            continue
        longest = max(line.rect.w for line in n.lines)
        short = [line for line in n.lines[:-1] if line.rect.w < t["ragRatio"] * longest]
        if not short:
            continue
        yield Hit(
            nodes=[n.id], region=R.of(short[0].rect),
            message=f"'{s.name(n.id)}' has a short line ('{short[0].text.strip()}') in the middle of the block.",
            measured={"lineRatio": round(short[0].rect.w / longest, 2)}, expected={"lineRatioMin": t["ragRatio"]},
            fix="Rebreak with '\\n' in data.text or adjust box.w",
        )


@rule("CENTERED_LONG_TEXT", family=FAMILY, severity="warn", thresholds=("centeredLines",))
def centered_long_text(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Centered paragraphs are hard to read: every line starts in a different place."""
    for n in s.reading_text:
        if n.align == "center" and n.level in ("body", "caption") and len(n.lines) > t["centeredLines"]:
            yield Hit(
                nodes=[n.id], region=s.ink(n),
                message=f"'{s.name(n.id)}' is {len(n.lines)} lines of centered {n.level} text.",
                measured={"lines": len(n.lines)}, expected={"linesMax": t["centeredLines"]},
                fix="Set data.align to 'left'",
                edits=[Edit(node_id=n.id, path="data.align", value="left")],
            )


@rule("CAPS_UNTRACKED", family=FAMILY, severity="warn", thresholds=("capsTracking",))
def caps_untracked(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Capitals need air: uppercase text below display sizes needs letter spacing."""
    for n in s.reading_text:
        st = n.style
        if st.uppercase and n.level in ("subhead", "body", "caption") and st.letter_spacing < t["capsTracking"]:
            yield Hit(
                nodes=[n.id], region=s.ink(n),
                message=f"'{s.name(n.id)}' is set in capitals with {st.letter_spacing:.2f} em letter spacing.",
                measured={"letterSpacing": st.letter_spacing}, expected={"letterSpacingMin": t["capsTracking"]},
                fix=f"Set data.letterSpacing to {max(0.05, t['capsTracking']):.2f}",
                edits=[Edit(node_id=n.id, path="data.letterSpacing", value=round(max(0.05, t["capsTracking"]), 2))],
            )


@rule("TOO_MANY_WORDS", family=FAMILY, severity="warn", thresholds=("wordsPerSlide",))
def too_many_words(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Social images are glanced at for about a second: say less."""
    nodes = [n for n in s.text_nodes if not n.decorative]
    words = sum(len(line.text.split()) for n in nodes for line in n.lines)
    limit = t["wordsPerSlide"]
    if words <= limit:
        return
    yield Hit(
        nodes=[n.id for n in nodes],
        message=f"The slide has {words} words; it will be glanced at, not read.",
        measured={"words": words}, expected={"wordsMax": limit},
        fix=f"Cut {words - limit:.0f} words from data.text (≤ {limit:.0f}), or split the slide",
    )
