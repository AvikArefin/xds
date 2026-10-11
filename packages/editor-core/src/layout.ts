/**
 * Layout relations (data-models §2.5a): pins to the format's lines, edges shared with other
 * nodes, stacks on either axis, and a text box that fits its text. Every relation resolves to a
 * plain px rect; nothing here reads the DOM. The stage feeds it the slide's 2D nodes with the
 * text ink it measured, and the editor keeps each node's `box` equal to the result, so the
 * renderer, the audit and the handles never see a relation, only the box it decided.
 *
 * Order: pins first (they depend on the format only), then stacks and aligns in dependency order
 * (an anchor before what hangs on it; a missing anchor or a cycle leaves the node where its box
 * is), then `fit`. A stack or an align on an axis overrides a pin on that axis; a stack overrides
 * an align on the same axis (the gate reports LAYOUT_CONFLICT for that). Last come the slide's
 * flow groups (data-models §2.5b): a group's members are packed along its direction with a gap
 * between their ink, cross-aligned inside a box its pins place (or, unpinned, the union of the
 * members' boxes, so the group packs where it is and its padding is ignored). The group decides
 * both axes of a member, so a member's own stack or align is overridden.
 */
import { stackOf, type AlignTo, type Group, type Node, type Pin, type Pins, type Stack } from "@xds/protocol";
import type { Rect } from "./box";

/** A node's relations as the engine reads them: `layout`, with a type node's older `data.stack`. */
export function layoutSpecOf(n: Node): LayoutSpec | null {
  if (n.layer === "render") return null;
  const stack = stackOf(n);
  if (!n.layout && !stack) return null;
  return { ...(n.layout ?? {}), stack: stack ?? null };
}

export interface LayoutGuide {
  width: number;
  height: number;
  u: number;
  margins: { top: number; right: number; bottom: number; left: number };
  /** Platform safe zones, px rects. Only zones spanning a whole edge count for `safe` pins. */
  safeZones?: { x: number; y: number; w: number; h: number }[];
}

/** The relations of one node, wherever they were written (`layout`, or a type node's `data.stack`). */
export interface LayoutSpec {
  pin?: Pins | null;
  align?: AlignTo[] | null;
  stack?: Stack | null;
  fit?: "text" | null;
  group?: string | null;
}

export interface Ink {
  /** Relative to the box: a text block's ink lines; a box for everything else (0 … w/h). */
  top: number;
  bottom: number;
  left?: number;
  right?: number;
}

export interface LayoutItem {
  id: string;
  /** The node's own box, px. */
  rect: Rect;
  ink?: Ink | null;
  /** A text block's laid-out height, px (for `fit: "text"`). */
  contentHeight?: number | null;
  layout?: LayoutSpec | null;
}

export type Decider = "pin" | "align" | "stack" | "fit" | "group";
export type Edge = "left" | "right" | "top" | "bottom" | "cx" | "cy";
export type Axis = "x" | "y";

export interface StackResolution {
  axis: Axis;
  /** The position at gap 0: `pos = base + dir · gap · u` (pos = rect.x or rect.y). */
  base: number;
  /** +1 after the anchor (below / right of), −1 before it. */
  dir: 1 | -1;
  anchor: string;
}

export interface AlignResolution {
  anchor: string;
  edge: AlignTo["edge"];
  /** The anchor edge's px (the node's edge sits at `at + offset · u`). */
  at: number;
}

export interface GroupResolution {
  name: string;
  /** The member's position in the flow (0 = first). */
  index: number;
  /** The flow axis. */
  axis: Axis;
  /** The group's box, px (the members are packed inside it). */
  box: Rect;
  /** Pinned edges of the group box and their lines, like a node's. */
  pins?: Partial<Record<Edge, number>>;
}

export interface LayoutPlacement {
  rect: Rect;
  /** Which relation decided each field; absent fields are the node's own. */
  decided: Partial<Record<"x" | "y" | "w" | "h", Decider>>;
  /** Pinned edges and the px of the line each one pins to (before its offset). */
  pins?: Partial<Record<Edge, number>>;
  align?: Partial<Record<Axis, AlignResolution>>;
  stack?: StackResolution;
  group?: GroupResolution;
}

