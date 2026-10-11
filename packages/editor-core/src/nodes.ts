/**
 * Pure node edit helpers. Every function returns a new `Project` (structural sharing; nothing is
 * mutated). None of them touches `parts`, `animation` or `screens` of a render node: those are
 * agent-only and are carried through unchanged.
 */
import { orientationOf, resolveVariants, writeNode } from "./variants";
import type {
  Box,
  GroundNode,
  Layer,
  Node,
  Pose,
  Project,
  RenderNode,
  SceneObject,
  Slide,
  Stack,
  Vec3,
} from "@xds/protocol";


/** The few guide numbers placement needs (snake_case like `formats.Guide.to_json()`). */
export interface GuideLike {
  width: number;
  height: number;
  u: number;
  margins: { top: number; right: number; bottom: number; left: number };
}

export const NODE_DEFAULT_POSE: Required<Pose> = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

// --- lookups -------------------------------------------------------------------------------

export function allNodeIds(project: Project): Set<string> {
  const ids = new Set<string>();
  for (const s of project.slides) for (const n of s.nodes ?? []) ids.add(n.id);
  for (const n of project.master?.nodes ?? []) ids.add(n.id);
  return ids;
}

// --- master nodes (data-models §2.11) -------------------------------------------------------

/** The project's master nodes (a background, the logo, …), shown on every slide unless left off. */
export function masterNodes(project: Project): Node[] {
  return (project.master?.nodes ?? []) as Node[];
}

export function isMasterNode(project: Project, nodeId: string): boolean {
  return masterNodes(project).some((n) => n.id === nodeId);
}

/** The master nodes a slide shows: all of them, none (`master: false`), or all but the listed ids. */
export function masterNodesFor(project: Project, slide: Slide | null | undefined): Node[] {
  if (!slide || slide.master === false) return [];
  const off = new Set(Array.isArray(slide.master) ? slide.master : []);
  return masterNodes(project).filter((n) => !off.has(n.id));
}

/**
 * Every node a slide draws: its master nodes first (so they sit behind the slide's own nodes of
 * the same layer), then its own. The stage, the lists and the editor's lookups read this.
 */
export function effectiveNodes(project: Project, slide: Slide | null | undefined): Node[] {
  const own = (slide?.nodes ?? []) as Node[];
  const master = masterNodesFor(project, slide);
  const all = master.length ? [...master, ...own] : own;
  // The format's orientation picks each node's variant (data-models §2.5c).
  return resolveVariants(all, orientationOf(project.format));
}

function updateMasterNodes(project: Project, ids: Set<string>, fn: (n: Node) => Node): Project {
  if (!project.master?.nodes?.some((n) => ids.has(n.id))) return project;
  return { ...project, master: { ...project.master, nodes: project.master.nodes.map((n) => (ids.has(n.id) ? fn(n as Node) : n)) } };
}

/** Move a slide node into the project's master nodes (it then shows on every slide). */
export function moveToMaster(project: Project, slideId: string, nodeId: string): Project {
  const slide = project.slides.find((s) => s.id === slideId);
  const node = (slide?.nodes ?? []).find((n) => n.id === nodeId) as Node | undefined;
  if (!slide || !node) return project;
  const slides = project.slides.map((s) => (s.id === slideId ? { ...s, nodes: (s.nodes ?? []).filter((n) => n.id !== nodeId) } : s));
  return { ...project, slides: slides as Project["slides"], master: { ...(project.master ?? {}), nodes: [...(project.master?.nodes ?? []), node] } };
}

/** Move a master node back onto one slide (appended to its nodes). */
export function moveToSlide(project: Project, slideId: string, nodeId: string): Project {
  const node = masterNodes(project).find((n) => n.id === nodeId);
  if (!node || !project.slides.some((s) => s.id === slideId)) return project;
  const rest = masterNodes(project).filter((n) => n.id !== nodeId);
  const out: Project = { ...project, master: { ...(project.master ?? {}), nodes: rest } };
  if (!rest.length) delete out.master;
  return updateSlide(out, slideId, (s) => ({ ...s, nodes: [...(s.nodes ?? []), node] as Slide["nodes"] }));
}

