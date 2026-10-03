import { describe, expect, it } from "vitest";
import { boxToPx, pxToBox, rotatedAabb, unionRect } from "./box";

const size = { width: 1080, height: 1350 };

describe("box", () => {
  it("converts percent to px and back", () => {
    const px = boxToPx({ x: 10, y: 20, w: 50, h: 10, rotation: 15 }, size);
    expect(px).toEqual({ x: 108, y: 270, w: 540, h: 135, rotation: 15, opacity: 1 });
    expect(pxToBox(px, size)).toEqual({ x: 10, y: 20, w: 50, h: 10, rotation: 15 });
  });

  it("returns the rect itself when not rotated", () => {
    expect(rotatedAabb({ x: 1, y: 2, w: 3, h: 4 }, 0)).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });

  it("swaps width and height at 90°", () => {
    const r = rotatedAabb({ x: 0, y: 0, w: 100, h: 20 }, 90);
    expect(r.x).toBeCloseTo(40);
    expect(r.y).toBeCloseTo(-40);
    expect(r.w).toBeCloseTo(20);
    expect(r.h).toBeCloseTo(100);
  });

  it("grows a square by √2 at 45°", () => {
    const r = rotatedAabb({ x: 0, y: 0, w: 10, h: 10 }, 45);
    expect(r.w).toBeCloseTo(10 * Math.SQRT2);
    expect(r.x + r.w / 2).toBeCloseTo(5);
  });

  it("unions rects", () => {
    expect(unionRect({ x: 0, y: 0, w: 1, h: 1 }, { x: 2, y: 3, w: 1, h: 1 })).toEqual({ x: 0, y: 0, w: 3, h: 4 });
  });
});
