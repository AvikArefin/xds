"""Visual saliency (where the eye lands first), using OpenCV's spectral-residual model.

This is the only module that imports cv2, and it does so lazily, so `xds rules` and the
registry stay cheap to import.
"""

from __future__ import annotations

import numpy as np

from .geometry import R

WORK_SIDE = 128  # spectral residual works on a small image; 128 px keeps objects whole and
                 # puts the ringing at hard edges close to them (tuned on synthetic slides)


def saliency_map(rgb: np.ndarray) -> np.ndarray:
    """Saliency in 0..1 at the image's full size. `rgb` is float 0..1, shape (h, w, 3)."""
    import cv2

    h, w = rgb.shape[:2]
    f = WORK_SIDE / max(h, w)
    small = cv2.resize((rgb * 255).astype(np.uint8), (max(1, round(w * f)), max(1, round(h * f))),
                       interpolation=cv2.INTER_AREA)
    model = cv2.saliency.StaticSaliencySpectralResidual_create()
    model.setImageWidth(small.shape[1])
    model.setImageHeight(small.shape[0])
    ok, sal = model.computeSaliency(cv2.cvtColor(small, cv2.COLOR_RGB2BGR))
    if not ok:
        return np.zeros((h, w), dtype=np.float32)
    sal = cv2.GaussianBlur(sal.astype(np.float32), (0, 0), 1)
    sal = cv2.resize(sal, (w, h), interpolation=cv2.INTER_LINEAR)
    top = float(sal.max())
    return sal / top if top > 0 else sal


def halo(shape: tuple[int, ...]) -> int:
    """How far (canvas px) saliency bleeds past an object: the map is computed at WORK_SIDE
    and blurred, so about 4 working pixels."""
    return round(4 * max(shape[:2]) / WORK_SIDE)


def top_mask(sal: np.ndarray, top_pct: float) -> np.ndarray:
    """The `top_pct` % most salient pixels."""
    cut = np.percentile(sal, 100 - top_pct)
    return sal >= cut if cut > 0 else sal > 0


def regions(mask: np.ndarray, sal: np.ndarray, min_share: float = 0.02) -> list[tuple[R, float]]:
    """Connected regions of `mask` with their total saliency, strongest first."""
    import cv2

    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    total = float(sal[mask].sum()) or 1.0
    out = []
    for i in range(1, n):
        mass = float(sal[labels == i].sum())
        if mass / total < min_share:
            continue
        x, y, w, h = (float(v) for v in stats[i, :4])
        out.append((R(x, y, w, h), mass))
    return sorted(out, key=lambda t: -t[1])
