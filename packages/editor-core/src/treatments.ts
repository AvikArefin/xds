/**
 * Expressive type treatments (data-models §2.5d, design-rules §8): the pure numbers behind what
 * the type layer draws. Offsets are canvas px; `u` is the spacing unit. Angles are degrees
 * clockwise from +x with y down (screen space): 0 → right, 90 → down, 135 → down-left.
 */
import type { Extrude, Repeat, TypeData } from "@xds/protocol";
import type { Rect } from "./box";

export interface CloneOffset {
  dx: number;
  dy: number;
  /** 0..1 */
  opacity: number;
  /** Drawn as an outline instead of a fill. */
  outline: boolean;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** The number of stacked copies an extrusion draws when `steps` is not given: one per 2 px. */
export function extrudeStepCount(e: Extrude, u: number): number {
  return Math.max(1, e.steps ?? Math.ceil((e.depth * u) / 2));
}

/** Copies behind the text, nearest first (draw them in reverse so the farthest is at the back). */
export function extrudeOffsets(e: Extrude, u: number): CloneOffset[] {
  const n = extrudeStepCount(e, u);
  const a = (((e.angle ?? 135) % 360) * Math.PI) / 180;
  const depth = e.depth * u;
  const out: CloneOffset[] = [];
  for (let i = 1; i <= n; i++) {
    const d = (depth * i) / n;
    out.push({ dx: r2(Math.cos(a) * d), dy: r2(Math.sin(a) * d), opacity: 1, outline: false });
  }
  return out;
}

/** The `count − 1` copies behind the original, each `(dx, dy) · u` further along. */
export function repeatOffsets(r: Repeat, u: number): CloneOffset[] {
  const out: CloneOffset[] = [];
  const n = Math.max(2, r.count) - 1;
  for (let i = 1; i <= n; i++) {
    out.push({
      dx: r2((r.dx ?? 0) * u * i),
      dy: r2((r.dy ?? 0) * u * i),
      opacity: r.fade ? r2(1 - (0.8 * i) / n) : 1,
      outline: !!r.outline && i % 2 === 1,
    });
  }
  return out;
}

/** Any treatment that changes what the block paints beyond plain glyphs. */
export function hasTreatment(d: TypeData): boolean {
  return !!(d.skew || d.stroke || d.extrude || d.repeat || d.plate);
}

/** The text stroke width in px. */
export function strokePx(d: TypeData, u: number): number {
  return d.stroke ? r2(d.stroke.width * u) : 0;
}

export interface Extent {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * The ink extent of a treated block relative to its box: the glyph ink grown by the stroke,
 * every clone's offset, and the plate's padding and stroke.
 */
export function treatedExtent(d: TypeData, ink: Extent, u: number): Extent {
  let { top, bottom, left, right } = ink;
  const half = strokePx(d, u) / 2;
  top -= half;
  bottom += half;
  left -= half;
  right += half;
  const clones = [...(d.extrude ? extrudeOffsets(d.extrude, u) : []), ...(d.repeat ? repeatOffsets(d.repeat, u) : [])];
  let minDx = 0, maxDx = 0, minDy = 0, maxDy = 0;
  for (const c of clones) {
    minDx = Math.min(minDx, c.dx);
    maxDx = Math.max(maxDx, c.dx);
    minDy = Math.min(minDy, c.dy);
    maxDy = Math.max(maxDy, c.dy);
  }
  const out: Extent = { top: top + minDy, bottom: bottom + maxDy, left: left + minDx, right: right + maxDx };
  if (d.plate) {
    const p = plateRect(d, ink, u);
    out.top = Math.min(out.top, p.y);
    out.left = Math.min(out.left, p.x);
    out.bottom = Math.max(out.bottom, p.y + p.h);
    out.right = Math.max(out.right, p.x + p.w);
  }
  return { top: r2(out.top), bottom: r2(out.bottom), left: r2(out.left), right: r2(out.right) };
}

/** The plate behind the glyph ink, relative to the box: padding (and half the stroke) around the ink. */
export function plateRect(d: TypeData, ink: Extent, u: number): Rect {
  const p = d.plate;
  const pad = (p?.padding ?? 2) * u + (p?.stroke ? (p.stroke.width * u) / 2 : 0);
  return {
    x: r2(ink.left - pad),
    y: r2(ink.top - pad),
    w: r2(ink.right - ink.left + 2 * pad),
    h: r2(ink.bottom - ink.top + 2 * pad),
  };
}

/**
 * The font size at which the widest line fills `boxWidth`, given the widest line's natural width
 * measured at `atSize`. Rounded to half a px, never below 1.
 */
export function fitWidthSize(naturalWidth: number, atSize: number, boxWidth: number): number {
  if (!(naturalWidth > 0) || !(atSize > 0) || !(boxWidth > 0)) return atSize;
  return Math.max(1, Math.round(((atSize * boxWidth) / naturalWidth) * 2) / 2);
}

export type Point = [number, number];

/**
 * The corners of a rect given in box space (px from the box's top-left) on the canvas, after the
 * box's skew (CSS `skewX`, about the box center) and rotation (about the box center), both as the
 * type layer draws them.
 */
export function transformedCorners(local: Rect, box: Rect, rotationDeg = 0, skewDeg = 0): Point[] {
  const cx = box.w / 2;
  const cy = box.h / 2;
  const t = Math.tan((skewDeg * Math.PI) / 180);
  const a = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const pts: Point[] = [
    [local.x, local.y],
    [local.x + local.w, local.y],
    [local.x + local.w, local.y + local.h],
    [local.x, local.y + local.h],
  ];
  return pts.map(([x, y]) => {
    // skewX about the center: x' = x + (y − cy)·tan
    const sx = x + (y - cy) * t;
    const dx = sx - cx;
    const dy = y - cy;
    return [r2(box.x + cx + dx * cos - dy * sin), r2(box.y + cy + dx * sin + dy * cos)];
  });
}

/** Axis-aligned bounds of a polygon. */
export function polygonBounds(pts: Point[]): Rect {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x: r2(x), y: r2(y), w: r2(Math.max(...xs) - x), h: r2(Math.max(...ys) - y) };
}
