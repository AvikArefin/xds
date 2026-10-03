import { describe, expect, it } from "vitest";
import { alignRects, distributeRects, rectsBounds } from "./align";

const rects = [
  { x: 10, y: 10, w: 50, h: 20 },
  { x: 100, y: 40, w: 30, h: 40 },
  { x: 60, y: 200, w: 80, h: 10 },
];

describe("alignRects", () => {
  it("computes bounds", () => {
    expect(rectsBounds(rects)).toEqual({ x: 10, y: 10, w: 130, h: 200 });
  });

  it("aligns left / right / center", () => {
    expect(alignRects(rects, "left").map((r) => r.x)).toEqual([10, 10, 10]);
    expect(alignRects(rects, "right").map((r) => r.x + r.w)).toEqual([140, 140, 140]);
    expect(alignRects(rects, "center").map((r) => r.x + r.w / 2)).toEqual([75, 75, 75]);
  });

  it("aligns top / middle / bottom and leaves the other axis alone", () => {
    const top = alignRects(rects, "top");
    expect(top.map((r) => r.y)).toEqual([10, 10, 10]);
    expect(top.map((r) => r.x)).toEqual([10, 100, 60]);
    expect(alignRects(rects, "bottom").map((r) => r.y + r.h)).toEqual([210, 210, 210]);
    expect(alignRects(rects, "middle").map((r) => r.y + r.h / 2)).toEqual([110, 110, 110]);
  });

  it("aligns to a reference rect", () => {
    const out = alignRects(rects, "left", { x: 64, y: 0, w: 952, h: 1350 });
    expect(out.every((r) => r.x === 64)).toBe(true);
  });
});

describe("distributeRects", () => {
  it("makes the gaps equal and keeps the outer blocks in place", () => {
    const rs = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 90, y: 0, w: 20, h: 10 },
      { x: 13, y: 0, w: 10, h: 10 },
    ];
    const out = distributeRects(rs, "x");
    // sorted order: 0, 2, 1 → span 0..110, sizes 40 → gaps 35
    expect(out[0].x).toBe(0);
    expect(out[2].x).toBe(45);
    expect(out[1].x).toBe(90);
  });

  it("distributes vertically", () => {
    const rs = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 0, y: 20, w: 10, h: 10 },
      { x: 0, y: 100, w: 10, h: 10 },
    ];
    const out = distributeRects(rs, "y");
    expect(out.map((r) => r.y)).toEqual([0, 50, 100]);
  });

  it("snaps the gap to the spacing unit", () => {
    const rs = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 30, y: 0, w: 10, h: 10 },
      { x: 61, y: 0, w: 10, h: 10 },
    ];
    // equal gap would be 25.5 → snapped to 24 (u = 8)
    const out = distributeRects(rs, "x", { unit: 8 });
    expect(out.map((r) => r.x)).toEqual([0, 34, 68]);
    const gaps = [out[1].x - (out[0].x + 10), out[2].x - (out[1].x + 10)];
    expect(gaps).toEqual([24, 24]);
  });

  it("uses at least one unit as the gap", () => {
    const rs = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 5, y: 0, w: 10, h: 10 },
    ];
    const out = distributeRects(rs, "x", { unit: 8 });
    expect(out[1].x).toBe(18);
  });

  it("leaves fewer than three rects alone without a unit", () => {
    const rs = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 50, y: 0, w: 10, h: 10 },
    ];
    expect(distributeRects(rs, "x")).toEqual(rs);
  });
});
