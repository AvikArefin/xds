"""Write the shipped layouts (xds/library/layouts/<id>.json) from one description, so they share
their vocabulary and conventions. Run it from the checkout after editing: `python3 scripts/build_library_layouts.py`.

A layout is written only with relations and unit-based numbers (docs/layouts.md): pins to the
format's lines, stacks, aligns, fit to text, flow groups, `scale` rather than px sizes. Boxes
carry only the width (or height) a relation does not decide.
"""

from __future__ import annotations

import json
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "xds" / "library" / "layouts"

M = {"to": "margin"}
FIT = {"fit": "text"}


def pin(**edges):
    return {"pin": {e: ({"to": v} if isinstance(v, str) else v) for e, v in edges.items()}}


def text(id, slot, level, w, h=8, text=None, layout=None, variants=None, **data):
    n = {"id": id, "slot": slot, "level": level, "layer": "type", "box": {"x": 0, "y": 0, "w": w, "h": h}}
    if layout:
        n["layout"] = layout
    d = {"text": text} if text is not None else {}
    d.update(data)
    n["data"] = d
    if variants:
        n["variants"] = variants
    return n


def shape(id, kind, w, h, layout, stroke=0.5, fill=None, params=None, variants=None):
    d = {"shape": kind, "stroke": {"width": stroke}}
    if fill:
        d["fill"] = fill
    if params:
        d["params"] = params
    n = {"id": id, "slot": "ornament", "layer": "image", "box": {"x": 0, "y": 0, "w": w, "h": h},
         "layout": layout, "data": d}
    if variants:
        n["variants"] = variants
    return n


def logo(w=12, h=6, layout=None, variants=None):
    n = {"id": "logo", "slot": "logo", "layer": "image", "box": {"x": 0, "y": 0, "w": w, "h": h},
         "layout": layout, "data": {"asset": "@logo", "fit": "contain"}}
    if variants:
        n["variants"] = variants
    return n


L: dict[str, dict] = {}

L["hero-left"] = {
    "name": "Hero, left",
    "intent": "A launch post: one message top-left, the product on the right, a call to action at the foot.",
    "description": "A kicker, headline and subhead flow as a column pinned to the top-left margin; the call to "
                   "action sits on the bottom margin; the product takes the right half.",
    "groups": {"intro": {"direction": "column", "gap": 3, "align": "start", **pin(left="margin", top="margin")}},
    "subject": {"place": {"x": 72, "y": 58, "height": 55},
                "variants": {"landscape": {"place": {"x": 74, "y": 55, "height": 72}},
                             "story": {"place": {"x": 50, "y": 64, "height": 40}}}},
    "nodes": [
        text("kicker", "kicker", "caption", 50, 4, layout={"group": "intro", **FIT}, uppercase=True, letterSpacing=0.08),
        text("headline", "headline", "headline", 58, 18, layout={"group": "intro", **FIT}, wrap="balance",
             variants={"landscape": {"box": {"w": 44}}, "story": {"box": {"w": 80}}}),
        text("subhead", "subhead", "subhead", 50, 10, layout={"group": "intro", **FIT}, wrap="pretty",
             variants={"landscape": {"box": {"w": 40}}, "story": {"box": {"w": 70}}}),
        text("cta", "cta", "body", 40, 6, layout={**pin(left="margin", bottom="margin"), **FIT}, weight=700),
    ]}

L["hero-centered"] = {
    "name": "Hero, centered",
    "intent": "One statement over the product, everything on the center line.",
    "description": "Headline and subhead centered as a column on the top margin; the product below them; the call "
                   "to action on the bottom margin.",
    "groups": {"intro": {"direction": "column", "gap": 2, "align": "center", **pin(cx="center", top="margin")}},
    "subject": {"place": {"x": 50, "y": 62, "height": 46},
                "variants": {"landscape": {"place": {"x": 50, "y": 60, "height": 52}},
                             "story": {"place": {"x": 50, "y": 60, "height": 36}}}},
    "nodes": [
        text("headline", "headline", "headline", 80, 18, layout={"group": "intro", **FIT}, align="center", wrap="balance",
             variants={"landscape": {"box": {"w": 60}}}),
        text("subhead", "subhead", "subhead", 64, 10, layout={"group": "intro", **FIT}, align="center", wrap="pretty",
             variants={"landscape": {"box": {"w": 50}}}),
        text("cta", "cta", "body", 40, 6, layout={**pin(cx="center", bottom="margin"), **FIT}, align="center", weight=700),
    ]}


