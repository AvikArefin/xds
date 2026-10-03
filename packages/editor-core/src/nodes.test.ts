import { describe, expect, it } from "vitest";
import type { Project, RenderNode, TypeNode } from "@xds/protocol";
import {
  addNode,
  addSlide,
  deleteSlide,
  duplicateNodes,
  findNode,
  freshId,
  moveSlide,
  nudgeNodes,
  nudgePose,
  placeInMargin,
  removeNodes,
  reorderInLayer,
  setRenderPose,
} from "./nodes";

const guide = { width: 1080, height: 1350, u: 8, margins: { top: 64, right: 64, bottom: 64, left: 64 } };

function project(): Project {
  return {
    schemaVersion: 2,
    id: "p",
    name: "P",
    format: { preset: "instagram-portrait", width: 1080, height: 1350 },
    brand: { colors: [{ name: "paper", hex: "#ffffff" }], typography: {} },
    objects: [{ id: "bottle", name: "Bottle", kind: "model", asset: "bottle", pose: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }],
    slides: [
      {
        id: "s1",
        background: "paper",
        nodes: [
          { id: "bg", layer: "ground", box: { x: 0, y: 0, w: 100, h: 100 }, data: { design: "sweep" } },
          { id: "title", layer: "type", box: { x: 10, y: 10, w: 50, h: 10 }, data: { text: "Hi", role: "headline" } },
          {
            id: "obj",
            layer: "render",
            data: { object: "bottle", parts: { Lid: { rotate: [-15, 0, 0] } }, animation: { clip: "open", time: 1 }, screens: { Screen: "home" } },
          },
          { id: "sub", layer: "type", box: { x: 10, y: 25, w: 50, h: 5 }, data: { text: "Sub", role: "body" } },
          { id: "cta", layer: "type", box: { x: 10, y: 80, w: 30, h: 5 }, data: { text: "Buy", role: "body" } },
        ],
      },
      { id: "s2", background: "paper", nodes: [] },
    ],
  };
}

const ids = (p: Project, slide = 0) => (p.slides[slide].nodes ?? []).map((n) => n.id);

describe("freshId", () => {
  it("returns the base when free, else numbers it", () => {
    const taken = new Set(["title", "title-2"]);
    expect(freshId("title", taken)).toBe("title-3");
    expect(freshId("Big Word", taken)).toBe("big-word");
    expect(freshId("title-2", taken)).toBe("title-4");
  });
});

