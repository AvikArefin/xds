import { describe, expect, it } from "vitest";
import type { TypeData } from "@xds/protocol";
import {
  extrudeOffsets,
  fitWidthSize,
  hasTreatment,
  plateRect,
  polygonBounds,
  repeatOffsets,
  transformedCorners,
  treatedExtent,
} from "./treatments";

const u = 8;
const ink = { top: 10, bottom: 50, left: 0, right: 200 };
const base: TypeData = { text: "SHIFT", role: "big" };

describe("extrude", () => {
  it("steps along the angle, one copy per 2 px by default", () => {
    const o = extrudeOffsets({ depth: 2, angle: 90 }, u); // 16 px → 8 steps straight down
    expect(o.length).toBe(8);
    expect(o[0]).toEqual({ dx: 0, dy: 2, opacity: 1, outline: false });
    expect(o[7].dy).toBe(16);
    const right = extrudeOffsets({ depth: 1, angle: 0, steps: 2 }, u);
    expect(right.map((c) => [c.dx, c.dy])).toEqual([[4, 0], [8, 0]]);
    const downLeft = extrudeOffsets({ depth: 1, angle: 135, steps: 1 }, u)[0];
    expect(downLeft.dx).toBeCloseTo(-5.66, 1);
    expect(downLeft.dy).toBeCloseTo(5.66, 1);
  });
});

describe("repeat", () => {
  it("draws count − 1 copies, cumulative, with fade and alternating outlines", () => {
    const o = repeatOffsets({ count: 4, dx: 1, dy: 0.5, outline: true, fade: true }, u);
    expect(o.map((c) => [c.dx, c.dy])).toEqual([[8, 4], [16, 8], [24, 12]]);
    expect(o.map((c) => c.outline)).toEqual([true, false, true]);
    expect(o[0].opacity).toBeCloseTo(0.73, 2);
    expect(o[2].opacity).toBeCloseTo(0.2, 2);
  });
});

describe("extent", () => {
  it("grows the ink by stroke, clones and plate", () => {
    expect(hasTreatment(base)).toBe(false);
    const d: TypeData = { ...base, stroke: { width: 0.5 }, fill: "none", repeat: { count: 3, dx: -1, dy: 1 } };
    expect(hasTreatment(d)).toBe(true);
    expect(treatedExtent(d, ink, u)).toEqual({ top: 8, bottom: 68, left: -18, right: 202 });
    const plated: TypeData = { ...base, plate: { padding: 1, stroke: { width: 0.5 } } };
    expect(plateRect(plated, ink, u)).toEqual({ x: -10, y: 0, w: 220, h: 60 });
    expect(treatedExtent(plated, ink, u)).toEqual({ top: 0, bottom: 60, left: -10, right: 210 });
  });
});

describe("fit width", () => {
  it("scales the reference size by the box/natural ratio, in half px", () => {
    expect(fitWidthSize(500, 100, 1000)).toBe(200);
    expect(fitWidthSize(333, 100, 1000)).toBe(300.5);
    expect(fitWidthSize(0, 100, 1000)).toBe(100);
  });
});

describe("corners", () => {
  it("rotates about the box center and skews about it", () => {
    const box = { x: 100, y: 100, w: 200, h: 100 };
    const local = { x: 0, y: 0, w: 200, h: 100 };
    expect(transformedCorners(local, box)).toEqual([[100, 100], [300, 100], [300, 200], [100, 200]]);
    const rot = transformedCorners(local, box, 90);
    expect(rot[0]).toEqual([250, 50]);
    expect(polygonBounds(rot)).toEqual({ x: 150, y: 50, w: 100, h: 200 });
    const sk = transformedCorners(local, box, 0, 45); // top edge shifts left by 50, bottom right by 50
    expect(sk[0]).toEqual([50, 100]);
    expect(sk[2]).toEqual([350, 200]);
  });
});
