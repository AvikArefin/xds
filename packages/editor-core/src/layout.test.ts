import { describe, expect, it } from "vitest";
import {
  fallbackGuide,
  gapForPosition,
  hasRelations,
  lineFor,
  offsetFor,
  resolveLayout,
  safeInsets,
  type LayoutGuide,
  type LayoutItem,
} from "./layout";

const g: LayoutGuide = {
  width: 1000,
  height: 2000,
  u: 10,
  margins: { top: 100, right: 60, bottom: 100, left: 60 },
  safeZones: [
    { x: 0, y: 0, w: 1000, h: 250 },
    { x: 0, y: 1660, w: 1000, h: 340 },
    { x: 800, y: 1900, w: 200, h: 100 }, // a corner badge: ignored
  ],
};
const item = (id: string, rect: LayoutItem["rect"], layout?: LayoutItem["layout"], extra: Partial<LayoutItem> = {}): LayoutItem => ({
  id,
  rect,
  layout,
  ...extra,
});

describe("format lines", () => {
  it("knows edge, safe, margin, center and thirds on both axes", () => {
    expect(lineFor("left", "edge", g)).toBe(0);
    expect(lineFor("right", "edge", g)).toBe(1000);
    expect(lineFor("left", "margin", g)).toBe(60);
    expect(lineFor("right", "margin", g)).toBe(940);
    expect(lineFor("bottom", "margin", g)).toBe(1900);
    expect(lineFor("cx", "center", g)).toBe(500);
    expect(lineFor("top", "third", g)).toBe(2000 / 3);
    expect(lineFor("left", "two-thirds", g)).toBe(2000 / 3);
    expect(safeInsets(g)).toEqual({ top: 250, right: 0, bottom: 340, left: 0 });
    expect(lineFor("top", "safe", g)).toBe(250);
    expect(lineFor("bottom", "safe", g)).toBe(1660);
    expect(lineFor("left", "safe", g)).toBe(0);
  });

  it("derives a fallback guide from the format", () => {
    const f = fallbackGuide(1080, 1350);
    expect(f.u).toBe(8);
    expect(f.margins.left).toBe(64);
  });
});

describe("pins", () => {
  it("pins one edge, keeps the size, records the line", () => {
    const r = resolveLayout([item("a", { x: 10, y: 10, w: 200, h: 50 }, { pin: { left: { to: "margin" }, top: { to: "margin", offset: 2 } } })], g);
    const p = r.get("a")!;
    expect(p.rect).toEqual({ x: 60, y: 120, w: 200, h: 50 });
    expect(p.decided).toEqual({ x: "pin", y: "pin" });
    expect(p.pins).toEqual({ left: 60, top: 100 });
  });

  it("sizes the box when both edges are pinned; a center pin keeps the size", () => {
    const r = resolveLayout(
      [
        item("wide", { x: 10, y: 10, w: 200, h: 50 }, { pin: { left: { to: "margin" }, right: { to: "margin" } } }),
        item("mid", { x: 10, y: 10, w: 200, h: 50 }, { pin: { cx: { to: "center" }, cy: { to: "third" } } }),
        item("end", { x: 10, y: 10, w: 200, h: 50 }, { pin: { right: { to: "edge", offset: -1 }, bottom: { to: "safe" } } }),
      ],
      g,
    );
    expect(r.get("wide")!.rect).toEqual({ x: 60, y: 10, w: 880, h: 50 });
    expect(r.get("wide")!.decided).toEqual({ x: "pin", w: "pin" });
    expect(r.get("mid")!.rect).toEqual({ x: 400, y: Math.round((2000 / 3 - 25) * 1000) / 1000, w: 200, h: 50 });
    expect(r.get("end")!.rect).toEqual({ x: 790, y: 1610, w: 200, h: 50 });
  });
});

