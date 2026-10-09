import { describe, expect, it } from "vitest";
import { gapForTop, resolveStacks, type StackItem } from "./stack";

const item = (id: string, top: number, inkTop: number, inkBottom: number, stack?: StackItem["stack"]): StackItem => ({
  id,
  top,
  inkTop,
  inkBottom,
  stack,
});

describe("resolveStacks", () => {
  it("puts a block a gap below its anchor's ink, ink to ink", () => {
    const r = resolveStacks([item("h", 100, 10, 90), item("b", 0, 6, 40, { below: "h", gap: 3 })], 8);
    // anchor ink bottom = 100 + 90 = 190; b's ink top must be 190 + 24 → box top 214 − 6
    expect(r.get("b")).toEqual({ top: 208, base: 184, dir: 1, anchor: "h" });
    expect(r.has("h")).toBe(false);
  });

  it("chains, in any array order", () => {
    const r = resolveStacks(
      [item("c", 0, 0, 10, { below: "b", gap: 1 }), item("b", 0, 0, 20, { below: "a", gap: 2 }), item("a", 50, 0, 30)],
      10,
    );
    expect(r.get("b")!.top).toBe(50 + 30 + 20);
    expect(r.get("c")!.top).toBe(100 + 20 + 10);
  });

  it("stacks above: the block's ink bottom sits a gap above the anchor's ink top", () => {
    const r = resolveStacks([item("k", 0, 4, 30, { above: "h", gap: 2 }), item("h", 200, 12, 100)], 8);
    // anchor ink top = 212; k's ink bottom = 212 − 16 = 196 → top 166
    expect(r.get("k")).toMatchObject({ top: 166, dir: -1 });
  });

  it("leaves blocks with a missing anchor or in a cycle where they are", () => {
    const r = resolveStacks(
      [item("x", 5, 0, 10, { below: "gone", gap: 1 }), item("p", 7, 0, 10, { below: "q", gap: 1 }), item("q", 9, 0, 10, { below: "p", gap: 1 })],
      8,
    );
    expect(r.has("x")).toBe(false);
    // one of the pair falls back to its box top, the other stacks on it
    expect([...r.keys()].length).toBeLessThanOrEqual(1);
  });

  it("converts a dragged top back into a gap", () => {
    expect(gapForTop({ base: 184, dir: 1 }, 208, 8)).toBe(3);
    expect(gapForTop({ base: 190, dir: -1 }, 166, 8)).toBe(3);
    expect(gapForTop({ base: 184, dir: 1 }, 213, 8, 1)).toBe(4);
  });
});
