"""Format profiles and the numbers derived from a format (design-rules.md §1).

Everything scales from the short edge `s`, so the same rules work for a 1080 px post and an
A3 poster. Platform UI dimensions change over time: the catalog below is data, and updating a
profile is a one-line change.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

from .models import LEVELS, Format, Level


@dataclass(frozen=True)
class Zone:
    """A region of the canvas the platform's UI covers."""

    name: str
    x: float
    y: float
    w: float
    h: float


@dataclass(frozen=True)
class Profile:
    key: str
    label: str
    group: str  # Social / Video / Print / Custom
    width: int
    height: int
    view_width: float | None  # how wide the image appears on a phone; None for print
    dpi: int | None = None  # print only
    # Edge insets the UI covers (top, right, bottom, left), px.
    insets: tuple[float, float, float, float] = (0, 0, 0, 0)
    # Extra rectangular zones, as fractions-free px rects anchored to the canvas.
    corner_zones: tuple[tuple[str, str, float, float], ...] = ()  # (name, corner, w, h)


def _mm(mm: float, dpi: int) -> float:
    return round(mm / 25.4 * dpi)


CATALOG: dict[str, Profile] = {
    p.key: p
    for p in [
        Profile("instagram-square", "Instagram square", "Social", 1080, 1080, 390),
        Profile("instagram-portrait", "Instagram portrait", "Social", 1080, 1350, 390),
        Profile("instagram-story", "Instagram story", "Social", 1080, 1920, 390,
                insets=(250, 0, 340, 0)),
        Profile("instagram-reel-cover", "Instagram reel cover", "Video", 1080, 1920, 390,
                insets=(250, 120, 420, 0)),
        Profile("linkedin-landscape", "LinkedIn landscape", "Social", 1200, 627, 552),
        Profile("x-landscape", "X landscape", "Social", 1600, 900, 390),
        Profile("youtube-thumbnail", "YouTube thumbnail", "Video", 1280, 720, 360,
                corner_zones=(("duration badge", "bottom-right", 220, 90),)),
        Profile("print-a3", "A3 print (300 dpi)", "Print", 3508, 4961, None, dpi=300,
                insets=(_mm(8, 300),) * 4),  # 3 mm bleed + 5 mm trim-safe
        Profile("print-a4", "A4 print (300 dpi)", "Print", 2480, 3508, None, dpi=300,
                insets=(_mm(8, 300),) * 4),
    ]
}

GENERIC = "generic-screen"


def profile_for(fmt: Format) -> Profile:
    """The profile for a format: its preset, or `generic-screen` (shown 1:1) for a custom size."""
    if fmt.preset and fmt.preset in CATALOG:
        p = CATALOG[fmt.preset]
        if (p.width, p.height) == (fmt.width, fmt.height):
            return p
        # A preset resized by hand keeps its platform data, scaled to the new width.
        f = fmt.width / p.width
        return Profile(p.key, p.label, p.group, fmt.width, fmt.height,
                       p.view_width, p.dpi, tuple(v * f for v in p.insets),  # type: ignore[arg-type]
                       tuple((n, c, w * f, h * f) for n, c, w, h in p.corner_zones))
    return Profile(GENERIC, "Custom size", "Custom", fmt.width, fmt.height, fmt.width)


# --- type bands (design-rules §1.2) ---------------------------------------------------------

@dataclass(frozen=True)
class BandSpec:
    default: float  # fraction of s
    min: float | None  # fraction of s; None → readable(min_readable)
    max: float
    min_readable: float  # screen px this level may never display below
    line_height: tuple[float, float]
    max_lines: int
    chars: tuple[int | None, int | None]  # chars per line (min, max); None = no limit
    lc_min: float  # the guide's contrast summary for the level


BANDS: dict[Level, BandSpec] = {
    "display": BandSpec(0.110, 0.075, 0.20, 12, (0.90, 1.10), 2, (None, None), 45),
    "headline": BandSpec(0.065, 0.050, 0.09, 12, (1.00, 1.20), 3, (None, 24), 45),
    "subhead": BandSpec(0.042, 0.032, 0.05, 12, (1.10, 1.35), 3, (None, 40), 60),
    "body": BandSpec(0.034, None, 0.04, 12, (1.30, 1.60), 6, (25, 55), 75),
    "caption": BandSpec(0.029, None, 0.032, 10, (1.30, 1.60), 3, (None, 60), 75),
}


@dataclass
class Band:
    level: Level
    default: float
    min: float
    max: float
    line_height: tuple[float, float]
    max_lines: int
    chars: tuple[int | None, int | None]
    lc_min: float


@dataclass
class Guide:
    """The numbers for one format. `xds guide` prints it; the audit's thresholds start from it."""

    preset: str
    label: str
    width: int
    height: int
    view_width: float | None
    s: int
    k: float
    u: int
    m: int
    margins: dict[str, int]  # per side: max(m, safe-zone inset)
    content: dict[str, int]  # x0, x1, y0, y1
    spacing_scale: list[int]
    safe_zones: list[Zone]
    bands: dict[str, Band]
    budget: dict[str, int] = field(default_factory=lambda: {
        "wordsPerSlide": 35, "families": 2, "sizes": 4, "blocks": 7})
    subject_height: tuple[float, float] = (30, 75)

    def readable(self, screen_px: float) -> float:
        return screen_px / self.k

    def to_json(self) -> dict[str, Any]:
        d = asdict(self)
        d["percent"] = {
            "m": {"x": round(100 * self.m / self.width, 3), "y": round(100 * self.m / self.height, 3)},
            "u": {"x": round(100 * self.u / self.width, 3), "y": round(100 * self.u / self.height, 3)},
            "margins": {side: round(100 * v / (self.width if side in ("left", "right") else self.height), 3)
                        for side, v in self.margins.items()},
        }
        return d


