/**
 * Per-object placement (`data.place` on a render node, lighting-and-backgrounds §2.4): put one
 * object's projected bounds at (x, y)% of the canvas with a height of `height`% of the canvas
 * height, under a camera that is already set. The object is scaled about its own center and moved
 * on the plane through the camera target that faces the camera, so several placed objects share
 * one perspective, like products photographed side by side.
 *
 * The camera is abstract (`project`, `toPlane`), so this runs with Three.js in the studio and with
 * `LookCamera` in tests.
 */
import type { Vec3 } from "@xds/protocol";
import { boundsCenter, boundsOf } from "./framing";

export interface PlaceTarget {
  x: number;
  y: number;
  height: number;
}

export const PLACE_DEFAULTS: PlaceTarget = { x: 50, y: 55, height: 40 };

export function resolvePlace(p: Partial<PlaceTarget> | null | undefined): PlaceTarget {
  return { x: p?.x ?? PLACE_DEFAULTS.x, y: p?.y ?? PLACE_DEFAULTS.y, height: p?.height ?? PLACE_DEFAULTS.height };
}

export interface Placement {
  /** world = position + scale · (p − center) */
  position: Vec3;
  scale: number;
  center: Vec3;
}

export interface PlaceCamera {
  /** World point → canvas px. */
  project: (p: Vec3) => [number, number];
  /** Canvas px → the point on the placement plane under it. */
  toPlane: (x: number, y: number) => Vec3 | null;
}

export function applyPlacement(pl: Placement, p: Vec3): Vec3 {
  return [
    pl.position[0] + pl.scale * (p[0] - pl.center[0]),
    pl.position[1] + pl.scale * (p[1] - pl.center[1]),
    pl.position[2] + pl.scale * (p[2] - pl.center[2]),
  ];
}

function screenBounds(points: Vec3[], pl: Placement, cam: PlaceCamera) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) {
    const [x, y] = cam.project(applyPlacement(pl, p));
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, h: y1 - y0 };
}

/**
 * Solve the scale and position that put `points` (the object's world points at scale 1, unplaced)
 * at `target` on a canvas of `size`. A few fixed-point steps: perspective makes the projected size
 * and center depend slightly on where the object sits.
 */
export function placeObject(
  points: Vec3[],
  target: PlaceTarget,
  size: { width: number; height: number },
  cam: PlaceCamera,
): Placement | null {
  if (!points.length) return null;
  const center = boundsCenter(boundsOf(points));
  const tx = (target.x / 100) * size.width;
  const ty = (target.y / 100) * size.height;
  const th = (Math.max(0.01, target.height) / 100) * size.height;
  let aim: [number, number] = [tx, ty];
  const start = cam.toPlane(tx, ty);
  if (!start) return null;
  const pl: Placement = { position: start, scale: 1, center };
  for (let i = 0; i < 8; i++) {
    const b = screenBounds(points, pl, cam);
    if (!(b.h > 1e-9) || !Number.isFinite(b.cx)) return null;
    pl.scale *= th / b.h;
    const after = screenBounds(points, pl, cam);
    aim = [aim[0] + (tx - after.cx), aim[1] + (ty - after.cy)];
    const p = cam.toPlane(aim[0], aim[1]);
    if (!p) return null;
    pl.position = p;
    const done = screenBounds(points, pl, cam);
    if (Math.abs(done.h - th) < 0.25 && Math.abs(done.cx - tx) < 0.25 && Math.abs(done.cy - ty) < 0.25) break;
  }
  return pl;
}