describe("stacks", () => {
  it("stacks below ink to ink, like resolveStacks", () => {
    const r = resolveLayout(
      [
        item("h", { x: 0, y: 100, w: 300, h: 100 }, null, { ink: { top: 10, bottom: 90 } }),
        item("b", { x: 0, y: 0, w: 300, h: 50 }, { stack: { below: "h", gap: 3 } }, { ink: { top: 6, bottom: 40 } }),
      ],
      { ...g, u: 8 },
    );
    expect(r.get("b")!.rect.y).toBe(208);
    expect(r.get("b")!.stack).toEqual({ axis: "y", base: 184, dir: 1, anchor: "h" });
    expect(r.has("h")).toBe(false);
  });

  it("stacks right of and left of, ink to ink on x", () => {
    const r = resolveLayout(
      [
        item("logo", { x: 100, y: 0, w: 100, h: 40 }),
        item("name", { x: 0, y: 0, w: 200, h: 40 }, { stack: { rightOf: "logo", gap: 2 } }, { ink: { top: 0, bottom: 40, left: 5, right: 150 } }),
        item("tag", { x: 0, y: 0, w: 80, h: 40 }, { stack: { leftOf: "logo", gap: 1 } }),
      ],
      g,
    );
    expect(r.get("name")!.rect.x).toBe(200 + 20 - 5);
    expect(r.get("name")!.decided).toEqual({ x: "stack" });
    expect(r.get("tag")!.rect.x).toBe(100 - 10 - 80);
    expect(r.get("tag")!.stack).toMatchObject({ axis: "x", dir: -1, anchor: "logo" });
  });

  it("chains in any order, and leaves missing anchors and cycles alone", () => {
    const r = resolveLayout(
      [
        item("c", { x: 0, y: 0, w: 10, h: 10 }, { stack: { below: "b", gap: 1 } }),
        item("b", { x: 0, y: 0, w: 10, h: 20 }, { stack: { below: "a", gap: 2 } }),
        item("a", { x: 0, y: 50, w: 10, h: 30 }),
        item("x", { x: 0, y: 5, w: 10, h: 10 }, { stack: { below: "gone", gap: 1 } }),
        item("p", { x: 0, y: 7, w: 10, h: 10 }, { stack: { below: "q", gap: 1 } }),
        item("q", { x: 0, y: 9, w: 10, h: 10 }, { stack: { below: "p", gap: 1 } }),
      ],
      g,
    );
    expect(r.get("b")!.rect.y).toBe(50 + 30 + 20);
    expect(r.get("c")!.rect.y).toBe(100 + 20 + 10);
    expect(r.has("x")).toBe(false);
    expect([...r.keys()].filter((k) => k === "p" || k === "q").length).toBeLessThanOrEqual(1);
  });
});

describe("align", () => {
  it("shares an edge with another node, with an offset, one per axis", () => {
    const r = resolveLayout(
      [
        item("h", { x: 100, y: 100, w: 400, h: 80 }),
        item("cta", { x: 0, y: 0, w: 120, h: 40 }, { align: [{ node: "h", edge: "right", offset: 0 }, { node: "h", edge: "middle", offset: 1 }] }),
        item("k", { x: 0, y: 0, w: 60, h: 20 }, { align: [{ node: "h", edge: "center" }] }),
      ],
      g,
    );
    expect(r.get("cta")!.rect).toEqual({ x: 380, y: 100 + 40 - 20 + 10, w: 120, h: 40 });
    expect(r.get("cta")!.align!.x).toEqual({ anchor: "h", edge: "right", at: 500 });
    expect(r.get("k")!.rect.x).toBe(300 - 30);
  });

  it("follows an anchor that is itself pinned, and a stack wins over an align on its axis", () => {
    const r = resolveLayout(
      [
        item("h", { x: 0, y: 0, w: 400, h: 80 }, { pin: { left: { to: "margin" }, top: { to: "margin" } } }),
        item("s", { x: 0, y: 0, w: 300, h: 40 }, { align: [{ node: "h", edge: "left" }, { node: "h", edge: "top" }], stack: { below: "h", gap: 2 } }),
      ],
      g,
    );
    expect(r.get("s")!.rect).toEqual({ x: 60, y: 100 + 80 + 20, w: 300, h: 40 });
    expect(r.get("s")!.decided).toEqual({ x: "align", y: "stack" });
  });
});

