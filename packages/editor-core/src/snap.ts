/**
 * Snapping for 2D blocks (human-interaction.md §1.2): the margin, the `u` grid, other blocks'
 * edges and centers, the canvas center and the third lines.
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

export type SnapKind = "margin" | "canvas" | "center" | "third" | "edge" | "grid";

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
  return { x, y, u: ctx.u };
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

/** Snap a moved rect: its left/center/right and top/middle/bottom each try every line. */
export function snapMove(rect: PxRect, targets: SnapTargets, threshold: number): SnapResult {
  const sx = snapAxis([rect.x, rect.x + rect.w / 2, rect.x + rect.w], targets.x, threshold, targets.u, "x");
  const sy = snapAxis([rect.y, rect.y + rect.h / 2, rect.y + rect.h], targets.y, threshold, targets.u, "y");
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
  if (edges.left || edges.right) {
    const v = edges.left ? x : x + w;
    const s = snapAxis([v], targets.x, threshold, targets.u, "x");
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
    const s = snapAxis([v], targets.y, threshold, targets.u, "y");
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
