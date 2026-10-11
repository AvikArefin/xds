import { describe, expect, it } from "vitest";
import { LIVE_RULES, gapRegion, liveFindings, rectGap, type LiveGuide, type LiveNode } from "./rules";

// The audit's catalog (`uv run xds rules`): every live rule must be one of these, so the
// editor never shows an id the audit doesn't know.
const AUDIT_RULES = [
  "TEXT_OVERLAP", "TEXT_CROWDED", "TEXT_OVER_SUBJECT", "TEXT_OVER_IMAGE", "SUBJECT_MASKED", "SUBJECT_CROPPED",
  "TEXT_CLIPPED", "IN_SAFE_ZONE", "OUTSIDE_MARGIN", "EDGES_KISSING",
  "ALIGN_NEAR_MISS", "MARGIN_NEAR_MISS", "GROUPING_AMBIGUOUS", "SPACING_INCONSISTENT", "SPACING_OFF_SCALE", "MARGINS_UNEVEN",
  "TEXT_TOO_SMALL", "TEXT_TOO_LARGE", "HIERARCHY_WEAK", "SIZE_NEAR_MISS", "TOO_MANY_SIZES", "TOO_MANY_FAMILIES",
  "LINE_LENGTH", "TOO_MANY_LINES", "LINE_HEIGHT", "WIDOW", "BAD_RAG", "CENTERED_LONG_TEXT", "CAPS_UNTRACKED", "TOO_MANY_WORDS",
  "LOW_CONTRAST", "LOW_CONTRAST_MARGINAL", "BUSY_BACKGROUND", "DECORATIVE_INVISIBLE",
  "ATTENTION_ON_BACKGROUND", "ATTENTION_SPLIT", "COMPETING_HEADLINES", "HIERARCHY_ORDER", "POSITION_NEAR_MISS", "LOPSIDED",
  "CROWDED", "TOO_MANY_ELEMENTS", "UNCOVERED_CANVAS",
  "SUBJECT_TOO_SMALL", "SUBJECT_TOO_LARGE", "SUBJECT_OVEREXPOSED", "SUBJECT_UNDEREXPOSED", "SUBJECT_LOW_SEPARATION",
  "SUBJECT_CLOSE_TO_TEXT", "SCREEN_DETAIL_TOO_SMALL", "SCREEN_LOW_RES", "SCREEN_ASPECT_MISMATCH",
];

const guide: LiveGuide = {
  width: 1080,
  height: 1350,
  u: 8,
  margins: { top: 64, right: 64, bottom: 64, left: 64 },
  safeZones: [{ name: "bottom", x: 0, y: 1200, w: 1080, h: 150 }],
  spacingScale: [8, 16, 24, 32, 48, 64, 96, 128],
  bands: {
    headline: { min: 54, max: 97, maxLines: 3, chars: [null, 24] },
    body: { min: 33, max: 43, maxLines: 6, chars: [25, 55] },
  },
  k: 0.361,
  blocks: 7,
};

/** A text block whose ink is one line per `texts` entry, `lh` px apart. */
function text(
  id: string,
  x: number,
  y: number,
  w: number,
  texts: string[],
  opts: Partial<LiveNode> & { lh?: number; lineW?: number[] } = {},
): LiveNode {
  const lh = opts.lh ?? 40;
  const lines = texts.map((_, i) => ({ x, y: y + i * lh, w: opts.lineW?.[i] ?? w, h: lh * 0.8 }));
  const { lh: _lh, lineW: _lw, ...rest } = opts;
  return {
    id,
    layer: "type",
    rect: { x, y, w, h: lh * texts.length },
    lines,
    lineTexts: texts,
    size: 37,
    level: "body",
    ...rest,
  };
}

const image = (id: string, x: number, y: number, w: number, h: number): LiveNode => ({ id, layer: "image", rect: { x, y, w, h } });

const rules = (nodes: LiveNode[], opts = {}) => liveFindings(nodes, guide, opts);
const ids = (nodes: LiveNode[], opts = {}) => rules(nodes, opts).map((f) => f.rule);

describe("catalog", () => {
  it("every live rule is an audit rule", () => {
    for (const r of LIVE_RULES) expect(AUDIT_RULES, r).toContain(r);
  });

  it("findings carry family, principle, slide id and the slide id on edits", () => {
    const f = rules([text("a", 64, 64, 400, ["one"]), text("b", 64, 64, 400, ["two"])], { slideId: "s1" }).find((x) => x.rule === "TEXT_OVERLAP")!;
    expect(f.family).toBe("collision");
    expect(f.principle).toMatch(/read/);
    expect(f.slideId).toBe("s1");
    expect(f.edits![0].slideId).toBe("s1");
  });
});

