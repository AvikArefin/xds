import { describe, expect, it } from "vitest";
import type { Project, RenderNode, TypeNode } from "@xds/protocol";
import {
  addNode,
  updateNodes,
  allNodeIds,
  addSlide,
  coversCanvas,
  slideBackground,
  cloneNodes,
  deleteSlide,
  duplicateNodes,
  duplicateSlide,
  effectiveBackground,
  effectiveNodes,
  moveToMaster,
  moveToSlide,
  findNode,
  freshId,
  moveSlide,
  nudgeNodes,
  nudgePose,
  pasteNodes,
  placeInMargin,
  removeNodes,
  reorderInLayer,
  setRenderPose,
} from "./nodes";

const guide = { width: 1080, height: 1350, u: 8, margins: { top: 64, right: 64, bottom: 64, left: 64 } };

function project(): Project {
  return {
    schemaVersion: 3,
    id: "p",
    name: "P",
    format: { preset: "instagram-portrait", width: 1080, height: 1350 },
    brand: { colors: [{ name: "paper", hex: "#ffffff" }], typography: {} },
    objects: [{ id: "bottle", name: "Bottle", kind: "model", asset: "bottle", pose: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }],
    slides: [
      {
        id: "s1",
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
      { id: "s2", nodes: [] },
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

  it("a new slide copies the full-canvas background of the slide it follows", () => {
    const a = addSlide(project(), "s1");
    const added = a.project.slides.find((s) => s.id === a.id)!;
    expect(added.nodes).toEqual([
      { id: "s3-background", layer: "ground", name: "Background", box: { x: 0, y: 0, w: 100, h: 100 }, data: { design: "sweep" } },
    ]);
    expect(slideBackground(added)?.data.design).toBe("sweep");
    expect(addSlide(project(), "s2").project.slides[2].nodes).toEqual([]); // s2 has none to copy
    expect(coversCanvas({ id: "g", layer: "ground", box: { x: 0, y: 0, w: 100, h: 90 }, data: { design: "x" } })).toBe(false);
  });

  it("removes nodes", () => {
    expect(ids(removeNodes(project(), "s1", ["title", "cta"]))).toEqual(["bg", "obj", "sub"]);
  });
});

describe("copy and paste", () => {
  const stacked = (): Project => {
    const p = project();
    p.slides[0].nodes!.push({
      id: "note",
      layer: "type",
      box: { x: 10, y: 40, w: 50, h: 5 },
      exceptions: [{ rule: "TYPE_SMALL", reason: "fine" }],
      data: { text: "Note", role: "body", stack: { below: "sub", gap: 2 } },
    } as TypeNode);
    return p;
  };

  it("cloneNodes gives fresh ids, drops exceptions and remaps a copied anchor", () => {
    const [sub, note] = cloneNodes(
      [findNode(stacked(), "sub")!.node, findNode(stacked(), "note")!.node],
      new Set(["sub", "note"]),
    );
    expect([sub.id, note.id]).toEqual(["sub-2", "note-2"]);
    expect(note.exceptions).toBeUndefined();
    expect((note as TypeNode).data.stack).toEqual({ below: "sub-2", gap: 2 });
  });

  it("cloneNodes keeps an anchor that is on the target slide and drops one that is not", () => {
    const note = findNode(stacked(), "note")!.node;
    expect((cloneNodes([note], new Set(["note"]), new Set(["sub"]))[0] as TypeNode).data.stack).toEqual({ below: "sub", gap: 2 });
    expect((cloneNodes([note], new Set(["note"]))[0] as TypeNode).data.stack).toBeUndefined();
  });

  it("pastes onto another slide at the same box, appended", () => {
    const p = stacked();
    const r = pasteNodes(p, "s2", [findNode(p, "title")!.node, findNode(p, "note")!.node]);
    expect(r.ids).toEqual(["title-2", "note-2"]);
    expect(ids(r.project, 1)).toEqual(["title-2", "note-2"]);
    const copy = findNode(r.project, "title-2")!.node as TypeNode;
    expect(copy.box).toEqual({ x: 10, y: 10, w: 50, h: 10 });
    expect((findNode(r.project, "note-2")!.node as TypeNode).data.stack).toBeUndefined(); // "sub" is not on s2
    expect(ids(r.project, 0)).toEqual(["bg", "title", "obj", "sub", "cta", "note"]); // the source is untouched
  });

  it("pastes a render node sharing its object, and copies the object when it is already there", () => {
    const p = project();
    const obj = findNode(p, "obj")!.node;
    const other = pasteNodes(p, "s2", [obj]);
    expect((findNode(other.project, other.ids[0])!.node as RenderNode).data.object).toBe("bottle");
    expect(other.project.objects!.length).toBe(1);
    const same = pasteNodes(p, "s1", [obj]);
    const n = findNode(same.project, same.ids[0])!.node as RenderNode;
    expect(n.data.object).toBe("bottle-2");
    expect(n.data.parts).toEqual({ Lid: { rotate: [-15, 0, 0] } });
    expect(same.project.objects!.map((o) => o.id)).toEqual(["bottle", "bottle-2"]);
  });

  it("skips a render node whose object is gone", () => {
    const p = project();
    const r = pasteNodes({ ...p, objects: [] }, "s2", [findNode(p, "obj")!.node, findNode(p, "cta")!.node]);
    expect(r.ids).toEqual(["cta-2"]);
  });

  it("duplicates a slide right after the original with fresh ids and the same layout", () => {
    const p = stacked();
    p.slides[0].name = "Cover";
    p.slides[0].camera = { mode: "frame", yaw: 10 };
    p.slides[0].exceptions = [{ rule: "UNCOVERED_CANVAS", reason: "x" }];
    const r = duplicateSlide(p, p.slides[0], "s1");
    expect(r.id).toBe("s3");
    expect(r.project.slides.map((s) => s.id)).toEqual(["s1", "s3", "s2"]);
    const copy = r.project.slides[1];
    expect(copy.name).toBe("Cover copy");
    expect(copy.camera).toEqual({ mode: "frame", yaw: 10 });
    expect(copy.exceptions).toBeUndefined();
    expect(ids(r.project, 1)).toEqual(["bg-2", "title-2", "obj-2", "sub-2", "cta-2", "note-2"]);
    expect((findNode(r.project, "note-2")!.node as TypeNode).data.stack).toEqual({ below: "sub-2", gap: 2 });
    expect((findNode(r.project, "obj-2")!.node as RenderNode).data.object).toBe("bottle");
    expect((findNode(r.project, "title-2")!.node as TypeNode).box).toEqual({ x: 10, y: 10, w: 50, h: 10 });
    expect(duplicateSlide(p, p.slides[1]).project.slides.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
  });
});

describe("master nodes", () => {
  it("shows master nodes first on every slide unless a slide leaves them off", () => {
    const p = moveToMaster(project(), "s1", "bg");
    expect(p.master?.nodes?.map((n) => n.id)).toEqual(["bg"]);
    expect(ids(p)).toEqual(["title", "obj", "sub", "cta"]);
    expect(effectiveNodes(p, p.slides[1]).map((n) => n.id)).toEqual(["bg"]);
    expect(effectiveNodes(p, p.slides[0]).map((n) => n.id)).toEqual(["bg", "title", "obj", "sub", "cta"]);
    expect(effectiveNodes(p, { ...p.slides[1], master: false })).toEqual([]);
    expect(effectiveNodes(p, { ...p.slides[1], master: ["bg"] })).toEqual([]);
    expect(effectiveBackground(p, p.slides[1])?.id).toBe("bg");
    expect(effectiveBackground(project(), project().slides[1])).toBeUndefined();
  });

  it("edits and removes a master node through the slide it is seen on", () => {
    const p = moveToMaster(project(), "s1", "bg");
    const edited = updateNodes(p, "s2", ["bg"], (n) => ({ ...n, name: "Paper" }));
    expect(edited.master?.nodes?.[0]?.name).toBe("Paper");
    expect(findNode(edited, "bg")!.node.name).toBe("Paper");
    const gone = removeNodes(edited, "s2", ["bg"]);
    expect(gone.master).toBeUndefined();
    expect(allNodeIds(p).has("bg")).toBe(true);
  });

  it("moves a master node back onto one slide, and a new slide skips the background copy while a master covers the canvas", () => {
    const p = moveToMaster(project(), "s1", "bg");
    expect(addSlide(p, "s1").project.slides[1].nodes).toEqual([]);
    const back = moveToSlide(p, "s2", "bg");
    expect(back.master).toBeUndefined();
    expect(ids(back, 1)).toEqual(["bg"]);
  });
});

describe("groups and paste", () => {
  it("keeps a member's group only where the target slide declares it", () => {
    const p = project();
    p.slides[0].groups = { intro: { direction: "column", gap: 2 } };
    (p.slides[0].nodes![1] as TypeNode).layout = { group: "intro", pin: { left: { to: "margin" } } };
    const title = findNode(p, "title")!.node;
    const same = pasteNodes(p, "s1", [title]);
    expect((findNode(same.project, same.ids[0])!.node as TypeNode).layout).toEqual({ group: "intro", pin: { left: { to: "margin" } } });
    const other = pasteNodes(p, "s2", [title]);
    expect((findNode(other.project, other.ids[0])!.node as TypeNode).layout).toEqual({ pin: { left: { to: "margin" } } });
    expect(duplicateSlide(p, p.slides[0], "s1").project.slides[1].groups).toEqual({ intro: { direction: "column", gap: 2 } });
  });
});