describe("fit and knobs", () => {
  it("fits the height to the text after the rest", () => {
    const r = resolveLayout([item("t", { x: 0, y: 0, w: 300, h: 10 }, { fit: "text", pin: { top: { to: "margin" } } }, { contentHeight: 123.4 })], g);
    expect(r.get("t")!.rect).toEqual({ x: 0, y: 100, w: 300, h: 124 });
    expect(r.get("t")!.decided).toEqual({ y: "pin", h: "fit" });
  });

  it("turns a dragged position back into a gap or an offset", () => {
    expect(gapForPosition({ base: 184, dir: 1 }, 208, 8)).toBe(3);
    expect(gapForPosition({ base: 190, dir: -1 }, 166, 8)).toBe(3);
    expect(gapForPosition({ base: 184, dir: 1 }, 213, 8, 1)).toBe(4);
    expect(offsetFor(84, 60, 8)).toBe(3);
    expect(offsetFor(83, 60, 8, 1)).toBe(3);
    expect(hasRelations({ pin: {} })).toBe(false);
    expect(hasRelations({ fit: "text" })).toBe(true);
  });
});

describe("flow groups", () => {
  const text = (id: string, y: number, h: number, layer = "col") =>
    item(id, { x: 100, y, w: 400, h }, { group: layer }, { ink: { top: 4, bottom: h - 4, left: 0, right: 400 } });

  it("packs a column from where it is, ink to ink, and overrides a member's own stack", () => {
    const items = [text("a", 300, 100), item("b", { x: 100, y: 900, w: 300, h: 50 }, { group: "col", stack: { below: "a", gap: 9 } })];
    const r = resolveLayout(items, g, { col: { direction: "column", gap: 2 } });
    expect(r.get("a")!.rect.y).toBe(300); // the first member stays where it is
    expect(r.get("a")!.decided).toEqual({ x: "group", y: "group" });
    // b's box top: a's ink bottom (300 + 96 = 396) + 2u, minus b's own ink top (0)
    expect(r.get("b")!.rect.y).toBe(416);
    expect(r.get("b")!.group).toMatchObject({ name: "col", index: 1, axis: "y" });
    expect(r.get("b")!.decided.y).toBe("group");
  });

  it("an unpinned group is a fixed point: resolving the resolved rects changes nothing", () => {
    const items = [text("a", 300, 100), text("b", 900, 60), text("c", 50, 80)];
    const groups = { col: { direction: "column" as const, gap: 2 } };
    const r1 = resolveLayout(items, g, groups);
    const again = items.map((i) => ({ ...i, rect: r1.get(i.id)!.rect }));
    const r2 = resolveLayout(again, g, groups);
    for (const i of items) expect(r2.get(i.id)!.rect).toEqual(r1.get(i.id)!.rect);
    expect(r1.get("a")!.rect.y).toBe(300);
  });

  it("lays a row out with the cross axis aligned, inside a pinned box with padding", () => {
    const items = [
      item("a", { x: 0, y: 0, w: 100, h: 50 }, { group: "row" }),
      item("b", { x: 0, y: 0, w: 100, h: 30 }, { group: "row" }),
    ];
    const r = resolveLayout(items, g, {
      row: { direction: "row", gap: 1, align: "center", padding: 2, pin: { left: { to: "margin" }, right: { to: "margin" }, top: { to: "margin" }, bottom: { to: "margin", offset: -100 } } },
    });
    // the box spans the margins: x 60–940, y 100–900; padding 20
    expect(r.get("a")!.rect).toEqual({ x: 80, y: 475, w: 100, h: 50 });
    expect(r.get("b")!.rect).toEqual({ x: 190, y: 485, w: 100, h: 30 });
    expect(r.get("a")!.group!.box).toEqual({ x: 60, y: 100, w: 880, h: 800 });
    expect(r.get("a")!.group!.pins).toMatchObject({ left: 60, right: 940 });
  });

  it("ignores padding for an unpinned group (so it does not drift) and aligns to the end", () => {
    const items = [item("a", { x: 100, y: 100, w: 200, h: 50 }, { group: "c" }), item("b", { x: 150, y: 400, w: 100, h: 50 }, { group: "c" })];
    const r = resolveLayout(items, g, { c: { direction: "column", gap: 0, align: "end", padding: 5 } });
    expect(r.get("a")!.rect).toEqual({ x: 100, y: 100, w: 200, h: 50 });
    expect(r.get("b")!.rect).toEqual({ x: 200, y: 150, w: 100, h: 50 });
  });

  it("leaves nodes that name no declared group alone", () => {
    const r = resolveLayout([item("a", { x: 1, y: 2, w: 3, h: 4 }, { group: "nope" })], g, {});
    expect(r.size).toBe(0);
  });
});
