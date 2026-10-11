import { describe, expect, it } from "vitest";
import type { Project, TypeNode } from "@xds/protocol";
import { applyEdit, applyEdits, setPath } from "./edits";

function project(): Project {
  return {
    schemaVersion: 3,
    id: "p",
    name: "P",
    format: { preset: "instagram-portrait", width: 1080, height: 1350 },
    brand: { colors: [{ name: "paper", hex: "#ffffff" }], typography: {} },
    screens: [{ id: "home", path: "screens/home/index.html", width: 390, height: 844 }],
    slides: [
      {
        id: "s1",
        nodes: [
          { id: "bg", layer: "ground", box: { x: 0, y: 0, w: 100, h: 100 }, data: { design: "sweep" } },
          {
            id: "title",
            layer: "type",
            box: { x: 10, y: 10, w: 50, h: 10 },
            layout: { stack: { below: "bg", gap: 2 } },
            data: { text: "Hi", role: "headline", size: 70 },
          },
        ],
      },
      { id: "s2", nodes: [] },
    ],
  };
}

describe("setPath", () => {
  it("writes, creates intermediates, deletes on null, refuses a missing index", () => {
    expect(setPath({ a: { b: 1 } }, "a.b", 2)).toEqual({ a: { b: 2 } });
    expect(setPath({}, "camera.height", 48)).toEqual({ camera: { height: 48 } });
    expect(setPath({ a: { b: 1, c: 2 } }, "a.b", null)).toEqual({ a: { c: 2 } });
    expect(setPath({ list: [{ v: 1 }] }, "list.0.v", 9)).toEqual({ list: [{ v: 9 }] });
    expect(setPath({ list: [{ v: 1 }] }, "list.3.v", 9)).toBeNull();
  });
});

describe("applyEdit", () => {
  it("edits a node, keeping other nodes and slides by reference", () => {
    const p = project();
    const next = applyEdit(p, { slideId: "s1", nodeId: "title", path: "box.y", value: 12.5 });
    const title = next.slides[0].nodes![1] as TypeNode;
    expect(title.box.y).toBe(12.5);
    expect(next.slides[0].nodes![0]).toBe(p.slides[0].nodes![0]);
    expect(next.slides[1]).toBe(p.slides[1]);
    expect((p.slides[0].nodes![1] as TypeNode).box.y).toBe(10);
  });

  it("writes a stacked block's gap and deletes a data field", () => {
    const p = project();
    const a = applyEdit(p, { nodeId: "title", path: "layout.stack.gap", value: 3 });
    expect((a.slides[0].nodes![1] as TypeNode).layout!.stack!.gap).toBe(3);
    const b = applyEdit(p, { nodeId: "title", path: "data.size" });
    expect((b.slides[0].nodes![1] as TypeNode).data.size).toBeUndefined();
  });

  it("edits a slide and the project; a missing target is a no-op", () => {
    const p = project();
    const a = applyEdit(p, { slideId: "s1", path: "camera.height", value: 48 });
    expect(a.slides[0].camera).toEqual({ height: 48 });
    const b = applyEdit(p, { path: "screens.0.scale", value: 3 });
    expect(b.screens![0].scale).toBe(3);
    expect(applyEdit(p, { slideId: "s1", nodeId: "gone", path: "box.y", value: 1 })).toBe(p);
    expect(applyEdit(p, { slideId: "s9", path: "camera.height", value: 1 })).toBe(p);
    expect(applyEdit(p, { path: "screens.7.scale", value: 1 })).toBe(p);
  });
});

describe("applyEdits", () => {
  it("applies in order and reports the nodes written and the edits skipped", () => {
    const r = applyEdits(project(), [
      { slideId: "s1", nodeId: "title", path: "box.y", value: 12 },
      { slideId: "s1", nodeId: "title", path: "data.size", value: 72 },
      { slideId: "s1", nodeId: "gone", path: "box.y", value: 1 },
      { slideId: "s1", path: "lighting.brightness", value: -0.3 },
    ]);
    const title = r.project.slides[0].nodes![1] as TypeNode;
    expect([title.box.y, title.data.size]).toEqual([12, 72]);
    expect(r.project.slides[0].lighting).toEqual({ brightness: -0.3 });
    expect(r.nodeIds).toEqual(["title"]);
    expect(r.skipped.map((e) => e.nodeId)).toEqual(["gone"]);
  });
});
