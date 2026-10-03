/**
 * Align and distribute for multi-selected 2D blocks (human-interaction.md §3.1).
 * Works on px rects; the result keeps the input order.
 */
import type { PxRect } from "./snap";

export type AlignHow = "left" | "center" | "right" | "top" | "middle" | "bottom";

export function rectsBounds(rects: PxRect[]): PxRect {
  if (!rects.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Align every rect to the selection's bounds (or to `ref`, e.g. the canvas or the margin box). */
export function alignRects(rects: PxRect[], how: AlignHow, ref?: PxRect): PxRect[] {
  const b = ref ?? rectsBounds(rects);
  return rects.map((r) => {
    switch (how) {
      case "left":
        return { ...r, x: b.x };
      case "center":
        return { ...r, x: b.x + (b.w - r.w) / 2 };
      case "right":
        return { ...r, x: b.x + b.w - r.w };
      case "top":
        return { ...r, y: b.y };
      case "middle":
        return { ...r, y: b.y + (b.h - r.h) / 2 };
      case "bottom":
        return { ...r, y: b.y + b.h - r.h };
    }
  });
}

export interface DistributeOptions {
  /**
   * When set, gaps snap to a multiple of this unit (at least one unit): the first block stays,
   * the others follow it with that gap. Without it the outer blocks stay and the gaps are equal.
   */
  unit?: number;
}

/** Distribute rects along an axis so the gaps between neighbors are equal. */
export function distributeRects(rects: PxRect[], axis: "x" | "y", opts: DistributeOptions = {}): PxRect[] {
  if (rects.length < 3 && !(opts.unit && rects.length >= 2)) return rects.map((r) => ({ ...r }));
  const pos = (r: PxRect) => (axis === "x" ? r.x : r.y);
  const size = (r: PxRect) => (axis === "x" ? r.w : r.h);
  const order = rects.map((r, i) => i).sort((a, b) => pos(rects[a]) - pos(rects[b]) || a - b);
  const sorted = order.map((i) => rects[i]);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = pos(last) + size(last) - pos(first);
  const total = sorted.reduce((s, r) => s + size(r), 0);
  let gap = (span - total) / (sorted.length - 1);
  if (opts.unit && opts.unit > 0) gap = Math.max(opts.unit, Math.round(gap / opts.unit) * opts.unit);

  const out: PxRect[] = rects.map((r) => ({ ...r }));
  let cursor = pos(first);
  order.forEach((idx) => {
    const r = out[idx];
    if (axis === "x") r.x = cursor;
    else r.y = cursor;
    cursor += size(r) + gap;
  });
  return out;
}
