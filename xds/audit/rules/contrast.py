"""Contrast and legibility (design-rules §4.4).

Contrast is measured against the actual pixels behind each line (the background-only
composite), at the worst 10 % of them, so a gradient is judged at its weakest point.
"""

from __future__ import annotations

import math
from typing import TYPE_CHECKING, Any, Iterator

import numpy as np

from ..contrast import line_score, oklab_l
from ..geometry import R
from ..registry import Hit, rule

if TYPE_CHECKING:
    from ...models import MeasuredNode
    from ..measured import MeasuredSlide
    from ..thresholds import Thresholds

FAMILY = "contrast"
LC_KEYS = ("contrast.sizes", "contrast.small", "contrast.smallBold", "contrast.boldWeight",
           "contrast.medium", "contrast.large", "contrast.worst")


def _worst_line(s: MeasuredSlide, t: Thresholds, n: MeasuredNode) -> dict[str, Any] | None:
    """The node's line with the lowest Lc margin over its minimum, with its score."""
    key = f"lc:{n.id}"
    if key in s.memo:
        return s.memo[key]
    best = None
    if s.background is not None and n.style:
        displayed = n.style.size * s.guide.k
        lc_min, band = t.lc_band(displayed, n.style.weight)
        for line in n.lines or []:
            patch = s.pixels(s.background, R.of(line.rect))
            if patch is None:
                continue
            score = line_score(n.style.color, patch, t["contrast.worst"])
            if best is None or score["lc"] - lc_min < best["lc"] - best["lcMin"]:
                best = {**score, "lcMin": lc_min, "band": band, "displayedPx": round(displayed, 1),
                        "rect": R.of(line.rect), "patch": patch}
    s.memo[key] = best
    return best


def _better_color(s: MeasuredSlide, t: Thresholds, patch: np.ndarray, current: str) -> tuple[str, float] | None:
    """The brand color that reads best over these pixels."""
    scored = [(c.name, line_score(c.hex, patch, t["contrast.worst"])["lc"])
              for c in s.project.brand.colors if c.hex.lower() != current.lower()]
    return max(scored, key=lambda x: x[1]) if scored else None


def _larger_size(s: MeasuredSlide, t: Thresholds, n: MeasuredNode, lc: float) -> str | None:
    """The smallest data.size, within the level's band, at which `lc` already passes: the next
    size band up has a lower minimum."""
    small, large = t["contrast.sizes"]
    k = s.guide.k or 1
    band = t.band(n.level)
    # medium starts at small (inclusive), large above large (exclusive)
    for size in (math.ceil(small / k - 1e-9), math.floor(large / k + 1e-9) + 1):
        if size <= n.style.size or (band and size > band.max):
            continue
        need, name = t.lc_band(size * k, n.style.weight)
        if lc >= need + t["contrast.marginal"]:
            return f"set data.size to {size} ({name}: Lc ≥ {need:g})"
    return None


def _contrast_hit(s: MeasuredSlide, t: Thresholds, n: MeasuredNode, w: dict[str, Any],
                  severity: str) -> Hit:
    alt = _better_color(s, t, w["patch"], n.style.color)
    if alt and alt[1] >= w["lcMin"]:
        fix = f"Set data.color to '{alt[0]}' (Lc {alt[1]:.0f} here)"
    else:
        fix = "Put a scrim behind the text, or move the block to a calmer, more contrasting part of the background"
        if alt:
            fix = f"Set data.color to '{alt[0]}' (Lc {alt[1]:.0f} here) and add a scrim, or move the block"
    if bigger := _larger_size(s, t, n, w["lc"]):
        fix += f", or {bigger}"
    return Hit(
        severity=severity, nodes=[n.id], region=w["rect"],
        message=(f"'{s.name(n.id)}' reads at Lc {w['lc']:.0f} over its background; at {n.style.size:g} px "
                 f"({w['band']}, {w['displayedPx']:g} px on screen) text needs Lc ≥ {w['lcMin']:.0f}."),
        measured={"lc": round(w["lc"], 1), "wcag": round(w["wcag"], 2), "displayedPx": w["displayedPx"]},
        expected={"lcMin": w["lcMin"], "sizeBand": w["band"]},
        fix=fix,
    )