describe("geometry", () => {
  it("rectGap and gapRegion", () => {
    expect(rectGap({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 })).toBe(10);
    expect(rectGap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(0);
    expect(gapRegion({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 30, w: 10, h: 10 })).toEqual({ x: 0, y: 10, w: 10, h: 20 });
  });
});

describe("collision", () => {
  it("TEXT_OVERLAP on intersecting ink, with a move edit that clears it", () => {
    const f = rules([text("a", 64, 100, 400, ["one"]), text("b", 64, 110, 400, ["two"])]);
    const hit = f.find((x) => x.rule === "TEXT_OVERLAP")!;
    expect(hit.severity).toBe("error");
    expect(hit.nodes).toEqual(["a", "b"]);
    expect(hit.edits).toEqual([{ nodeId: "b", path: "box.y", value: expect.any(Number) }]);
  });

  it("interlocked expressive words of one group are neither overlap nor crowding; fitted sizes are not choices", () => {
    const words = [
      text("w1", 64, 100, 700, ["SHIFT"], { level: "expressive", group: "message", size: 272, fitted: true, lh: 230 }),
      text("w2", 120, 300, 500, ["YOUR"], { level: "expressive", group: "message", size: 257, fitted: true, lh: 230 }),
    ];
    const f = ids(words);
    expect(f).not.toContain("TEXT_OVERLAP");
    expect(f).not.toContain("TEXT_CROWDED");
    expect(f).not.toContain("SIZE_NEAR_MISS");
    const loose = ids([words[0], { ...words[1], group: null }]);
    expect(loose).toContain("TEXT_CROWDED");
  });

  it("TEXT_CROWDED below max(u, half the smaller size)", () => {
    // gap 10 px between ink lines; need = max(8, 0.5 × 37) = 18.5
    const f = ids([text("a", 64, 100, 400, ["one"], { lh: 40 }), text("b", 64, 142, 400, ["two"])]);
    expect(f).toContain("TEXT_CROWDED");
    expect(f).not.toContain("TEXT_OVERLAP");
    expect(ids([text("a", 64, 100, 400, ["one"]), text("b", 64, 200, 400, ["two"])])).not.toContain("TEXT_CROWDED");
  });

  it("TEXT_CLIPPED from overflow (box.h edit) or an off-canvas line", () => {
    const f = rules([text("a", 64, 100, 400, ["one"], { overflow: true, contentHeight: 120 })]).find((x) => x.rule === "TEXT_CLIPPED")!;
    expect(f.edits).toEqual([{ nodeId: "a", path: "box.h", value: expect.any(Number) }]);
    const off = rules([text("b", 64, 1340, 400, ["one"])]).find((x) => x.rule === "TEXT_CLIPPED")!;
    expect(off.edits).toBeUndefined();
  });

  it("IN_SAFE_ZONE for text under the zone", () => {
    const f = rules([text("a", 64, 1210, 400, ["one"])]).find((x) => x.rule === "IN_SAFE_ZONE")!;
    expect(f.severity).toBe("error");
    expect(f.edits![0].path).toBe("box.y");
  });

  it("OUTSIDE_MARGIN for a block past the margin, not for full-bleed images", () => {
    expect(ids([text("a", 20, 100, 400, ["one"])])).toContain("OUTSIDE_MARGIN");
    expect(ids([image("bg", 0, 0, 1080, 1350)])).not.toContain("OUTSIDE_MARGIN");
  });

  it("EDGES_KISSING between an image and text within u/2", () => {
    const f = ids([text("a", 64, 100, 400, ["one"]), image("i", 466, 100, 200, 100)]);
    expect(f).toContain("EDGES_KISSING");
    expect(ids([text("a", 64, 100, 400, ["one"]), text("b", 466, 100, 200, ["two"])])).not.toContain("EDGES_KISSING");
  });
});

describe("spacing", () => {
  it("ALIGN_NEAR_MISS between 1 and u/2 px, with the edit on the second block", () => {
    const f = rules([text("a", 64, 100, 400, ["one"]), text("b", 67, 300, 300, ["two"])]).find((x) => x.rule === "ALIGN_NEAR_MISS")!;
    expect(f.message).toMatch(/left edges/);
    expect(f.edits).toEqual([{ nodeId: "b", path: "box.x", value: expect.closeTo((64 / 1080) * 100, 1) }]);
    expect(ids([text("a", 64, 100, 400, ["one"]), text("b", 80, 300, 300, ["two"])])).not.toContain("ALIGN_NEAR_MISS");
  });

  it("MARGIN_NEAR_MISS when an edge is within u/2 of the margin", () => {
    expect(ids([text("a", 66, 100, 400, ["one"])])).toContain("MARGIN_NEAR_MISS");
    expect(ids([text("a", 64, 100, 400, ["one"])])).not.toContain("MARGIN_NEAR_MISS");
  });

  it("a stacked block's move edit becomes its gap", () => {
    const b = text("b", 64, 300, 300, ["two"], { stack: { axis: "y", path: "layout.stack.gap", dir: 1, gap: 2 } });
    const f = rules([text("a", 64, 100, 400, ["one"]), { ...b, rect: { ...b.rect, y: 152 }, lines: [{ x: 64, y: 152, w: 300, h: 32 }] }]);
    const off = f.find((x) => x.rule === "SPACING_OFF_SCALE");
    expect(off?.edits).toEqual([{ nodeId: "b", path: "layout.stack.gap", value: expect.any(Number) }]);
  });

  it("SPACING_OFF_SCALE and SPACING_INCONSISTENT / GROUPING_AMBIGUOUS on declared groups", () => {
    // gaps: a→b 24 (on scale), b→c 37 (off)
    const a = text("a", 64, 100, 400, ["one"], { group: "g" });
    const b = text("b", 64, 156, 400, ["two"], { group: "g" });
    const c = text("c", 64, 225, 400, ["three"], { group: "g" });
    const f = ids([a, b, c]);
    expect(f).toContain("SPACING_OFF_SCALE");
    expect(f).toContain("SPACING_INCONSISTENT");
    // an outsider closer than the inner gaps
    const d = text("d", 64, 270, 400, ["four"]);
    expect(ids([a, b, c, d])).toContain("GROUPING_AMBIGUOUS");
  });
});

describe("composition", () => {
  it("POSITION_NEAR_MISS for an image just off the center", () => {
    // center 540; 2–5 % of s (21.6–54 px) off
    expect(ids([image("i", 540 - 100 + 30, 300, 200, 200)])).toContain("POSITION_NEAR_MISS");
    expect(ids([image("i", 440, 350, 200, 200)])).not.toContain("POSITION_NEAR_MISS");
  });

  it("TOO_MANY_ELEMENTS above the budget", () => {
    const many = Array.from({ length: 8 }, (_, i) => text(`t${i}`, 64, 100 + i * 120, 400, [`line ${i}`]));
    expect(ids(many)).toContain("TOO_MANY_ELEMENTS");
  });
});

describe("type", () => {
  it("TEXT_TOO_SMALL / TEXT_TOO_LARGE against the band, with size edits", () => {
    const small = rules([text("a", 64, 100, 400, ["one"], { size: 20 })]).find((x) => x.rule === "TEXT_TOO_SMALL")!;
    expect(small.edits).toEqual([{ nodeId: "a", path: "data.size", value: 33 }]);
    const large = rules([text("a", 64, 100, 400, ["one"], { size: 60 })]).find((x) => x.rule === "TEXT_TOO_LARGE")!;
    expect(large.edits).toEqual([{ nodeId: "a", path: "data.size", value: 43 }]);
  });

  it("SIZE_NEAR_MISS within 8 %, HIERARCHY_WEAK under ×1.25, TOO_MANY_SIZES over 4", () => {
    expect(ids([text("a", 64, 100, 400, ["one"], { size: 37 }), text("b", 64, 300, 400, ["two"], { size: 38 })])).toContain("SIZE_NEAR_MISS");
    expect(ids([text("a", 64, 100, 400, ["one"], { size: 36 }), text("b", 64, 300, 400, ["two"], { size: 42 })])).toContain("HIERARCHY_WEAK");
    const sizes = [33, 43, 60, 80, 97].map((s, i) => text(`t${i}`, 64, 100 + i * 150, 400, ["x"], { size: s, level: "headline" }));
    expect(ids(sizes)).toContain("TOO_MANY_SIZES");
  });

  it("TOO_MANY_LINES, WIDOW and LINE_LENGTH read the measured lines", () => {
    const long = text("a", 64, 100, 400, ["This line of body copy is far longer than fifty five characters allow"]);
    expect(ids([long])).toContain("LINE_LENGTH");
    const widow = text("w", 64, 100, 400, ["a long first line of text here", "end"], { lineW: [400, 30] });
    expect(ids([widow])).toContain("WIDOW");
    expect(ids([{ ...widow, forcedLastLine: true }])).not.toContain("WIDOW");
    const tall = text("t", 64, 100, 400, ["one two three", "four five six", "seven eight", "nine"], { level: "headline", size: 70 });
    expect(ids([tall])).toContain("TOO_MANY_LINES");
  });

  it("decorative text and expressive lettering are left alone", () => {
    expect(ids([text("a", 64, 100, 400, ["one"], { size: 20, decorative: true })])).not.toContain("TEXT_TOO_SMALL");
    const w = text("w", 64, 100, 400, ["a long first line of text here", "end"], { lineW: [400, 30], level: "expressive" });
    expect(ids([w])).not.toContain("WIDOW");
  });
});

describe("options", () => {
  it("rules.off, slide exceptions and node exceptions leave findings out", () => {
    const n = text("a", 66, 100, 400, ["one"]);
    expect(ids([n])).toContain("MARGIN_NEAR_MISS");
    expect(ids([n], { off: ["MARGIN_NEAR_MISS"] })).not.toContain("MARGIN_NEAR_MISS");
    expect(ids([n], { slideWaived: ["MARGIN_NEAR_MISS"] })).not.toContain("MARGIN_NEAR_MISS");
    expect(ids([{ ...n, waived: ["MARGIN_NEAR_MISS"] }])).not.toContain("MARGIN_NEAR_MISS");
  });

  it("project.rules.set overrides a threshold", () => {
    const n = text("a", 64, 100, 400, ["one"], { size: 20 });
    expect(ids([n], { set: { "body.size": [18, 43] } })).not.toContain("TEXT_TOO_SMALL");
  });
});