export interface NodeRef {
  slide: Slide;
  slideIndex: number;
  node: Node;
  index: number;
}

export function findNode(project: Project, nodeId: string): NodeRef | null {
  for (let si = 0; si < project.slides.length; si++) {
    const slide = project.slides[si];
    const nodes = slide.nodes ?? [];
    const index = nodes.findIndex((n) => n.id === nodeId);
    if (index >= 0) return { slide, slideIndex: si, node: nodes[index] as Node, index };
  }
  const mi = masterNodes(project).findIndex((n) => n.id === nodeId);
  if (mi >= 0) return { slide: { id: "master", nodes: project.master!.nodes }, slideIndex: -1, node: masterNodes(project)[mi], index: mi };
  return null;
}

export function slideNodes(project: Project, slideId: string): Node[] {
  return (project.slides.find((s) => s.id === slideId)?.nodes ?? []) as Node[];
}

/** A fresh id `<base>` or `<base>-2`, `<base>-3`, … not in `taken`. Adds it to `taken`. */
export function freshId(base: string, taken: Set<string>): string {
  const clean = (base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "node").replace(
    /-\d+$/,
    "",
  );
  let id = clean;
  for (let i = 2; taken.has(id); i++) id = `${clean}-${i}`;
  taken.add(id);
  return id;
}

// --- generic updates -----------------------------------------------------------------------

export function updateSlide(project: Project, slideId: string, fn: (s: Slide) => Slide): Project {
  let hit = false;
  const slides = project.slides.map((s) => {
    if (s.id !== slideId) return s;
    hit = true;
    return fn(s);
  }) as Project["slides"];
  return hit ? { ...project, slides } : project;
}

/**
 * Update nodes by id on a slide; a master node's id (shown there) updates the master node. `fn`
 * sees the node as the format shows it: while the format's orientation has a variant for the
 * node, the change is stored in that variant (`writeNode`), so the base keeps the other
 * orientations' values. `updateRawNodes` edits the stored node itself.
 */
export function updateNodes(
  project: Project,
  slideId: string,
  ids: Iterable<string>,
  fn: (n: Node) => Node,
): Project {
  const o = orientationOf(project.format);
  return updateRawNodes(project, slideId, ids, (n) => writeNode(n, o, fn));
}

/** Update the stored nodes (base and variants as written), bypassing variant routing. */
export function updateRawNodes(
  project: Project,
  slideId: string,
  ids: Iterable<string>,
  fn: (n: Node) => Node,
): Project {
  const set = new Set(ids);
  const next = updateSlide(project, slideId, (s) => ({
    ...s,
    nodes: (s.nodes ?? []).map((n) => (set.has(n.id) ? fn(n as Node) : n)),
  }));
  return updateMasterNodes(next, set, fn);
}

export function hasBox(n: Node): n is Exclude<Node, RenderNode> {
  return n.layer !== "render";
}

/** Remove nodes by id from a slide; a master node's id removes it from the master (every slide). */
export function removeNodes(project: Project, slideId: string, ids: Iterable<string>): Project {
  const set = new Set(ids);
  let out = updateSlide(project, slideId, (s) => ({ ...s, nodes: (s.nodes ?? []).filter((n) => !set.has(n.id)) }));
  if (out.master?.nodes?.some((n) => set.has(n.id))) {
    const nodes = out.master.nodes.filter((n) => !set.has(n.id));
    out = { ...out, master: { ...out.master, nodes } };
    if (!nodes.length) delete (out as { master?: unknown }).master;
  }
  return out;
}

// --- box math ------------------------------------------------------------------------------

const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

export function roundNodeBox(b: Box): Box {
  const out: Box = { ...b, x: round(b.x), y: round(b.y), w: round(b.w), h: round(b.h) };
  if (out.rotation !== undefined) out.rotation = round(out.rotation, 2);
  return out;
}

