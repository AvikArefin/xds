/**
 * Snapping for 2D blocks (human-interaction.md §3): the margin, the `u` grid, other blocks'
 * edges and centers, the canvas center and the third lines, and **gaps**: the space between a
 * moving edge and the nearest neighbor's facing edge snaps to multiples of `u`, so spacing lands
 * on the scale by feel.
 *
 * Everything here works in canvas px (the format's native pixels), so a threshold means the same
 * thing on both axes. Convert percent boxes to px before calling.
 */

export interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SnapKind = "margin" | "canvas" | "center" | "third" | "edge" | "grid" | "gap";

export interface SnapLine {
  axis: "x" | "y";
  value: number;
  kind: SnapKind;
}

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface SnapContext {
  width: number;
  height: number;
  margins?: Margins;
  /** The spacing unit; edges snap to multiples of it when nothing closer matches. */
  u?: number;
  /** Other blocks (not the ones being moved). */
  others?: PxRect[];
  thirds?: boolean;
}

export interface SnapTargets {
  x: SnapLine[];
  y: SnapLine[];
  u?: number;
  /** The other blocks, for gap snapping. */
  others?: PxRect[];
}

/** Every line a block can snap to, per axis. */
export function snapTargets(ctx: SnapContext): SnapTargets {
  const { width: W, height: H } = ctx;
  const x: SnapLine[] = [];
  const y: SnapLine[] = [];
  const add = (axis: "x" | "y", value: number, kind: SnapKind) =>
    (axis === "x" ? x : y).push({ axis, value, kind });

  add("x", 0, "canvas");
  add("x", W, "canvas");
  add("x", W / 2, "canvas");
  add("y", 0, "canvas");
  add("y", H, "canvas");
  add("y", H / 2, "canvas");
  if (ctx.margins) {
    add("x", ctx.margins.left, "margin");
    add("x", W - ctx.margins.right, "margin");
    add("y", ctx.margins.top, "margin");
    add("y", H - ctx.margins.bottom, "margin");
  }
  if (ctx.thirds !== false) {
    add("x", W / 3, "third");
    add("x", (2 * W) / 3, "third");
    add("y", H / 3, "third");
    add("y", (2 * H) / 3, "third");
  }
  for (const r of ctx.others ?? []) {
    add("x", r.x, "edge");
    add("x", r.x + r.w, "edge");
    add("x", r.x + r.w / 2, "center");
    add("y", r.y, "edge");
    add("y", r.y + r.h, "edge");
    add("y", r.y + r.h / 2, "center");
  }
  return { x, y, u: ctx.u, others: ctx.others };
}

export interface AxisSnap {
  /** The correction to add to the moving value(s). */
  delta: number;
  line: SnapLine | null;
}

/**
 * Snap any of `values` (the moving edges/center along one axis) to the nearest line within
 * `threshold`. Named lines win over the grid; the grid applies only when no line is close.
 */
export function snapAxis(
  values: number[],
  lines: SnapLine[],
  threshold: number,
  u?: number,
  axis: "x" | "y" = "x",
): AxisSnap {
  let best: AxisSnap = { delta: 0, line: null };
  let bestDist = Infinity;
  for (const v of values) {
    for (const line of lines) {
      const d = line.value - v;
      if (Math.abs(d) <= threshold && Math.abs(d) < bestDist) {
        bestDist = Math.abs(d);
        best = { delta: d, line };
      }
    }
  }
  if (best.line || !u || u <= 0) return best;
  for (const v of values) {
    const g = Math.round(v / u) * u;
    const d = g - v;
    if (Math.abs(d) <= threshold && Math.abs(d) < bestDist) {
      bestDist = Math.abs(d);
      best = { delta: d, line: { axis, value: g, kind: "grid" } };
    }
  }
  return best;
}

export interface SnapResult {
  rect: PxRect;
  guides: SnapLine[];
}

/** A neighbor's facing edge on one axis, and the gap to it (> 0 when they don't overlap). */
export interface Neighbor {
  rect: PxRect;
  /** The neighbor's edge the gap is measured from. */
  edge: number;
  /** Which side of the moving rect it sits on. */
  side: "before" | "after";
  gap: number;
}

/**
 * The nearest neighbors of `rect` on an axis: the closest block before it (above / left) and
 * after it (below / right) that overlaps it on the other axis, with the gap between the facing
 * edges. Overlapping blocks are not neighbors.
 */
export function neighbors(rect: PxRect, others: PxRect[], axis: "x" | "y"): { before: Neighbor | null; after: Neighbor | null } {
  const lo = axis === "x" ? rect.x : rect.y;
  const hi = lo + (axis === "x" ? rect.w : rect.h);
  let before: Neighbor | null = null;
  let after: Neighbor | null = null;
  for (const o of others) {
    const cross =
      axis === "x" ? Math.min(rect.y + rect.h, o.y + o.h) - Math.max(rect.y, o.y) : Math.min(rect.x + rect.w, o.x + o.w) - Math.max(rect.x, o.x);
    if (cross <= 0) continue;
    const oLo = axis === "x" ? o.x : o.y;
    const oHi = oLo + (axis === "x" ? o.w : o.h);
    if (oHi <= lo) {
      const gap = lo - oHi;
      if (!before || gap < before.gap) before = { rect: o, edge: oHi, side: "before", gap };
    } else if (oLo >= hi) {
      const gap = oLo - hi;
      if (!after || gap < after.gap) after = { rect: o, edge: oLo, side: "after", gap };
    }
  }
  return { before, after };
}