def split(side: str) -> dict:
    other = "right" if side == "left" else "left"
    sx = 73 if side == "left" else 27
    return {
        "name": f"Split, text {side}",
        "intent": f"Text on the {side}, the product on the {other}: a feature or comparison slide.",
        "description": f"A column of headline, subhead and call to action pinned to the {side} margin and centered "
                       f"vertically; the product fills the {other} half.",
        "groups": {"copy": {"direction": "column", "gap": 3, "align": "start" if side == "left" else "end",
                            **pin(**{side: "margin", "cy": "center"})}},
        "subject": {"place": {"x": sx, "y": 55, "height": 66},
                    "variants": {"landscape": {"place": {"x": sx, "y": 55, "height": 80}},
                                 "story": {"place": {"x": 50, "y": 70, "height": 40}}}},
        "nodes": [
            text("headline", "headline", "headline", 42, 18, layout={"group": "copy", **FIT}, align=side, wrap="balance",
                 variants={"landscape": {"box": {"w": 40}}, "story": {"box": {"w": 80}}}),
            text("subhead", "subhead", "subhead", 40, 10, layout={"group": "copy", **FIT}, align=side, wrap="pretty",
                 variants={"landscape": {"box": {"w": 36}}, "story": {"box": {"w": 70}}}),
            text("cta", "cta", "body", 36, 6, layout={"group": "copy", **FIT}, align=side, weight=700),
        ]}


L["split-left"] = split("left")
L["split-right"] = split("right")

L["stacked-centered"] = {
    "name": "Stacked, centered",
    "intent": "Headline above, product in the middle, action below: the classic product post.",
    "description": "The headline on the top margin, the product centered, the call to action on the bottom margin, "
                   "all on the center line.",
    "subject": {"place": {"x": 50, "y": 52, "height": 42},
                "variants": {"landscape": {"place": {"x": 50, "y": 56, "height": 52}},
                             "story": {"place": {"x": 50, "y": 52, "height": 34}}}},
    "nodes": [
        text("headline", "headline", "headline", 80, 16, layout={**pin(cx="center", top="margin"), **FIT}, align="center",
             wrap="balance", variants={"landscape": {"box": {"w": 60}}}),
        text("cta", "cta", "body", 40, 6, layout={**pin(cx="center", bottom="margin"), **FIT}, align="center", weight=700),
    ]}

L["caption-bottom"] = {
    "name": "Caption at the bottom",
    "intent": "A full-bleed product shot with the message on a plate at the foot, clear of the platform's UI.",
    "description": "The product fills the slide; a headline on a plate and a body line flow as a column pinned to "
                   "the bottom safe zone and the left margin.",
    "groups": {"caption": {"direction": "column", "gap": 2, "align": "start",
                           **pin(left="margin", bottom={"to": "safe", "offset": 2})}},
    "subject": {"place": {"x": 50, "y": 42, "height": 70},
                "variants": {"landscape": {"place": {"x": 62, "y": 50, "height": 86}},
                             "story": {"place": {"x": 50, "y": 40, "height": 50}}}},
    "nodes": [
        text("headline", "headline", "headline", 70, 14, layout={"group": "caption", **FIT}, wrap="balance",
             plate={"padding": 2, "radius": 1, "stroke": {"width": 0.25}}, variants={"landscape": {"box": {"w": 48}}}),
        text("body", "body", "body", 70, 8, layout={"group": "caption", **FIT}, wrap="pretty",
             variants={"landscape": {"box": {"w": 44}}}),
    ]}

