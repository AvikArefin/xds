import { describe, expect, it } from "vitest";
import { effectiveSize, roleSize } from "./typeSize";

describe("effectiveSize", () => {
  it("falls through node size, node scale, role size, role scale, band default", () => {
    expect(effectiveSize({}, {}, 70)).toBe(70);
    expect(effectiveSize({}, { scale: 1.2 }, 70)).toBeCloseTo(84);
    expect(effectiveSize({}, { size: 60, scale: 1.2 }, 70)).toBe(60); // a px size wins over the role's scale
    expect(effectiveSize({ scale: 0.5 }, { size: 60 }, 70)).toBe(30);
    expect(effectiveSize({ scale: 0.5 }, { scale: 2 }, 70)).toBe(70);
    expect(effectiveSize({ size: 41, scale: 0.5 }, { size: 60 }, 70)).toBe(41);
    expect(effectiveSize(null, null, 37)).toBe(37);
  });

  it("roleSize ignores the node", () => {
    expect(roleSize({ scale: 1.5 }, 40)).toBe(60);
    expect(roleSize(undefined, 40)).toBe(40);
  });
});