@rule("LOW_CONTRAST", family=FAMILY, severity="error", thresholds=LC_KEYS)
def low_contrast(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Text must stand out from the pixels behind it, at its weakest point.

    APCA Lc minimum by displayed size (data.size × k, the format's view scale; `xds guide` prints
    the cutoffs in this format's px): < 16 px: 75 (60 if bold); 16–24 px: 60; > 24 px: 45.
    Exactly 24 px is still medium.
    """
    for n in s.reading_text:
        w = _worst_line(s, t, n)
        if w and w["lc"] < w["lcMin"]:
            yield _contrast_hit(s, t, n, w, "error")


@rule("LOW_CONTRAST_MARGINAL", family=FAMILY, severity="warn", thresholds=LC_KEYS + ("contrast.marginal",))
def low_contrast_marginal(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Contrast just above the minimum fails on a dim screen or in a bright room."""
    for n in s.reading_text:
        w = _worst_line(s, t, n)
        if w and w["lcMin"] <= w["lc"] < w["lcMin"] + t["contrast.marginal"]:
            yield _contrast_hit(s, t, n, w, "warn")


@rule("BUSY_BACKGROUND", family=FAMILY, severity="warn",
      thresholds=("busy.lumStd", "busy.edgeDensity", "busy.edgeStep"))
def busy_background(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Keep the background quiet behind text: texture fights the letterforms.

    Under each text block: OKLab lightness std-dev, and the share of Sobel edge pixels.
    """
    if s.background is None:
        return
    for n in s.reading_text:
        ink = s.ink(n)
        patch = s.pixels(s.background, ink)
        if patch is None or min(patch.shape[:2]) < 3:
            continue
        L = oklab_l(patch)
        std = float(L.std())
        gx = (L[:-2, 2:] + 2 * L[1:-1, 2:] + L[2:, 2:] - L[:-2, :-2] - 2 * L[1:-1, :-2] - L[2:, :-2]) / 4
        gy = (L[2:, :-2] + 2 * L[2:, 1:-1] + L[2:, 2:] - L[:-2, :-2] - 2 * L[:-2, 1:-1] - L[:-2, 2:]) / 4
        edges = float((np.hypot(gx, gy) > t["busy.edgeStep"]).mean())
        if std <= t["busy.lumStd"] and edges <= t["busy.edgeDensity"]:
            continue
        yield Hit(
            nodes=[n.id], region=ink,
            message=f"The background behind '{s.name(n.id)}' is busy (lightness std {std:.2f}, edges {edges:.0%}).",
            measured={"lumStd": round(std, 3), "edgeDensity": round(edges, 3)},
            expected={"lumStdMax": t["busy.lumStd"], "edgeDensityMax": t["busy.edgeDensity"]},
            fix="Move the block onto a calmer area, lower the ground design's texture/contrast in data.values, "
                "or add a scrim behind the text",
        )


@rule("DECORATIVE_INVISIBLE", family=FAMILY, severity="info", thresholds=("contrast.decorative",))
def decorative_invisible(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Decorative text is meant to be seen, even if not read."""
    if s.background is None:
        return
    for n in s.text_nodes:
        if not n.decorative or not n.style:
            continue
        scores = [line_score(n.style.color, p, t["contrast.worst"])["lc"]
                  for line in n.lines if (p := s.pixels(s.background, R.of(line.rect))) is not None]
        if not scores or min(scores) >= t["contrast.decorative"]:
            continue
        lc = min(scores)
        yield Hit(
            nodes=[n.id], region=s.ink(n),
            message=f"Decorative '{s.name(n.id)}' is nearly invisible (Lc {lc:.0f}).",
            measured={"lc": round(lc, 1)}, expected={"lcMin": t["contrast.decorative"]},
            fix="Change data.color for more contrast, or remove the node if it isn't meant to show",
        )