/** Percent box → px rect. */
export function percentBoxToPx(b: Box, W: number, H: number) {
  return { x: (b.x / 100) * W, y: (b.y / 100) * H, w: (b.w / 100) * W, h: (b.h / 100) * H };
}

/** Px rect → percent box (keeps rotation/opacity of `base`). */
export function pxRectToBox(r: { x: number; y: number; w: number; h: number }, W: number, H: number, base?: Box): Box {
  return roundNodeBox({
    ...(base ?? {}),
    x: (r.x / W) * 100,
    y: (r.y / H) * 100,
    w: Math.max(0.01, (r.w / W) * 100),
    h: Math.max(0.01, (r.h / H) * 100),
  });
}

// --- placement -----------------------------------------------------------------------------

/**
 * A box of `size` (px) placed inside the margin: at the left margin, below the lowest existing
 * block of `others` (with a gap of 2u) when that still fits, else at the top margin.
 * Returns a percent box.
 */
export function placeInMargin(
  size: { w: number; h: number },
  guide: GuideLike,
  others: Box[] = [],
): Box {
  const { width: W, height: H, margins, u } = guide;
  const cw = W - margins.left - margins.right;
  const ch = H - margins.top - margins.bottom;
  const w = Math.min(size.w, cw);
  const h = Math.min(size.h, ch);
  let y = margins.top;
  if (others.length) {
    const bottom = Math.max(...others.map((b) => ((b.y + b.h) / 100) * H));
    const below = Math.ceil((bottom + 2 * u) / u) * u;
    if (below + h <= H - margins.bottom) y = Math.max(margins.top, below);
  }
  return pxRectToBox({ x: margins.left, y, w, h }, W, H);
}

/** Append a new node, with a fresh id derived from `node.id`, inside the margin when it has a box. */
export function addNode(
  project: Project,
  slideId: string,
  node: Node,
  guide?: GuideLike,
  size?: { w: number; h: number },
): { project: Project; id: string } {
  const id = freshId(node.id, allNodeIds(project));
  let placed: Node = { ...node, id } as Node;
  if (hasBox(placed) && guide && size) {
    const others = slideNodes(project, slideId)
      .filter((n): n is Exclude<Node, RenderNode> => n.layer === placed.layer)
      .map((n) => n.box);
    placed = { ...placed, box: { ...placed.box, ...placeInMargin(size, guide, others) } } as Node;
  }
  return {
    project: updateSlide(project, slideId, (s) => ({ ...s, nodes: [...(s.nodes ?? []), placed] })),
    id,
  };
}

// --- duplicate -----------------------------------------------------------------------------

/**
 * Duplicate nodes on a slide with fresh ids, each inserted right after its original in z-order.
 * 2D boxes are offset by `offset` percent; a render node gets a copy of its scene object (fresh id)
 * shifted by `poseOffset` meters, because one object appears at most once per slide.
 */
export function duplicateNodes(
  project: Project,
  slideId: string,
  ids: string[],
  offset: { x: number; y: number } = { x: 2, y: 2 },
  poseOffset: Vec3 = [0.1, 0, 0],
): { project: Project; ids: string[] } {
  const want = new Set(ids);
  const taken = allNodeIds(project);
  const objTaken = new Set((project.objects ?? []).map((o) => o.id));
  const newObjects: SceneObject[] = [];
  const newIds: string[] = [];
  const next = updateSlide(project, slideId, (s) => {
    const out: Node[] = [];
    for (const n of (s.nodes ?? []) as Node[]) {
      out.push(n);
      if (!want.has(n.id)) continue;
      const id = freshId(n.id, taken);
      newIds.push(id);
      if (hasBox(n)) {
        out.push({ ...structuredClone(n), id, box: roundNodeBox({ ...n.box, x: n.box.x + offset.x, y: n.box.y + offset.y }) } as Node);
      } else {
        const obj = (project.objects ?? []).find((o) => o.id === n.data.object);
        const copy = structuredClone(n) as RenderNode;
        copy.id = id;
        if (obj) {
          const objId = freshId(obj.id, objTaken);
          newObjects.push({ ...structuredClone(obj), id: objId, name: `${obj.name} copy` });
          copy.data.object = objId;
        }
        const pose = renderNodePose(project, n);
        copy.data.pose = { ...pose, position: add3(pose.position, poseOffset) };
        out.push(copy);
      }
    }
    return { ...s, nodes: out };
  });
  return {
    project: newObjects.length ? { ...next, objects: [...(next.objects ?? []), ...newObjects] } : next,
    ids: newIds,
  };
}

