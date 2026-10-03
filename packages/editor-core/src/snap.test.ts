import { describe, expect, it } from "vitest";
import { snapAxis, snapMove, snapResize, snapTargets, snapValue } from "./snap";

const ctx = {
  width: 1080,
  height: 1350,
  margins: { top: 64, right: 64, bottom: 64, left: 64 },
  u: 8,
};

describe("snapTargets", () => {
  it("lists canvas, margin, thirds and other blocks' edges and centers", () => {
    const t = snapTargets({ ...ctx, others: [{ x: 200, y: 300, w: 100, h: 50 }] });
    const xs = t.x.map((l) => `${l.kind}:${l.value}`);
    expect(xs).toContain("margin:64");
    expect(xs).toContain("margin:1016");
    expect(xs).toContain("third:360");
    expect(xs).toContain("third:720");
    expect(xs).toContain("canvas:540");
    expect(xs).toContain("edge:200");
    expect(xs).toContain("edge:300");
    expect(xs).toContain("center:250");
    const ys = t.y.map((l) => `${l.kind}:${l.value}`);
    expect(ys).toContain("third:450");
    expect(ys).toContain("center:325");
  });

  it("can leave the thirds out", () => {
    const t = snapTargets({ ...ctx, thirds: false });
    expect(t.x.some((l) => l.kind === "third")).toBe(false);
  });
});

describe("snapMove", () => {
  const targets = snapTargets({ ...ctx, others: [{ x: 500, y: 700, w: 200, h: 100 }] });

  it("snaps the left edge to the margin", () => {
    const r = snapMove({ x: 60, y: 403, w: 311, h: 101 }, targets, 6);
    expect(r.rect.x).toBe(64);
    expect(r.guides.find((g) => g.axis === "x")?.kind).toBe("margin");
  });

  it("snaps the right edge to the right margin", () => {
    const r = snapMove({ x: 713, y: 403, w: 300, h: 100 }, targets, 6);
    expect(r.rect.x + r.rect.w).toBe(1016);
  });

  it("snaps the center to another block's center", () => {
    const r = snapMove({ x: 548, y: 100, w: 100, h: 40 }, targets, 6);
    expect(r.rect.x + r.rect.w / 2).toBe(600);
    expect(r.guides[0].kind).toBe("center");
  });

  it("snaps the top edge to another block's bottom edge", () => {
    const r = snapMove({ x: 123, y: 797, w: 100, h: 40 }, targets, 6);
    expect(r.rect.y).toBe(800);
  });

  it("snaps to the third lines", () => {
    const r = snapMove({ x: 100, y: 447, w: 100, h: 41 }, targets, 4);
    expect(r.rect.y).toBe(450);
    expect(r.guides.find((g) => g.axis === "y")?.kind).toBe("third");
  });

  it("falls back to the u grid when no line is close", () => {
    const r = snapMove({ x: 123, y: 1003, w: 101, h: 41 }, targets, 3);
    expect(r.rect.x % 8 === 0 || (r.rect.x + r.rect.w) % 8 === 0 || (r.rect.x + r.rect.w / 2) % 8 === 0).toBe(true);
    expect(r.guides.some((g) => g.kind === "grid")).toBe(true);
  });

  it("does nothing outside the threshold", () => {
    const t = snapTargets({ width: 1000, height: 1000, thirds: false });
    const r = snapMove({ x: 123, y: 211, w: 51, h: 51 }, t, 2);
    expect(r.rect).toEqual({ x: 123, y: 211, w: 51, h: 51 });
    expect(r.guides).toEqual([]);
  });

  it("prefers named lines over the grid", () => {
    const s = snapAxis([66], [{ axis: "x", value: 64, kind: "margin" }], 4, 3);
    expect(s.delta).toBe(-2);
    expect(s.line?.kind).toBe("margin");
  });
});

describe("snapResize", () => {
  const targets = snapTargets(ctx);

  it("snaps only the dragged edge", () => {
    const r = snapResize({ x: 100, y: 100, w: 913, h: 50 }, { right: true }, targets, 6);
    expect(r.rect.x).toBe(100);
    expect(r.rect.x + r.rect.w).toBe(1016);
  });

  it("snaps the left edge and keeps the right edge fixed", () => {
    const r = snapResize({ x: 61, y: 100, w: 339, h: 50 }, { left: true }, targets, 6);
    expect(r.rect.x).toBe(64);
    expect(r.rect.x + r.rect.w).toBe(400);
  });

  it("snaps the bottom edge", () => {
    const r = snapResize({ x: 100, y: 1200, w: 50, h: 83 }, { bottom: true }, targets, 6);
    expect(r.rect.y + r.rect.h).toBe(1286);
  });
});

describe("snapValue", () => {
  it("snaps within the threshold", () => {
    expect(snapValue(44, 45, 3)).toBe(45);
    expect(snapValue(40, 45, 3)).toBe(40);
  });
});
