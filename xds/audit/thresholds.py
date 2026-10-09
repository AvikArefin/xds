"""Every number the audit uses (design-rules §4), each with the reason it has that value.

Values start from the format (`formats.derive`), so they scale from a 1080 px post to an A3
poster, and `project.rules.set` overrides them by key. The keys below are the names
`xds rules --json` reports and the only keys `rules.set` accepts. Ranges are `[low, high]`
lists, warn/error tiers are `[warn, error]` lists.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from ..formats import Guide, derive
from ..models import LEVELS, Project


@dataclass(frozen=True)
class Key:
    name: str
    default: Callable[[Guide], Any]
    why: str
    unit: str = ""


def _c(value: Any) -> Callable[[Guide], Any]:
    return lambda g: value


KEYS: list[Key] = [
    # --- format numbers (formats.derive reads these two overrides itself) -----------------
    Key("margin", _c(0.06), "Outer margin as a fraction of the short edge: 6 % is the classic "
        "editorial margin, big enough to frame content on a phone screen.", "× s"),
    Key("unit", lambda g: g.u, "Spacing unit ≈ s/135 (8 px at 1080): every gap is a multiple of it.",
        "px"),
    # --- collision ---------------------------------------------------------------------------
    Key("crowdedGap", _c(0.5), "Two text blocks need a gap of at least half the smaller font "
        "size (and at least u); less reads as a tangent, not a choice.", "× size"),
    Key("textOver", _c([2, 15]), "Share of a block's text ink over the subject or an image: a few "
        "percent is an ascender grazing it (warn); over 15 % the text sits on it (error).", "%"),
    Key("subjectMasked", _c([10, 30]), "Share of the subject's silhouette hidden by layers above "
        "it: 10 % starts to hide the product, 30 % loses it.", "%"),
    Key("subjectCrop", _c(25), "A crop smaller than a quarter of the subject looks accidental; "
        "a bigger one reads as deliberate.", "%"),
    Key("edgeKiss", lambda g: g.u / 2, "Edges closer than half a unit look tangent, not spaced.", "px"),
    # --- spacing -----------------------------------------------------------------------------
    Key("alignNearMiss", lambda g: [1, g.u / 2], "Edges 1 px to u/2 apart look like a failed "
        "alignment; below 1 px is rendering noise, above u/2 is a visible offset.", "px"),
    Key("marginNearMiss", lambda g: g.u / 2, "An edge within u/2 of the margin should sit on it.",
        "px"),
    Key("groupingRatio", _c(2 / 3), "Gestalt proximity: a gap inside a group must be at most ⅔ of "
        "the gap to the nearest unrelated block to read as a group.", "ratio"),
    Key("spacingVariation", _c(0.20), "Gaps in one stack that differ by more than 20 % break the "
        "rhythm.", "ratio"),
    Key("spacingTolerance", _c(2), "A vertical gap within 2 px of a multiple of u is on the scale "
        "(line boxes round to whole pixels).", "px"),
    Key("marginsUneven", _c([5, 25]), "Opposite margins 5–25 % apart look accidental; intentional "
        "asymmetry is bigger than that.", "%"),
    # --- typography --------------------------------------------------------------------------
    Key("hierarchyRatio", _c(1.25), "Neighboring levels need at least a major-third step (1.25) "
        "to read as different levels.", "ratio"),
    Key("sizeNearMiss", _c(8), "Two sizes within 8 % look like a mistake: make them equal or "
        "clearly different.", "%"),
    Key("distinctSizes", _c(4), "More than 4 sizes on one slide blur the hierarchy.", "count"),
    Key("fontFamilies", _c(2), "Two families (a display and a text face) is the classic limit.",
        "count"),
    Key("widowRatio", _c(0.15), "A last line under 15 % of the longest line looks unfinished.",
        "ratio"),
    Key("ragRatio", _c(0.5), "A non-final line under half the longest makes a ragged edge.",
        "ratio"),
    Key("centeredLines", _c(3), "Centered body text beyond 3 lines is hard to read: every line "
        "starts somewhere else.", "lines"),
    Key("capsTracking", _c(0.03), "Capitals need at least 0.03 em of letter spacing below "
        "display sizes.", "em"),
    Key("wordsPerSlide", lambda g: g.budget["wordsPerSlide"], "Social images are glanced at for "
        "about a second: about 35 words is what that allows.", "words"),
    # --- contrast (APCA Lc; sizes are *displayed* px, i.e. size × k) -------------------------
    Key("contrast.sizes", _c([16, 24]), "Displayed size bands for the Lc minimums: below 16 px is "
        "small text, 16–24 px medium, above 24 px large.", "px"),
    Key("contrast.small", _c(75), "APCA's minimum for small body text.", "Lc"),
    Key("contrast.smallBold", _c(60), "Small text at weight ≥ contrast.boldWeight may go to Lc 60.",
        "Lc"),
    Key("contrast.boldWeight", _c(600), "The weight from which small text counts as bold.",
        "weight"),
    Key("contrast.medium", _c(60), "APCA's minimum for 16–24 px text.", "Lc"),
    Key("contrast.large", _c(45), "APCA's minimum for large text and headlines.", "Lc"),
    Key("contrast.marginal", _c(10), "Within 10 Lc of the minimum, a slightly different screen "
        "or a bright room makes it fail.", "Lc"),
    Key("contrast.worst", _c(10), "Each line is judged at its worst 10 % of background pixels, "
        "so a gradient counts at its weakest point.", "%"),
    Key("contrast.decorative", _c(30), "Decorative text below Lc 30 is close to invisible.", "Lc"),
    Key("busy.lumStd", _c(0.12), "Lightness std-dev above 0.12 under text means texture strong "
        "enough to fight the letterforms.", "OKLab L"),
    Key("busy.edgeDensity", _c(0.15), "More than 15 % edge pixels under text is visual noise.",
        "ratio"),
    Key("busy.edgeStep", _c(0.10), "A pixel is an edge when the Sobel lightness gradient is "
        "above 0.10 (a visible step).", "OKLab L"),
    # --- composition -------------------------------------------------------------------------
    Key("attention.top", _c(5), "The 5 % most salient pixels are where the eye lands first.", "%"),
    Key("attention.share", _c(50), "At least half of them should fall on the subject or the "
        "top-level text.", "%"),
    Key("attention.split", _c(0.8), "Two salient regions within 20 % of each other's strength "
        "compete for the first look.", "ratio"),
    Key("kickerGap", _c(1.5), "A smaller block directly above the top block, within 1.5 of its "
        "line heights, is a kicker and reads with it.", "× line height"),
    Key("positionNearMiss", _c([2, 5]), "A center 2–5 % of s off the canvas center or a third "
        "line looks like a missed placement.", "% of s"),
    Key("lopsided", _c(0.2), "A visual-mass centroid more than 0.2 s from center tips the slide.",
        "× s"),
    Key("crowded", _c(65), "Content covering over 65 % of the content area leaves no negative "
        "space.", "%"),
    Key("blocks", lambda g: g.budget["blocks"], "Working memory holds about 7 things.", "count"),
    # --- subject -----------------------------------------------------------------------------
    Key("subject.height", lambda g: list(g.subject_height), "A hero under 30 % of the canvas "
        "height is lost; over 75 % leaves no room for anything else.", "%"),
    Key("subject.highlightL", _c(0.98), "OKLab L above 0.98 is clipped white: no detail left.",
        "OKLab L"),
    Key("subject.overexposed", _c(2), "More than 2 % clipped silhouette pixels is visible as "
        "blown highlights.", "%"),
    Key("subject.darkMedian", _c(0.18), "A median lightness under 0.18 is a dark product…",
        "OKLab L"),
    Key("subject.blackL", _c(0.05), "…and pixels below 0.05 are crushed to black…", "OKLab L"),
    Key("subject.blackShare", _c(25), "…when more than 25 % of them are crushed, the product "
        "reads as a hole.", "%"),
    Key("subject.separation", _c(15), "The silhouette edge needs Lc ≥ 15 against what is just "
        "behind it to separate from the background.", "Lc"),
    Key("subject.textGap", lambda g: g.u, "Keep at least one unit of air between the product and "
        "text.", "px"),
    Key("screen.bodyPx", _c(16), "Phone UI body text is 15–17 CSS px; the audit assumes 16 for "
        "a screen's body text.", "px"),
    Key("screen.readable", _c(9), "Screen body text must display at ≥ 9 px on the device to be "
        "read as text rather than texture.", "px"),
    Key("screen.texelRatio", _c(1.5), "Fewer than 1.5 texture pixels per slide pixel looks soft.",
        "ratio"),
]

# Per-level type bands (design-rules §1.2), overridable as "<level>.size" etc.
for _lvl in LEVELS:
    KEYS += [
        Key(f"{_lvl}.size", (lambda L: lambda g: [g.bands[L].min, g.bands[L].max])(_lvl),
            f"The {_lvl} size band at this format; the min never goes below the readable size.",
            "px"),
        Key(f"{_lvl}.lineHeight", (lambda L: lambda g: list(g.bands[L].line_height))(_lvl),
            f"Line-height range for {_lvl}: display set tight, body set open.", "× size"),
        Key(f"{_lvl}.maxLines", (lambda L: lambda g: g.bands[L].max_lines)(_lvl),
            f"More lines than this and the {_lvl} has become a paragraph.", "lines"),
        Key(f"{_lvl}.chars", (lambda L: lambda g: [c or 0 for c in g.bands[L].chars])(_lvl),
            f"Characters per line for {_lvl} (0 = no limit): a comfortable measure.", "chars"),
    ]

KEY_NAMES: frozenset[str] = frozenset(k.name for k in KEYS)
_BY_NAME = {k.name: k for k in KEYS}


@dataclass
class Band:
    level: str
    min: float
    max: float
    line_height: tuple[float, float]
    max_lines: int
    chars: tuple[int | None, int | None]


class Thresholds:
    """Resolved threshold values for one project: `t["key"]`, plus the guide and level bands."""

    def __init__(self, guide: Guide, overrides: dict[str, Any] | None = None):
        self.guide = guide
        self.values: dict[str, Any] = {k.name: k.default(guide) for k in KEYS}
        for key, value in (overrides or {}).items():
            if key in self.values:
                self.values[key] = value

    def __getitem__(self, key: str) -> Any:
        return self.values[key]

    @property
    def u(self) -> int:
        return self.guide.u

    def band(self, level: str | None) -> Band | None:
        if level not in self.guide.bands:
            return None
        lo, hi = self[f"{level}.size"]
        clo, chi = self[f"{level}.chars"]
        lh = self[f"{level}.lineHeight"]
        return Band(level, float(lo), float(hi), (float(lh[0]), float(lh[1])),
                    int(self[f"{level}.maxLines"]), (int(clo) or None, int(chi) or None))

    def lc_min(self, displayed_px: float, weight: float) -> float:
        """Design-rules §4.4: the Lc minimum for a line at its displayed size."""
        return self.lc_band(displayed_px, weight)[0]

    def lc_band(self, displayed_px: float, weight: float) -> tuple[float, str]:
        """The Lc minimum for a displayed size and weight, and the size band it comes from, named
        in this format's own px (what `data.size` is written in), e.g. "16–24 px"."""
        small, large = self["contrast.sizes"]
        k = self.guide.k or 1
        if displayed_px < small:
            bold = weight >= self["contrast.boldWeight"]
            return (self["contrast.smallBold"] if bold else self["contrast.small"],
                    f"size < {_px(small / k)}" + (f", weight ≥ {self['contrast.boldWeight']:g}" if bold else ""))
        if displayed_px <= large:
            return self["contrast.medium"], f"size {_n(small / k)}–{_px(large / k)}"
        return self["contrast.large"], f"size > {_px(large / k)}"

    def contrast_bands(self) -> list[dict[str, Any]]:
        """Every Lc minimum with the sizes it applies to, in this format's px and on screen."""
        small, large = self["contrast.sizes"]
        k = self.guide.k or 1
        bw = self["contrast.boldWeight"]
        return [
            {"lcMin": self["contrast.large"], "sizeAbove": round(large / k, 1), "screenAbove": large},
            {"lcMin": self["contrast.medium"], "sizeFrom": round(small / k, 1), "sizeTo": round(large / k, 1),
             "screenFrom": small, "screenTo": large},
            {"lcMin": self["contrast.small"], "sizeBelow": round(small / k, 1), "screenBelow": small},
            {"lcMin": self["contrast.smallBold"], "sizeBelow": round(small / k, 1), "screenBelow": small,
             "weightFrom": bw},
        ]

    def contrast_text(self) -> str:
        """One line for `xds guide`: the Lc minimums by size, in this format's px."""
        small, large = self["contrast.sizes"]
        k = self.guide.k or 1
        shown = "" if abs(k - 1) < 1e-6 else f" (= {small:g} and {large:g} px on screen)"
        return (f"text size > {_px(large / k)}: Lc ≥ {self['contrast.large']:g} · "
                f"{_n(small / k)}–{_px(large / k)}: Lc ≥ {self['contrast.medium']:g} · "
                f"< {_px(small / k)}: Lc ≥ {self['contrast.small']:g} "
                f"({self['contrast.smallBold']:g} at weight ≥ {self['contrast.boldWeight']:g}){shown}")


def _n(v: float) -> str:
    return f"{v:.1f}".rstrip("0").rstrip(".")


def _px(v: float) -> str:
    return _n(v) + " px"


def build(project: Project) -> Thresholds:
    overrides = dict(project.rules.set) if project.rules else {}
    return Thresholds(derive(project.format, overrides), overrides)


def describe(key: str, value: Any) -> dict[str, Any]:
    k = _BY_NAME[key]
    return {"key": key, "value": value, "unit": k.unit, "why": k.why}