/** The slide's flow groups, by name (`Slide.groups`). */
export type GroupSpecs = Record<string, Group>;

export const axisOf = (edge: AlignTo["edge"] | Edge): Axis =>
  edge === "left" || edge === "center" || edge === "right" || edge === "cx" ? "x" : "y";

export function stackAxis(s: Stack | null | undefined): Axis | null {
  if (!s) return null;
  return s.rightOf || s.leftOf ? "x" : s.below || s.above ? "y" : null;
}

export function stackAnchorId(s: Stack | null | undefined): string | null {
  return s?.below || s?.above || s?.rightOf || s?.leftOf || null;
}

/** The format fallback when no guide is available: u = s/135, m = 6 % of s on the u grid. */
export function fallbackGuide(width: number, height: number): LayoutGuide {
  const s = Math.min(width, height);
  const u = Math.max(4, Math.round(s / 135));
  const m = Math.max(u, Math.round((0.06 * s) / u) * u);
  return { width, height, u, margins: { top: m, right: m, bottom: m, left: m }, safeZones: [] };
}

/** Insets the safe zones leave on each edge (zones that span the whole edge; a corner badge doesn't). */
export function safeInsets(g: LayoutGuide): { top: number; right: number; bottom: number; left: number } {
  const out = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const z of g.safeZones ?? []) {
    const spansX = z.w >= g.width * 0.9;
    const spansY = z.h >= g.height * 0.9;
    if (spansX && z.y <= 0) out.top = Math.max(out.top, z.y + z.h);
    if (spansX && z.y + z.h >= g.height) out.bottom = Math.max(out.bottom, g.height - z.y);
    if (spansY && z.x <= 0) out.left = Math.max(out.left, z.x + z.w);
    if (spansY && z.x + z.w >= g.width) out.right = Math.max(out.right, g.width - z.x);
  }
  return out;
}

/** The px of a format line for an edge, before the pin's offset. */
export function lineFor(edge: Edge, to: Pin["to"], g: LayoutGuide): number {
  const axis = axisOf(edge);
  const size = axis === "x" ? g.width : g.height;
  const safe = safeInsets(g);
  const start = edge === "left" || edge === "top";
  const end = edge === "right" || edge === "bottom";
  switch (to) {
    case "edge":
      return start ? 0 : end ? size : size / 2;
    case "safe":
      return start ? (axis === "x" ? safe.left : safe.top) : end ? size - (axis === "x" ? safe.right : safe.bottom) : size / 2;
    case "margin":
      return start
        ? axis === "x"
          ? g.margins.left
          : g.margins.top
        : end
          ? size - (axis === "x" ? g.margins.right : g.margins.bottom)
          : size / 2;
    case "center":
      return size / 2;
    case "third":
      return size / 3;
    case "two-thirds":
      return (2 * size) / 3;
  }
}

const EDGES: Edge[] = ["left", "right", "top", "bottom", "cx", "cy"];

function edgeValue(r: Rect, edge: AlignTo["edge"]): number {
  switch (edge) {
    case "left":
      return r.x;
    case "center":
      return r.x + r.w / 2;
    case "right":
      return r.x + r.w;
    case "top":
      return r.y;
    case "middle":
      return r.y + r.h / 2;
    case "bottom":
      return r.y + r.h;
  }
}