/**
 * Gap snapping on one axis: the gap to the nearest neighbor on either side snaps to a multiple
 * of `u` (never 0) within `threshold`. Returns the correction to the moving value(s) and the
 * line (the snapped edge's position) for the overlay.
 */
export function snapGap(rect: PxRect, others: PxRect[], axis: "x" | "y", u: number, threshold: number): AxisSnap {
  let best: AxisSnap = { delta: 0, line: null };
  let bestDist = Infinity;
  if (!u || u <= 0) return best;
  const { before, after } = neighbors(rect, others, axis);
  const lo = axis === "x" ? rect.x : rect.y;
  const hi = lo + (axis === "x" ? rect.w : rect.h);
  for (const n of [before, after]) {
    if (!n) continue;
    const target = Math.max(u, Math.round(n.gap / u) * u);
    const d = (target - n.gap) * (n.side === "before" ? 1 : -1);
    if (Math.abs(d) <= threshold && Math.abs(d) < bestDist) {
      bestDist = Math.abs(d);
      best = { delta: d, line: { axis, value: (n.side === "before" ? lo : hi) + d, kind: "gap" } };
    }
  }
  return best;
}

/**
 * Snap a moved rect: its left/center/right and top/middle/bottom each try every line; when no
 * line is close, the gaps to its neighbors try the `u` scale, then the edges try the grid.
 */
export function snapMove(rect: PxRect, targets: SnapTargets, threshold: number): SnapResult {
  const axisSnap = (axis: "x" | "y"): AxisSnap => {
    const values = axis === "x" ? [rect.x, rect.x + rect.w / 2, rect.x + rect.w] : [rect.y, rect.y + rect.h / 2, rect.y + rect.h];
    const lines = axis === "x" ? targets.x : targets.y;
    const named = snapAxis(values, lines, threshold);
    if (named.line) return named;
    if (targets.others?.length && targets.u) {
      const g = snapGap(rect, targets.others, axis, targets.u, Math.max(threshold, targets.u / 2));
      if (g.line) return g;
    }
    return snapAxis(values, [], threshold, targets.u, axis);
  };
  const sx = axisSnap("x");
  const sy = axisSnap("y");
  const guides = [sx.line, sy.line].filter((l): l is SnapLine => !!l);
  return { rect: { ...rect, x: rect.x + sx.delta, y: rect.y + sy.delta }, guides };
}

export interface ResizeEdges {
  left?: boolean;
  right?: boolean;
  top?: boolean;
  bottom?: boolean;
}

/** Snap only the edges being dragged by a resize handle. Keeps w/h ≥ `minSize`. */
export function snapResize(
  rect: PxRect,
  edges: ResizeEdges,
  targets: SnapTargets,
  threshold: number,
  minSize = 1,
): SnapResult {
  let { x, y, w, h } = rect;
  const guides: SnapLine[] = [];
  /** A dragged edge: a named line first, then the gap to the neighbor on that side, then the grid. */
  const edgeSnap = (v: number, axis: "x" | "y", side: "before" | "after"): AxisSnap => {
    const named = snapAxis([v], axis === "x" ? targets.x : targets.y, threshold);
    if (named.line) return named;
    if (targets.others?.length && targets.u) {
      const n = neighbors(rect, targets.others, axis)[side];
      if (n) {
        const target = Math.max(targets.u, Math.round(n.gap / targets.u) * targets.u);
        const d = (target - n.gap) * (side === "before" ? 1 : -1);
        if (Math.abs(d) <= Math.max(threshold, targets.u / 2)) return { delta: d, line: { axis, value: v + d, kind: "gap" } };
      }
    }
    return snapAxis([v], [], threshold, targets.u, axis);
  };
  if (edges.left || edges.right) {
    const v = edges.left ? x : x + w;
    const s = edgeSnap(v, "x", edges.left ? "before" : "after");
    if (s.line) guides.push(s.line);
    if (edges.left) {
      const nx = Math.min(x + s.delta, x + w - minSize);
      w += x - nx;
      x = nx;
    } else {
      w = Math.max(minSize, w + s.delta);
    }
  }
  if (edges.top || edges.bottom) {
    const v = edges.top ? y : y + h;
    const s = edgeSnap(v, "y", edges.top ? "before" : "after");
    if (s.line) guides.push(s.line);
    if (edges.top) {
      const ny = Math.min(y + s.delta, y + h - minSize);
      h += y - ny;
      y = ny;
    } else {
      h = Math.max(minSize, h + s.delta);
    }
  }
  return { rect: { x, y, w, h }, guides };
}

/** Snap a plain value (e.g. an angle) to multiples of `step` within `threshold`. */
export function snapValue(v: number, step: number, threshold: number): number {
  const g = Math.round(v / step) * step;
  return Math.abs(g - v) <= threshold ? g : v;
}
