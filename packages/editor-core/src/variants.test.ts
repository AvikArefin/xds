import { describe, expect, it } from "vitest";
import type { TypeNode } from "@xds/protocol";
import { diffVariant, mergeVariant, orientationOf, resolveVariant, resolveVariants, writeNode } from "./variants";

const node = (): TypeNode => ({
  id: "h1",
  layer: "type",
  box: { x: 5, y: 5, w: 50, h: 10 },
  layout: { pin: { left: { to: "margin" } }, stack: { below: "bg", gap: 2 } },
  data: { text: "Hi", role: "headline", size: 70 },
  variants: {
    landscape: { box: { w: 30 }, layout: null, data: { size: 40, align: "center" }, hidden: true },
    story: { box: { y: 20 } },
  },
});

describe("orientationOf", () => {
  it("classes formats", () => {
    expect(orientationOf({ width: 1080, height: 1350 })).toBe("portrait");
    expect(orientationOf({ width: 1080, height: 1440 })).toBe("portrait");
    expect(orientationOf({ width: 1080, height: 1920 })).toBe("story");
    expect(orientationOf({ width: 1080, height: 1080 })).toBe("square");
    expect(orientationOf({ width: 1100, height: 1080 })).toBe("square");
    expect(orientationOf({ width: 1200, height: 627 })).toBe("landscape");
    expect(orientationOf({ width: 1440, height: 1080 })).toBe("landscape");
  });
});

describe("resolveVariant", () => {
  it("deep-merges the orientation's fields, null drops a key, other orientations are untouched", () => {
    const r = resolveVariant(node(), "landscape");
    expect(r.box).toEqual({ x: 5, y: 5, w: 30, h: 10 });
    expect(r.layout).toBeUndefined();
    expect(r.data).toEqual({ text: "Hi", role: "headline", size: 40, align: "center" });
    expect(r.hidden).toBe(true);
    expect(r.variants).toEqual(node().variants);
    const base = node();
    expect(resolveVariant(base, "portrait")).toBe(base); // identity when the orientation has no variant
    expect(resolveVariant(base, "story").box.y).toBe(20);
  });

  it("resolveVariants keeps the array when nothing applies", () => {
    const nodes = [node()];
    expect(resolveVariants(nodes, "square")).toBe(nodes);
    expect((resolveVariants(nodes, "landscape")[0] as TypeNode).box.w).toBe(30);
  });

  it("mergeVariant and diffVariant are inverses on plain objects", () => {
    const base = { box: { x: 1, y: 2 }, data: { text: "a", size: 3 }, name: "n" };
    const after = { box: { x: 1, y: 5 }, data: { text: "a" }, name: "n" };
    const d = diffVariant(base, after);
    expect(d).toEqual({ box: { y: 5 }, data: { size: null } });
    expect(mergeVariant(base, d)).toEqual(after);
  });
});

describe("writeNode", () => {
  it("writes to the base when the orientation has no variant", () => {
    const out = writeNode(node(), "square", (n) => ({ ...n, box: { ...(n as TypeNode).box, x: 9 } }) as TypeNode) as TypeNode;
    expect(out.box.x).toBe(9);
    expect(out.variants).toEqual(node().variants);
  });

  it("writes the diff into the active variant and leaves the base alone", () => {
    const out = writeNode(node(), "landscape", (n) => {
      const t = n as TypeNode;
      expect(t.box.w).toBe(30); // fn sees the effective node
      const next = { ...t, box: { ...t.box, x: 12 }, data: { ...t.data, size: 44 } } as TypeNode;
      delete next.hidden;
      return next;
    }) as TypeNode;
    expect(out.box).toEqual(node().box);
    expect(out.data.size).toBe(70);
    expect(out.variants!.landscape).toEqual({ box: { w: 30, x: 12 }, layout: null, data: { size: 44, align: "center" }, hidden: null });
    const eff = resolveVariant(out, "landscape");
    expect(eff.box.x).toBe(12);
    expect(eff.data.size).toBe(44);
    expect(eff.hidden).toBeUndefined();
  });

  it("a key removed on the effective node becomes null in the variant", () => {
    const out = writeNode(node(), "story", (n) => {
      const t = { ...(n as TypeNode) };
      delete t.layout;
      return t;
    }) as TypeNode;
    expect(out.layout).toEqual(node().layout);
    expect(out.variants!.story).toEqual({ box: { y: 20 }, layout: null });
    expect(resolveVariant(out, "story").layout).toBeUndefined();
  });

  it("an unchanged node is returned as is", () => {
    const base = node();
    expect(writeNode(base, "landscape", (n) => n)).toBe(base);
  });
});
