"""Color math for the audit: APCA Lc (0.0.98G-4g), the WCAG 2 ratio, and OKLab lightness.

Everything works on numpy arrays of sRGB values in 0..1, so a whole patch of background pixels
is scored in one call.
"""

from __future__ import annotations

import numpy as np

# --- APCA 0.0.98G-4g constants -----------------------------------------------------------------
MAIN_TRC = 2.4
S_RCO, S_GCO, S_BCO = 0.2126729, 0.7151522, 0.0721750
NORM_BG, NORM_TXT = 0.56, 0.57
REV_TXT, REV_BG = 0.62, 0.65
BLK_THRS, BLK_CLMP = 0.022, 1.414
SCALE_BOW, SCALE_WOB = 1.14, 1.14
LO_BOW_OFFSET, LO_WOB_OFFSET = 0.027, 0.027
DELTA_Y_MIN = 0.0005
LO_CLIP = 0.1


def hex_to_rgb(hex_color: str) -> np.ndarray:
    h = hex_color.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float64) / 255.0


def apca_y(rgb: np.ndarray) -> np.ndarray:
    """APCA screen luminance Y from sRGB in 0..1 (shape (..., 3)), soft-clamped near black."""
    rgb = np.asarray(rgb, dtype=np.float64)
    lin = np.power(np.clip(rgb, 0, 1), MAIN_TRC)
    y = lin[..., 0] * S_RCO + lin[..., 1] * S_GCO + lin[..., 2] * S_BCO
    return np.where(y > BLK_THRS, y, y + np.power(np.clip(BLK_THRS - y, 0, None), BLK_CLMP))


def apca_lc_y(y_txt: np.ndarray | float, y_bg: np.ndarray | float) -> np.ndarray:
    """APCA Lc from two (already soft-clamped) luminances. Positive: dark text on light."""
    y_txt = np.asarray(y_txt, dtype=np.float64)
    y_bg = np.asarray(y_bg, dtype=np.float64)
    normal = (np.power(y_bg, NORM_BG) - np.power(y_txt, NORM_TXT)) * SCALE_BOW
    reverse = (np.power(y_bg, REV_BG) - np.power(y_txt, REV_TXT)) * SCALE_WOB
    out = np.where(
        y_bg > y_txt,
        np.where(normal < LO_CLIP, 0.0, normal - LO_BOW_OFFSET),
        np.where(reverse > -LO_CLIP, 0.0, reverse + LO_WOB_OFFSET),
    )
    out = np.where(np.abs(y_bg - y_txt) < DELTA_Y_MIN, 0.0, out)
    return out * 100.0


def apca_lc(text_rgb: np.ndarray, bg_rgb: np.ndarray) -> np.ndarray:
    """APCA Lc of text color(s) on background color(s), sRGB 0..1."""
    return apca_lc_y(apca_y(text_rgb), apca_y(bg_rgb))


def wcag_luminance(rgb: np.ndarray) -> np.ndarray:
    rgb = np.asarray(rgb, dtype=np.float64)
    lin = np.where(rgb <= 0.04045, rgb / 12.92, np.power((rgb + 0.055) / 1.055, 2.4))
    return lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722


def wcag_ratio(a_rgb: np.ndarray, b_rgb: np.ndarray) -> np.ndarray:
    la, lb = wcag_luminance(a_rgb), wcag_luminance(b_rgb)
    return (np.maximum(la, lb) + 0.05) / (np.minimum(la, lb) + 0.05)


def oklab_l(rgb: np.ndarray) -> np.ndarray:
    """OKLab lightness L (0..1) of sRGB pixels in 0..1."""
    rgb = np.asarray(rgb, dtype=np.float64)
    lin = np.where(rgb <= 0.04045, rgb / 12.92, np.power((rgb + 0.055) / 1.055, 2.4))
    r, g, b = lin[..., 0], lin[..., 1], lin[..., 2]
    l_ = np.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    m_ = np.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    s_ = np.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_


def line_score(text_hex: str, bg_pixels: np.ndarray, worst_pct: float = 10) -> dict[str, float]:
    """Score text over a patch of background pixels at its weakest point.

    Returns the |Lc| at the `worst_pct` percentile (the worst 10 % of pixels by default), and
    the WCAG 2 ratio at the same percentile.
    """
    px = bg_pixels.reshape(-1, 3)
    text = hex_to_rgb(text_hex)
    lc = np.abs(apca_lc(text[None, :], px))
    ratio = wcag_ratio(text[None, :], px)
    return {
        "lc": float(np.percentile(lc, worst_pct)),
        "wcag": float(np.percentile(ratio, worst_pct)),
    }