function inkOf(item: LayoutItem): Required<Ink> {
  const i = item.ink;
  return {
    top: i?.top ?? 0,
    bottom: i?.bottom ?? item.rect.h,
    left: i?.left ?? 0,
    right: i?.right ?? item.rect.w,
  };
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Apply pins to a rect in place; returns the decided fields and the lines pinned to. */
function applyPins(r: Rect, pin: Pins, guide: LayoutGuide, u: number) {
  const decided: LayoutPlacement["decided"] = {};
  const pins: Partial<Record<Edge, number>> = {};
  const px = (edge: Edge, p: Pin | null | undefined) => {
    if (!p) return undefined;
    const line = lineFor(edge, p.to, guide);
    pins[edge] = line;
    return line + (p.offset ?? 0) * u;
  };
  const L = px("left", pin.left);
  const R = px("right", pin.right);
  const CX = px("cx", pin.cx);
  if (L !== undefined && R !== undefined) {
    r.x = L;
    r.w = Math.max(1, R - L);
    decided.x = decided.w = "pin";
  } else if (L !== undefined) {
    r.x = L;
    decided.x = "pin";
  } else if (R !== undefined) {
    r.x = R - r.w;
    decided.x = "pin";
  } else if (CX !== undefined) {
    r.x = CX - r.w / 2;
    decided.x = "pin";
  }
  const T = px("top", pin.top);
  const B = px("bottom", pin.bottom);
  const CY = px("cy", pin.cy);
  if (T !== undefined && B !== undefined) {
    r.y = T;
    r.h = Math.max(1, B - T);
    decided.y = decided.h = "pin";
  } else if (T !== undefined) {
    r.y = T;
    decided.y = "pin";
  } else if (B !== undefined) {
    r.y = B - r.h;
    decided.y = "pin";
  } else if (CY !== undefined) {
    r.y = CY - r.h / 2;
    decided.y = "pin";
  }
  return { decided, pins: Object.keys(pins).length ? pins : undefined };
}

function unionOf(rs: Rect[]): Rect {
  const x0 = Math.min(...rs.map((r) => r.x));
  const y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w));
  const y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Resolve every 2D node's rect. Only nodes with at least one decided field appear in the result.
 * `groups` are the slide's flow groups; a node joins one with `layout.group`.
 */
export function resolveLayout(items: LayoutItem[], guide: LayoutGuide, groups: GroupSpecs = {}): Map<string, LayoutPlacement> {
  const u = guide.u || 1;
  const byId = new Map(items.map((i) => [i.id, i]));
  const out = new Map<string, LayoutPlacement>();
  const rects = new Map<string, Rect>();
  const visiting = new Set<string>();

  const spec = (item: LayoutItem): LayoutSpec => item.layout ?? {};

  const resolve = (item: LayoutItem): Rect => {
    const known = rects.get(item.id);
    if (known) return known;
    const s = spec(item);
    const r: Rect = { ...item.rect };
    const p: LayoutPlacement = { rect: r, decided: {} };

    // --- pins -------------------------------------------------------------------------------
    if (s.pin) {
      const applied = applyPins(r, s.pin, guide, u);
      Object.assign(p.decided, applied.decided);
      if (applied.pins) p.pins = applied.pins;
    }

    // --- relations to other nodes (anchors first) --------------------------------------------
    visiting.add(item.id);
    const anchorRect = (id: string | null | undefined): Rect | null => {
      const a = id ? byId.get(id) : undefined;
      if (!a || a === item || visiting.has(a.id)) return null;
      return resolve(a);
    };

    const stackAx = stackAxis(s.stack);
    for (const al of s.align ?? []) {
      const axis = axisOf(al.edge);
      if (axis === stackAx) continue; // the stack wins on its axis
      const ar = anchorRect(al.node);
      if (!ar) continue;
      const at = edgeValue(ar, al.edge);
      const off = (al.offset ?? 0) * u;
      if (axis === "x") r.x = al.edge === "left" ? at + off : al.edge === "center" ? at - r.w / 2 + off : at - r.w + off;
      else r.y = al.edge === "top" ? at + off : al.edge === "middle" ? at - r.h / 2 + off : at - r.h + off;
      p.decided[axis] = "align";
      (p.align ??= {})[axis] = { anchor: al.node, edge: al.edge, at };
    }

    if (s.stack && stackAx) {
      const anchorId = stackAnchorId(s.stack);
      const ar = anchorRect(anchorId);
      const anchor = anchorId ? byId.get(anchorId) : undefined;
      if (ar && anchor) {
        const ai = inkOf(anchor);
        const ii = inkOf(item);
        const gap = (s.stack.gap ?? 2) * u;
        if (stackAx === "y") {
          const dir: 1 | -1 = s.stack.below ? 1 : -1;
          const base = dir === 1 ? ar.y + ai.bottom - ii.top : ar.y + ai.top - ii.bottom;
          r.y = base + dir * gap;
          p.decided.y = "stack";
          p.stack = { axis: "y", base, dir, anchor: anchor.id };
        } else {
          const dir: 1 | -1 = s.stack.rightOf ? 1 : -1;
          const base = dir === 1 ? ar.x + ai.right - ii.left : ar.x + ai.left - ii.right;
          r.x = base + dir * gap;
          p.decided.x = "stack";
          p.stack = { axis: "x", base, dir, anchor: anchor.id };
        }
      }
    }
    visiting.delete(item.id);

    // --- fit ----------------------------------------------------------------------------------
    if (s.fit === "text" && item.contentHeight && item.contentHeight > 0) {
      r.h = Math.ceil(item.contentHeight);
      p.decided.h = "fit";
    }

    r.x = r3(r.x);
    r.y = r3(r.y);
    r.w = r3(r.w);
    r.h = r3(r.h);
    rects.set(item.id, r);
    if (Object.keys(p.decided).length) out.set(item.id, p);
    return r;
  };

  for (const item of items) resolve(item);

  // --- groups: flow ----------------------------------------------------------------------------
  for (const [name, g] of Object.entries(groups)) {
    const members = items.filter((i) => i.layout?.group === name);
    if (!members.length) continue;
    const axis: Axis = g.direction === "row" ? "x" : "y";
    const cross: Axis = axis === "x" ? "y" : "x";
    const size = (a: Axis) => (a === "x" ? "w" : "h") as "w" | "h";
    const box = unionOf(members.map((m) => rects.get(m.id)!));
    const pinned = !!g.pin && Object.values(g.pin).some(Boolean);
    let pins: Partial<Record<Edge, number>> | undefined;
    if (pinned) {
      const applied = applyPins(box, g.pin!, guide, u);
      pins = applied.pins;
    }
    const pad = pinned ? (g.padding ?? 0) * u : 0;
    const gap = (g.gap ?? 2) * u;
    let cursor = box[axis] + pad;
    members.forEach((m, index) => {
      const r = { ...rects.get(m.id)! };
      const ink = inkOf(m);
      const start = axis === "x" ? ink.left : ink.top;
      const end = axis === "x" ? ink.right : ink.bottom;
      r[axis] = r3(cursor - start);
      cursor = r[axis] + end + gap;
      const extent = r[size(cross)];
      const align = g.align ?? "start";
      r[cross] = r3(
        align === "start"
          ? box[cross] + pad
          : align === "center"
            ? box[cross] + box[size(cross)] / 2 - extent / 2
            : box[cross] + box[size(cross)] - pad - extent,
      );
      rects.set(m.id, r);
      const prev = out.get(m.id);
      const p: LayoutPlacement = prev ? { ...prev, rect: r, decided: { ...prev.decided } } : { rect: r, decided: {} };
      p.decided[axis] = "group";
      p.decided[cross] = "group";
      p.group = { name, index, axis, box, pins };
      out.set(m.id, p);
    });
  }
  return out;
}