describe("duplicateNodes", () => {
  it("copies with fresh ids right after the original, offset", () => {
    const p = project();
    const r = duplicateNodes(p, "s1", ["title"]);
    expect(r.ids).toEqual(["title-2"]);
    expect(ids(r.project)).toEqual(["bg", "title", "title-2", "obj", "sub", "cta"]);
    const copy = findNode(r.project, "title-2")!.node as TypeNode;
    expect(copy.box.x).toBe(12);
    expect(copy.data).toEqual((p.slides[0].nodes![1] as TypeNode).data);
    expect(copy.data).not.toBe((p.slides[0].nodes![1] as TypeNode).data);
    expect(p.slides[0].nodes!.length).toBe(5); // input untouched
  });

  it("duplicates a render node with a copy of its object and keeps parts/screens", () => {
    const r = duplicateNodes(project(), "s1", ["obj"]);
    const copy = findNode(r.project, r.ids[0])!.node as RenderNode;
    expect(copy.data.object).toBe("bottle-2");
    expect(r.project.objects!.map((o) => o.id)).toEqual(["bottle", "bottle-2"]);
    expect(copy.data.parts).toEqual({ Lid: { rotate: [-15, 0, 0] } });
    expect(copy.data.pose!.position).toEqual([0.1, 0, 0]);
  });

  it("gives every copy a project-unique id", () => {
    const r = duplicateNodes(project(), "s1", ["sub", "cta"]);
    expect(new Set(r.ids).size).toBe(2);
    const all = ids(r.project);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("addNode / placeInMargin", () => {
  it("places the first block at the top-left margin", () => {
    const b = placeInMargin({ w: 400, h: 100 }, guide, []);
    expect(b.x).toBeCloseTo((64 / 1080) * 100, 3);
    expect(b.y).toBeCloseTo((64 / 1350) * 100, 3);
  });

  it("places a block below existing ones, inside the content area", () => {
    const b = placeInMargin({ w: 2000, h: 100 }, guide, [{ x: 10, y: 10, w: 50, h: 10 }]);
    const px = { x: (b.x / 100) * 1080, y: (b.y / 100) * 1350, w: (b.w / 100) * 1080 };
    expect(px.x).toBeCloseTo(64, 1);
    expect(px.w).toBeCloseTo(952, 1); // clamped to the content width
    expect(px.y).toBeGreaterThanOrEqual(270 + 16 - 0.01);
    expect(Math.round(px.y) % 8).toBe(0);
  });

  it("falls back to the top margin when below would overflow", () => {
    const b = placeInMargin({ w: 100, h: 100 }, guide, [{ x: 0, y: 80, w: 10, h: 15 }]);
    expect((b.y / 100) * 1350).toBeCloseTo(64, 1);
  });

  it("appends with a fresh id inside the margin", () => {
    const node: TypeNode = { id: "title", layer: "type", box: { x: 0, y: 0, w: 1, h: 1 }, data: { text: "New", role: "body" } };
    const r = addNode(project(), "s1", node, guide, { w: 600, h: 80 });
    expect(r.id).toBe("title-2");
    const added = findNode(r.project, r.id)!.node as TypeNode;
    expect((added.box.x / 100) * 1080).toBeCloseTo(64, 1);
    expect((added.box.y / 100) * 1350 + 80).toBeLessThanOrEqual(1350 - 64 + 0.01);
  });
});

describe("reorderInLayer", () => {
  it("moves a node within its layer and keeps other layers' slots", () => {
    const p = reorderInLayer(project(), "s1", "cta", "back");
    expect(ids(p)).toEqual(["bg", "cta", "obj", "title", "sub"]);
  });

  it("forward / backward / index", () => {
    expect(ids(reorderInLayer(project(), "s1", "title", "forward"))).toEqual(["bg", "sub", "obj", "title", "cta"]);
    expect(ids(reorderInLayer(project(), "s1", "sub", "backward"))).toEqual(["bg", "sub", "obj", "title", "cta"]);
    expect(ids(reorderInLayer(project(), "s1", "title", 2))).toEqual(["bg", "sub", "obj", "cta", "title"]);
  });

  it("is a no-op at the end", () => {
    const p = project();
    expect(reorderInLayer(p, "s1", "cta", "front").slides[0]).toBe(p.slides[0]);
  });
});

describe("nudge", () => {
  it("moves 2D boxes by px in percent", () => {
    const p = nudgeNodes(project(), "s1", ["title"], 10.8, -13.5, 1080, 1350);
    const box = (findNode(p, "title")!.node as TypeNode).box;
    expect(box.x).toBeCloseTo(11, 5);
    expect(box.y).toBeCloseTo(9, 5);
  });

  it("moves render nodes in meters and keeps parts/animation/screens", () => {
    const p = nudgePose(project(), "s1", ["obj"], [0.01, 0, -0.1]);
    const n = findNode(p, "obj")!.node as RenderNode;
    expect(n.data.pose!.position).toEqual([0.01, 0, -0.1]);
    expect(n.data.parts).toEqual({ Lid: { rotate: [-15, 0, 0] } });
    expect(n.data.animation).toEqual({ clip: "open", time: 1 });
    expect(n.data.screens).toEqual({ Screen: "home" });
  });

  it("setRenderPose merges over the effective pose", () => {
    const p = setRenderPose(project(), "s1", "obj", { rotation: [0, 45, 0] });
    const n = findNode(p, "obj")!.node as RenderNode;
    expect(n.data.pose).toEqual({ position: [0, 0, 0], rotation: [0, 45, 0], scale: [1, 1, 1] });
  });
});

describe("slides and removal", () => {
  it("adds, moves and deletes slides; never the last", () => {
    const a = addSlide(project());
    expect(a.id).toBe("s3");
    expect(a.project.slides.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(moveSlide(a.project, "s3", 0).slides.map((s) => s.id)).toEqual(["s3", "s1", "s2"]);
    const one = deleteSlide(deleteSlide(project(), "s2"), "s1");
    expect(one.slides.map((s) => s.id)).toEqual(["s1"]);
  });

  it("removes nodes", () => {
    expect(ids(removeNodes(project(), "s1", ["title", "cta"]))).toEqual(["bg", "obj", "sub"]);
  });
});