L["quote"] = {
    "name": "Quote",
    "intent": "One big quote, an attribution, a mark: a testimonial or a statement slide.",
    "description": "An expressive quote spanning margin to margin, centered vertically; the attribution a gap below "
                   "it, left edges shared; a small plus mark on the top-left margin.",
    "nodes": [
        shape("mark", "plus", 4, 4, layout={**pin(left="margin", top="margin")}, stroke=0.5,
              variants={"landscape": {"box": {"w": 2.5, "h": 4}}}),
        text("quote", "headline", "expressive", 88, 40, text="“Design is\nwhat holds it\ntogether.”",
             layout={**pin(left="margin", right="margin", cy="center"), **FIT}, scale=0.55, wrap="balance", lineHeight=1.0,
             variants={"landscape": {"data": {"scale": 0.5}}}),
        text("attribution", "caption", "caption", 60, 5, text="— A customer, somewhere",
             layout={"stack": {"below": "quote", "gap": 4}, "align": [{"node": "quote", "edge": "left"}], **FIT},
             uppercase=True, letterSpacing=0.08),
    ]}

L["product-spotlight"] = {
    "name": "Product spotlight",
    "intent": "The product as big as it goes; a small headline and the logo stay out of its way.",
    "description": "The product fills the middle; a small headline sits on the top-left margin and the logo on the "
                   "bottom-right margin.",
    "subject": {"place": {"x": 50, "y": 56, "height": 70},
                "variants": {"landscape": {"place": {"x": 55, "y": 55, "height": 86}},
                             "story": {"place": {"x": 50, "y": 54, "height": 50}}}},
    "nodes": [
        text("headline", "headline", "headline", 46, 12, layout={**pin(left="margin", top="margin"), **FIT}, scale=0.8,
             wrap="balance", variants={"landscape": {"box": {"w": 30}}}),
        logo(12, 6, layout={**pin(right="margin", bottom="margin")}, variants={"landscape": {"box": {"w": 9, "h": 8}}}),
    ]}

L["carousel-page"] = {
    "name": "Carousel page",
    "intent": "One page of a LinkedIn document carousel: a page number, a headline, a paragraph, a swipe cue.",
    "description": "The page number on the top-right margin; the headline on the top-left margin with the body a gap "
                   "below it, left edges shared; the swipe cue on the bottom-left margin.",
    "nodes": [
        text("page", "caption", "caption", 12, 4, text="01", layout={**pin(right="margin", top="margin"), **FIT},
             align="right", uppercase=True, letterSpacing=0.08),
        text("headline", "headline", "headline", 78, 16, layout={**pin(left="margin", top="margin"), **FIT}, wrap="balance",
             variants={"landscape": {"box": {"w": 60}}}),
        text("body", "body", "body", 78, 24,
             layout={"stack": {"below": "headline", "gap": 3}, "align": [{"node": "headline", "edge": "left"}], **FIT},
             wrap="pretty", variants={"landscape": {"box": {"w": 56}}}),
        text("swipe", "caption", "caption", 30, 4, text="Swipe →", layout={**pin(left="margin", bottom="margin"), **FIT},
             uppercase=True, letterSpacing=0.08),
    ]}

