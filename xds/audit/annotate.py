"""Annotated slide PNGs (design-rules §6): every finding's region in its severity color with its
number, plus the margin, the safe zones and the third lines."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from ..formats import Guide
from ..models import Finding

COLORS = {
    "error": (229, 72, 77, 255),
    "warn": (245, 165, 36, 255),
    "info": (62, 142, 247, 255),
    "waived": (150, 150, 150, 255),
}
MARGIN = (0, 200, 200, 160)
THIRDS = (128, 128, 128, 140)  # mid-gray: visible on light and dark slides
SAFE_FILL = (229, 72, 77, 50)


def _font(size: int) -> ImageFont.ImageFont:
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # older Pillow
        return ImageFont.load_default()


def _overlaps(a: tuple[float, ...], b: tuple[float, ...]) -> bool:
    return a[0] < b[2] + 4 and b[0] < a[2] + 4 and a[1] < b[3] + 4 and b[1] < a[3] + 4


def annotate(base: Path | None, guide: Guide, findings: list[tuple[int, Finding]], out: Path) -> Path:
    """Draw `findings` (with their report numbers, 1-based) over the slide PNG at `base`."""
    if base is not None and base.exists():
        img = Image.open(base).convert("RGBA")
    else:
        img = Image.new("RGBA", (guide.width, guide.height), (40, 40, 40, 255))
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    w, h = img.size
    line = max(2, guide.s // 400)

    for z in guide.safe_zones:
        d.rectangle([z.x, z.y, z.x + z.w, z.y + z.h], fill=SAFE_FILL, outline=COLORS["error"], width=line)
    for i in (1, 2):
        d.line([(w * i / 3, 0), (w * i / 3, h)], fill=THIRDS, width=1)
        d.line([(0, h * i / 3), (w, h * i / 3)], fill=THIRDS, width=1)
    c = guide.content
    d.rectangle([c["x0"], c["y0"], c["x1"], c["y1"]], outline=MARGIN, width=line)

    font_px = max(14, guide.s // 45)
    font = _font(font_px)
    unplaced = 0
    placed: list[tuple[float, float, float, float]] = []
    rank = {"info": 0, "warn": 1, "error": 2}  # draw errors last, on top
    for number, f in sorted(findings, key=lambda nf: (nf[1].status != "waived", rank[nf[1].severity])):
        color = COLORS["waived" if f.status == "waived" else f.severity]
        label = str(number)
        if f.region is not None:
            r = f.region
            d.rectangle([r.x, r.y, r.x + max(r.w, 1), r.y + max(r.h, 1)], outline=color, width=line * 2)
            x, y = r.x, max(0.0, r.y - font_px - 6)
        else:
            x, y = 8, 8 + unplaced * (guide.s // 30)
            unplaced += 1
            label = f"{number} {f.rule}"
        tb = d.textbbox((x, y), label, font=font)
        while any(_overlaps(tb, used) for used in placed):  # don't hide an earlier label
            x += tb[2] - tb[0] + 8
            tb = d.textbbox((x, y), label, font=font)
        placed.append(tb)
        d.rectangle([tb[0] - 3, tb[1] - 3, tb[2] + 3, tb[3] + 3], fill=color)
        d.text((x, y), label, fill=(255, 255, 255, 255), font=font)

    out.parent.mkdir(parents=True, exist_ok=True)
    Image.alpha_composite(img, overlay).convert("RGB").save(out)
    return out