/** The knob value that puts a dragged node at `pos` on the stack's axis: its gap in u. */
export function gapForPosition(s: Pick<StackResolution, "base" | "dir">, pos: number, u: number, round = 0): number {
  const gap = (s.dir * (pos - s.base)) / (u || 1);
  return round > 0 ? Math.round(gap / round) * round : Math.round(gap * 100) / 100;
}

/** The pin offset (u) that puts an edge at `value` when its line is at `line`. */
export function offsetFor(value: number, line: number, u: number, round = 0): number {
  const off = (value - line) / (u || 1);
  return round > 0 ? Math.round(off / round) * round : Math.round(off * 100) / 100;
}

/** The value of a rect's edge (px) for a pinned edge name. */
export function pinnedEdgeValue(r: Rect, edge: Edge): number {
  switch (edge) {
    case "left":
      return r.x;
    case "right":
      return r.x + r.w;
    case "top":
      return r.y;
    case "bottom":
      return r.y + r.h;
    case "cx":
      return r.x + r.w / 2;
    case "cy":
      return r.y + r.h / 2;
  }
}

export { EDGES as PIN_EDGES };

/** Does a layout spec hold any relation at all? */
export function hasRelations(s: LayoutSpec | null | undefined): boolean {
  if (!s) return false;
  return !!(s.pin && Object.values(s.pin).some(Boolean)) || !!s.align?.length || !!s.stack || !!s.fit || !!s.group;
}