// --- copy and paste ------------------------------------------------------------------------

/**
 * Copies of `nodes` with fresh ids (project-unique, taken from `taken`), no audit exceptions, and
 * stack anchors remapped: to the copy when the anchor was copied too, kept when `onSlide` has it,
 * dropped otherwise (an anchor must be on the same slide).
 */
export function cloneNodes(nodes: Node[], taken: Set<string>, onSlide: Set<string> = new Set()): Node[] {
  const map = new Map(nodes.map((n) => [n.id, freshId(n.id, taken)] as const));
  return nodes.map((n) => {
    const copy = structuredClone(n) as Node;
    copy.id = map.get(n.id)!;
    delete copy.exceptions;
    /** Remap a stack's anchor; null when the anchor is neither copied nor on the slide. */
    const remapStack = (stack: Stack): Stack | null => {
      const out = { ...stack };
      for (const key of ["below", "above", "rightOf", "leftOf"] as const) {
        const anchor = out[key];
        if (!anchor) continue;
        if (map.has(anchor)) out[key] = map.get(anchor);
        else if (!onSlide.has(anchor)) return null;
      }
      return out;
    };
    if (copy.layer === "type" && copy.data.stack) {
      const stack = remapStack(copy.data.stack);
      if (stack) copy.data.stack = stack;
      else delete copy.data.stack;
    }
    if (copy.layer !== "render" && copy.layout) {
      const layout = { ...copy.layout };
      if (layout.stack) {
        const stack = remapStack(layout.stack);
        if (stack) layout.stack = stack;
        else delete layout.stack;
      }
      if (layout.align) {
        const align = layout.align
          .filter((a) => map.has(a.node) || onSlide.has(a.node))
          .map((a) => (map.has(a.node) ? { ...a, node: map.get(a.node)! } : a));
        if (align.length) layout.align = align as typeof layout.align;
        else delete layout.align;
      }
      if (Object.keys(layout).length) copy.layout = layout;
      else delete copy.layout;
    }
    return copy;
  });
}

/**
 * Paste copies of `nodes` onto a slide, appended to its z-order, at the same boxes and poses.
 * A render node whose object is already on that slide gets a copy of the object (fresh id),
 * because one object appears at most once per slide; otherwise the object is shared.
 * Nodes whose object no longer exists are skipped.
 */
export function pasteNodes(project: Project, slideId: string, nodes: Node[]): { project: Project; ids: string[] } {
  const slide = project.slides.find((s) => s.id === slideId);
  if (!slide) return { project, ids: [] };
  const onSlide = new Set((slide.nodes ?? []).map((n) => n.id));
  const objects = project.objects ?? [];
  const objTaken = new Set(objects.map((o) => o.id));
  const used = new Set((slide.nodes ?? []).flatMap((n) => (n.layer === "render" ? [n.data.object] : [])));
  const newObjects: SceneObject[] = [];
  const copies = cloneNodes(
    nodes.filter((n) => n.layer !== "render" || objects.some((o) => o.id === n.data.object)),
    allNodeIds(project),
    onSlide,
  );
  for (const n of copies) {
    if (n.layer !== "render") {
      // a flow group is per slide: membership only survives where the group exists
      if (n.layout?.group && !slide.groups?.[n.layout.group]) {
        const layout = { ...n.layout };
        delete layout.group;
        if (Object.keys(layout).length) n.layout = layout;
        else delete n.layout;
      }
      continue;
    }
    const obj = objects.find((o) => o.id === n.data.object)!;
    if (!used.has(obj.id)) {
      used.add(obj.id);
      continue;
    }
    const objId = freshId(obj.id, objTaken);
    newObjects.push({ ...structuredClone(obj), id: objId, name: `${obj.name} copy` });
    n.data.object = objId;
  }
  const next = updateSlide(project, slideId, (s) => ({ ...s, nodes: [...(s.nodes ?? []), ...copies] as Slide["nodes"] }));
  return {
    project: newObjects.length ? { ...next, objects: [...objects, ...newObjects] } : next,
    ids: copies.map((n) => n.id),
  };
}