L["poster-expressive"] = {
    "name": "Poster, expressive",
    "intent": "Three words as a graphic: skewed, extruded, stacked tight, with ornaments and a plate label. Declared, "
              "so the audit can keep it coherent.",
    "description": "Three expressive words fill the width, each a tight gap under the last (the middle one indented), "
                   "the third on a plate; a star, rings and a lens sit on the margins; a label plate in the bottom-right "
                   "corner. The brand gets an expression system (one angle family, one skew, one extrusion direction) "
                   "if it has none.",
    "expression": {"angles": [8], "skews": [-12], "strokeWidths": [0.25, 0.5], "extrudeAngle": 135, "radii": [1],
                   "ornaments": ["star-4", "sparkle", "rings", "lens"], "maxTreatments": 4},
    "nodes": [
        text("word1", "headline", "expressive", 82, 18, text="SHIFT",
             # the skew and the extrusion push ink down-left of the box: keep the ink on the margin
             layout={**pin(left={"to": "margin", "offset": 4}, top={"to": "margin", "offset": 2}), **FIT}, fitWidth=True, skew=-12,
             uppercase=True, lineHeight=0.85, extrude={"depth": 1.5, "angle": 135}, group="message",
             variants={"landscape": {"box": {"w": 46}}}),
        text("word2", "headline", "expressive", 62, 18, text="YOUR",
             layout={"stack": {"below": "word1", "gap": -1}, "align": [{"node": "word1", "edge": "left", "offset": 8}], **FIT},
             fitWidth=True, skew=-12, uppercase=True, lineHeight=0.85, group="message",
             variants={"landscape": {"box": {"w": 34}}}),
        text("word3", "headline", "expressive", 86, 18, text="PERSPECTIVE",
             layout={"stack": {"below": "word2", "gap": 2}, **pin(left={"to": "margin", "offset": 2}), **FIT}, fitWidth=True, uppercase=True,
             lineHeight=0.85, scale=0.6, plate={"padding": 2, "radius": 1, "stroke": {"width": 0.5}}, group="message",
             extrude={"depth": 1, "angle": 135}, variants={"landscape": {"box": {"w": 50}}}),
        shape("star-top", "star-4", 5, 4, layout={**pin(right="margin", top="margin")}, stroke=0.25),
        shape("rings", "rings", 24, 8, layout={**pin(left="margin"), "stack": {"below": "word3", "gap": 6}}, stroke=0.25,
              params={"count": 3, "spread": 0.5, "angle": 90}, variants={"landscape": {"box": {"w": 16, "h": 10}}}),
        shape("lens", "lens", 30, 10, layout={**pin(right="margin", cy={"to": "two-thirds", "offset": 2})}, stroke=0.25,
              params={"count": 3}, variants={"landscape": {"box": {"w": 20, "h": 12}}}),
        text("label", "caption", "caption", 24, 4, text="SKEW-0003",
             layout={**pin(right={"to": "margin", "offset": 1.5}, bottom={"to": "margin", "offset": 1.5}), **FIT},
             align="right", uppercase=True, letterSpacing=0.08,
             plate={"padding": 1.5, "radius": 1, "stroke": {"width": 0.25}}),
    ]}

L["thumbnail"] = {
    "name": "Thumbnail",
    "intent": "A YouTube thumbnail: a huge headline on the left two thirds, the product on the right, the duration "
              "badge's corner left clear.",
    "description": "A kicker on the top-left margin; the headline from the left margin to the two-thirds line, centered "
                   "vertically, as big as the band allows; the product on the right third; nothing in the bottom-right "
                   "corner.",
    "subject": {"place": {"x": 83, "y": 52, "height": 78},
                "variants": {"portrait": {"place": {"x": 50, "y": 70, "height": 44}},
                             "square": {"place": {"x": 72, "y": 60, "height": 60}},
                             "story": {"place": {"x": 50, "y": 70, "height": 40}}}},
    "nodes": [
        text("kicker", "kicker", "caption", 40, 4, layout={**pin(left="margin", top="margin"), **FIT}, uppercase=True,
             letterSpacing=0.08),
        text("headline", "headline", "headline", 60, 40, layout={**pin(left="margin", right="two-thirds", cy="center"), **FIT},
             scale=1.4, uppercase=True, wrap="balance", lineHeight=0.95,
             # the base pins the center (cy); an edge pin on the same axis must drop it (null deletes)
             variants={"portrait": {"layout": {"pin": {"left": M, "right": M, "top": {"to": "margin", "offset": 6}, "cy": None}},
                                    "data": {"scale": 1.1}},
                       "story": {"layout": {"pin": {"left": M, "right": M, "top": {"to": "safe", "offset": 2}, "cy": None}},
                                 "data": {"scale": 1.0}}}),
    ]}

SLOT_ORDER = ["kicker", "headline", "subhead", "body", "cta", "caption", "logo", "subject", "ornament"]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for id, spec in L.items():
        slots: list[str] = []
        for n in spec["nodes"]:
            if n["slot"] not in slots:
                slots.append(n["slot"])
        if "subject" in spec and "subject" not in slots:
            slots.append("subject")
        doc = {"id": id, "name": spec["name"], "description": spec["description"], "intent": spec["intent"],
               "slots": sorted(slots, key=SLOT_ORDER.index)}
        for k in ("expression", "groups", "subject", "nodes"):
            if k in spec:
                doc[k] = spec[k]
        (OUT / f"{id}.json").write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {len(L)} layouts to {OUT}")


if __name__ == "__main__":
    main()