def round_to(unit: float, value: float) -> int:
    return int(round(value / unit) * unit)


def derive(fmt: Format, overrides: dict[str, Any] | None = None) -> Guide:
    """Derive s, k, u, m, the safe zones and the type bands for a format.

    `overrides` is `project.rules.set`; only the keys that change these numbers are read here
    (`margin` as a fraction of s, `unit` in px). The audit's thresholds read the rest.
    """
    overrides = overrides or {}
    p = profile_for(fmt)
    w, h = fmt.width, fmt.height
    s = min(w, h)
    k = 96 / p.dpi if p.dpi else (p.view_width or w) / w
    u = int(overrides.get("unit") or max(4, round(s / 135)))
    m = max(u, round_to(u, float(overrides.get("margin", 0.06)) * s))

    top, right, bottom, left = p.insets
    zones: list[Zone] = []
    if p.dpi is None:  # print insets are trim-safe margins, not UI
        if top: zones.append(Zone("top UI", 0, 0, w, top))
        if bottom: zones.append(Zone("bottom UI", 0, h - bottom, w, bottom))
        if right: zones.append(Zone("right UI", w - right, 0, right, h))
        if left: zones.append(Zone("left UI", 0, 0, left, h))
    for name, corner, zw, zh in p.corner_zones:
        zx = w - zw if "right" in corner else 0
        zy = h - zh if "bottom" in corner else 0
        zones.append(Zone(name, zx, zy, zw, zh))

    margins = {
        "top": int(max(m, top)), "right": int(max(m, right)),
        "bottom": int(max(m, bottom)), "left": int(max(m, left)),
    }
    content = {"x0": margins["left"], "x1": w - margins["right"],
               "y0": margins["top"], "y1": h - margins["bottom"]}

    def readable(px: float) -> float:
        return px / k

    bands: dict[str, Band] = {}
    for level in LEVELS:
        b = BANDS[level]
        floor_px = readable(b.min_readable)
        lo = max(b.min * s if b.min is not None else 0, floor_px)
        hi = max(b.max * s, lo)
        default = min(max(b.default * s, lo), hi)
        bands[level] = Band(level, round(default), round(lo), round(hi), b.line_height,
                            b.max_lines, b.chars, b.lc_min)

    return Guide(
        preset=p.key, label=p.label, width=w, height=h, view_width=p.view_width,
        s=s, k=round(k, 4), u=u, m=m, margins=margins, content=content,
        spacing_scale=[u * f for f in (1, 2, 3, 4, 6, 8, 12, 16)],
        safe_zones=zones, bands=bands,
    )


def catalog_json() -> list[dict[str, Any]]:
    return [
        {"key": p.key, "label": p.label, "group": p.group, "width": p.width, "height": p.height,
         "viewWidth": p.view_width, "dpi": p.dpi}
        for p in CATALOG.values()
    ]


def format_guide_text(g: Guide) -> str:
    """The `xds guide` table (design-rules §1.3)."""
    viewed = f"viewed ≈{g.view_width:.0f} px wide" if g.view_width else f"print, {round(96 / g.k)} dpi"
    zones = ", ".join(f"{z.name} {z.w:.0f}×{z.h:.0f}" for z in g.safe_zones) or "none"
    lines = [
        f"format       {g.preset} {g.width}×{g.height} ({viewed})",
        f"unit u       {g.u} px      spacing scale: {' '.join(map(str, g.spacing_scale))}",
        f"margin m     {g.m} px     content area: x {g.content['x0']}–{g.content['x1']}, "
        f"y {g.content['y0']}–{g.content['y1']}",
        f"safe zones   {zones}",
        "type         level     default  min  max   line-height  max lines  chars/line",
    ]
    for b in g.bands.values():
        lo, hi = b.chars
        chars = "—" if lo is None and hi is None else (f"≤ {hi}" if lo is None else f"{lo}–{hi}")
        lines.append(
            f"             {b.level:<9} {b.default:<8} {b.min:<4} {b.max:<5} "
            f"{b.line_height[0]:.2f}–{b.line_height[1]:.2f}    {b.max_lines:<10} {chars}"
        )
    bd = g.budget
    lines += [
        f"budget       ≤ {bd['wordsPerSlide']} words per slide · ≤ {bd['families']} font families · "
        f"≤ {bd['sizes']} distinct sizes · ≤ {bd['blocks']} blocks",
        "contrast     body Lc ≥ 75 · subhead Lc ≥ 60 · headline/display Lc ≥ 45",
        f"subject      height {g.subject_height[0]:.0f}–{g.subject_height[1]:.0f}% of canvas · "
        "keep 1u clear of text",
    ]
    return "\n".join(lines)