/**
 * Insert a copy of `slide` right after the slide `afterId` (default: the end): fresh slide and
 * node ids, "<name> copy", the same camera and lighting, no audit exceptions. Objects are shared
 * (a render node references the same object on both slides).
 */
export function duplicateSlide(project: Project, slide: Slide, afterId?: string): { project: Project; id: string } {
  const taken = new Set(project.slides.map((s) => s.id));
  let n = project.slides.length + 1;
  let id = `s${n}`;
  while (taken.has(id)) id = `s${++n}`;
  const copy: Slide = {
    ...structuredClone(slide),
    id,
    name: `${slide.name || slide.id} copy`,
    nodes: cloneNodes((slide.nodes ?? []) as Node[], allNodeIds(project)) as Slide["nodes"],
  };
  delete copy.exceptions;
  const at = project.slides.findIndex((s) => s.id === afterId) + 1;
  const slides = [...project.slides];
  slides.splice(at <= 0 ? slides.length : at, 0, copy);
  return { project: { ...project, slides: slides as Project["slides"] }, id };
}

// --- z-order within a layer ----------------------------------------------------------------

export type ReorderTo = "forward" | "backward" | "front" | "back" | number;

/**
 * Move a node within its own layer's z-order (array order among nodes of the same layer).
 * Nodes of other layers keep their array slots. A number is the target index among the layer's
 * nodes (0 = back).
 */
export function reorderInLayer(project: Project, slideId: string, nodeId: string, to: ReorderTo): Project {
  return updateSlide(project, slideId, (s) => {
    const nodes = [...((s.nodes ?? []) as Node[])];
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return s;
    const slots = nodes.map((n, i) => (n.layer === node.layer ? i : -1)).filter((i) => i >= 0);
    const layerNodes = slots.map((i) => nodes[i]);
    const from = layerNodes.indexOf(node);
    let target =
      to === "forward" ? from + 1 : to === "backward" ? from - 1 : to === "front" ? layerNodes.length - 1 : to === "back" ? 0 : to;
    target = Math.max(0, Math.min(layerNodes.length - 1, target));
    if (target === from) return s;
    layerNodes.splice(from, 1);
    layerNodes.splice(target, 0, node);
    slots.forEach((slot, k) => (nodes[slot] = layerNodes[k]));
    return { ...s, nodes };
  });
}

// --- nudge ---------------------------------------------------------------------------------

/** Move 2D nodes by (dx, dy) canvas px. */
export function nudgeNodes(
  project: Project,
  slideId: string,
  ids: string[],
  dx: number,
  dy: number,
  W: number,
  H: number,
): Project {
  return updateNodes(project, slideId, ids, (n) =>
    hasBox(n) ? ({ ...n, box: roundNodeBox({ ...n.box, x: n.box.x + (dx / W) * 100, y: n.box.y + (dy / H) * 100 }) } as Node) : n,
  );
}

const add3 = (a: Vec3, b: Vec3): Vec3 => [round(a[0] + b[0], 4), round(a[1] + b[1], 4), round(a[2] + b[2], 4)];

/** The pose a render node shows on its slide: its own, else its object's default, else identity. */
export function renderNodePose(project: Project, n: RenderNode): Required<Pose> {
  const obj = (project.objects ?? []).find((o) => o.id === n.data.object);
  const p = n.data.pose ?? obj?.pose ?? {};
  return {
    position: [...(p.position ?? NODE_DEFAULT_POSE.position)] as Vec3,
    rotation: [...(p.rotation ?? NODE_DEFAULT_POSE.rotation)] as Vec3,
    scale: [...(p.scale ?? NODE_DEFAULT_POSE.scale)] as Vec3,
  };
}

