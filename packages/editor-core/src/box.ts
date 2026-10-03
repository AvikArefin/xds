/**
 * Box math: a 2D node's `box` is in percent of the format (origin top-left, y down) with a
 * rotation in degrees about its center. These helpers convert to and from pixels and compute
 * the axis-aligned bounds of a rotated box.
 */
import type { Box } from "@xds/protocol";

/** A pixel rectangle, origin top-left. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A box in pixels, keeping its rotation (degrees about the center) and opacity. */
export interface PxBox extends Rect {
  rotation: number;
  opacity: number;
}

export interface Size {
  width: number;
  height: number;
}

export function boxToPx(box: Box, size: Size): PxBox {
  return {
    x: (box.x / 100) * size.width,
    y: (box.y / 100) * size.height,
    w: (box.w / 100) * size.width,
    h: (box.h / 100) * size.height,
    rotation: box.rotation ?? 0,
    opacity: box.opacity ?? 1,
  };
}

/** Pixels → percent. `rotation`/`opacity` are carried over when present. */
export function pxToBox(rect: Rect & { rotation?: number; opacity?: number }, size: Size): Box {
  const box: Box = {
    x: (rect.x / size.width) * 100,
    y: (rect.y / size.height) * 100,
    w: (rect.w / size.width) * 100,
    h: (rect.h / size.height) * 100,
  };
  if (rect.rotation !== undefined && rect.rotation !== 0) box.rotation = rect.rotation;
  if (rect.opacity !== undefined && rect.opacity !== 1) box.opacity = rect.opacity;
  return box;
}

/** Round a percent value to a fixed number of decimals (default 3, i.e. ≈ 0.01 px at 1080). */
export function roundPercent(v: number, decimals = 3): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

export function roundBox(box: Box, decimals = 3): Box {
  const out: Box = {
    x: roundPercent(box.x, decimals),
    y: roundPercent(box.y, decimals),
    w: roundPercent(box.w, decimals),
    h: roundPercent(box.h, decimals),
  };
  if (box.rotation !== undefined) out.rotation = roundPercent(box.rotation, decimals);
  if (box.opacity !== undefined) out.opacity = box.opacity;
  return out;
}

/** The four corners of a rect rotated by `rotation` degrees about its center (clockwise on screen). */
export function rotatedCorners(rect: Rect, rotation: number): [number, number][] {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const a = (rotation * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const hw = rect.w / 2;
  const hh = rect.h / 2;
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([dx, dy]) => [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos] as [number, number]);
}

/** Axis-aligned bounds of a rect rotated about its center. */
export function rotatedAabb(rect: Rect, rotation: number): Rect {
  if (!rotation) return { ...rect };
  return boundsOfPoints(rotatedCorners(rect, rotation));
}

export function boundsOfPoints(points: [number, number][]): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function rectCenter(r: Rect): [number, number] {
  return [r.x + r.w / 2, r.y + r.h / 2];
}
