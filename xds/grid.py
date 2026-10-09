"""`xds grid`: a copy of an image with a labeled percentage grid, to read positions off it.

For placing things relative to what a picture shows: detection boxes around the cat in a camera
frame, a label next to a part in a product photo, a text block beside the product in a rendered
slide. Lines every `step` % of the image's width and height, labeled in % along the top and left
edges (px = % × the image size it prints), over a slightly dimmed copy so the labels read on any
image.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

from . import project as proj
from .project import XdsError

RASTER = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"}


def grid(root: Path, rel: str, *, step: float = 10, out: Path | None = None) -> dict[str, Any]:
    root = Path(root).resolve()
    src = Path(rel)
    path = src if src.is_absolute() else proj.resolve_inside(root, rel)
    path = path.resolve()
    if root not in path.parents:
        raise XdsError("PATH_ESCAPE", f"'{rel}' is outside the project", status=403)
    if not path.is_file():
        raise XdsError("MISSING_FILE", f"'{rel}' does not exist", status=404)
    if path.suffix.lower() not in RASTER:
        raise XdsError("USAGE", f"'{rel}' is not a raster image ({', '.join(sorted(RASTER))})", status=2)
    if not 1 <= step <= 50:
        raise XdsError("USAGE", "--step is a percentage between 1 and 50", status=2)

    with Image.open(path) as im:
        base = im.convert("RGB")
    w, h = base.size
    # draw at a working size where labels have a sensible size, whatever the source resolution
    k = 1600 / max(w, h) if max(w, h) > 1600 or max(w, h) < 800 else 1.0
    img = base.resize((round(w * k), round(h * k)), Image.LANCZOS) if k != 1 else base
    W, H = img.size
    img = Image.blend(img, Image.new("RGB", img.size, "black"), 0.25)
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    font = ImageFont.load_default(size=max(12, round(min(W, H) / 60)))

    last = {"mt": -1e9, "lm": -1e9}  # the far edge of the previous label on each axis

    def label(xy: tuple[float, float], text: str, anchor: str) -> None:
        box = draw.textbbox(xy, text, font=font, anchor=anchor)
        near, far = (box[0], box[2]) if anchor == "mt" else (box[1], box[3])
        if near < last[anchor] + 6:
            return  # would overlap the previous label: the line still reads from its neighbors
        last[anchor] = far
        draw.rectangle((box[0] - 3, box[1] - 2, box[2] + 3, box[3] + 2), fill=(0, 0, 0, 200))
        draw.text(xy, text, font=font, fill=(255, 220, 90, 255), anchor=anchor)

    n = int(100 // step)
    for i in range(1, n + 1):
        pct = i * step
        if pct >= 100:
            break
        major = abs(pct % (2 * step)) < 1e-9 or abs(pct - 50) < 1e-9
        color = (255, 220, 90, 190) if major else (255, 255, 255, 90)
        x, y = W * pct / 100, H * pct / 100
        draw.line((x, 0, x, H), fill=color, width=2 if major else 1)
        draw.line((0, y, W, y), fill=color, width=2 if major else 1)
        label((x, 4), f"{pct:g}%", "mt")
        label((4, y), f"{pct:g}%", "lm")
    img = Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")

    if out is None:
        out = root / "cache" / "grid" / f"{path.stem}-grid.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)
    return {"png": str(out), "source": str(path), "width": w, "height": h, "step": step}