/** Move render nodes by `d` meters (writes this slide's pose; parts/animation/screens untouched). */
export function nudgePose(project: Project, slideId: string, ids: string[], d: Vec3): Project {
  return updateNodes(project, slideId, ids, (n) => {
    if (n.layer !== "render") return n;
    const pose = renderNodePose(project, n);
    return { ...n, data: { ...n.data, pose: { ...pose, position: add3(pose.position, d) } } };
  });
}

/** Write a render node's pose on a slide. */
export function setRenderPose(project: Project, slideId: string, nodeId: string, pose: Pose): Project {
  return updateNodes(project, slideId, [nodeId], (n) =>
    n.layer === "render" ? { ...n, data: { ...n.data, pose: { ...renderNodePose(project, n), ...pose } } } : n,
  );
}

// --- slides --------------------------------------------------------------------------------

/**
 * A ground node that paints the whole canvas: visible, unrotated, opaque, box 0–100 %. There is
 * no page color under the layers, so every slide needs one at the back (`UNCOVERED_CANVAS`).
 */
export function coversCanvas(n: Node): n is GroundNode {
  if (n.layer !== "ground" || n.hidden) return false;
  const b = n.box;
  const e = 1e-6;
  return b.x <= e && b.y <= e && b.x + b.w >= 100 - e && b.y + b.h >= 100 - e && (b.rotation ?? 0) % 360 === 0 && (b.opacity ?? 1) >= 1;
}

/** The slide's back full-canvas background node, if any (its own, not a master's). */
export function slideBackground(slide: Slide): GroundNode | undefined {
  return (slide.nodes ?? []).find(coversCanvas);
}

/** The background a slide shows: a master's full-canvas ground node, else its own. */
export function effectiveBackground(project: Project, slide: Slide): GroundNode | undefined {
  return masterNodesFor(project, slide).find(coversCanvas) ?? slideBackground(slide);
}

export function addSlide(project: Project, afterId?: string): { project: Project; id: string } {
  const taken = new Set(project.slides.map((s) => s.id));
  let n = project.slides.length + 1;
  let id = `s${n}`;
  while (taken.has(id)) id = `s${++n}`;
  const ref = project.slides.find((s) => s.id === afterId) ?? project.slides[project.slides.length - 1];
  // The new slide starts with the same full-canvas background as the one it follows, unless a
  // master background already covers every slide.
  const nodeIds = allNodeIds(project);
  const back = ref && !masterNodes(project).some(coversCanvas) ? slideBackground(ref) : undefined;
  const nodes: Node[] = back ? [{ ...back, id: freshId(`${id}-background`, nodeIds), name: back.name || "Background" }] : [];
  const slide: Slide = { id, name: `Slide ${project.slides.length + 1}`, nodes };
  const at = afterId ? project.slides.findIndex((s) => s.id === afterId) + 1 : project.slides.length;
  const slides = [...project.slides];
  slides.splice(at <= 0 ? slides.length : at, 0, slide);
  return { project: { ...project, slides: slides as Project["slides"] }, id };
}

export function moveSlide(project: Project, slideId: string, to: number): Project {
  const slides = [...project.slides];
  const from = slides.findIndex((s) => s.id === slideId);
  if (from < 0) return project;
  const [s] = slides.splice(from, 1);
  slides.splice(Math.max(0, Math.min(slides.length, to)), 0, s);
  return { ...project, slides: slides as Project["slides"] };
}

/** Delete a slide; never the last one (returns the project unchanged). */
export function deleteSlide(project: Project, slideId: string): Project {
  if (project.slides.length <= 1) return project;
  const slides = project.slides.filter((s) => s.id !== slideId);
  return slides.length === project.slides.length ? project : { ...project, slides: slides as Project["slides"] };
}

export function nodeLayer(n: Node): Layer {
  return n.layer;
}
