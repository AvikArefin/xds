/**
 * Auto-camera math (lighting-and-backgrounds.md §2), without Three.js.
 *
 * `frame` mode: the caller gives the subject as a cloud of world points (e.g. the corners of
 * every visible mesh's bounding box) and says where the subject should appear: center at
 * (x, y)% of the canvas, height = `height`% of the canvas height, viewed from yaw/pitch with a
 * vertical fov. We
 *   1. look at the center of the points' bounding box from direction (yaw, pitch),
 *   2. start from the distance at which the bounding sphere fills `height`, then refine it so
 *      the projected points span exactly `height` (perspective makes size ∝ 1/distance),
 *   3. shift the projection (a view offset, like a shift lens) so the projected bounds' center
 *      lands on (x, y). The camera itself never moves sideways, so the perspective is the same
 *      wherever the subject sits.
 */
import type { FrameCamera, FreeCamera, Vec3 } from "@xds/protocol";
import { DEG2RAD, RAD2DEG } from "./pose";

export const FRAME_DEFAULTS = { x: 50, y: 55, height: 55, yaw: 25, pitch: 12, fov: 30 } as const;

export type ResolvedFrame = { mode: "frame"; x: number; y: number; height: number; yaw: number; pitch: number; fov: number };
export type ResolvedCamera = ResolvedFrame | FreeCamera;

export function resolveCamera(camera?: FrameCamera | FreeCamera | null): ResolvedCamera {
  if (camera && camera.mode === "free") return camera;
  const c = (camera ?? {}) as FrameCamera;
  return {
    mode: "frame",
    x: c.x ?? FRAME_DEFAULTS.x,
    y: c.y ?? FRAME_DEFAULTS.y,
    height: c.height ?? FRAME_DEFAULTS.height,
    yaw: c.yaw ?? FRAME_DEFAULTS.yaw,
    pitch: c.pitch ?? FRAME_DEFAULTS.pitch,
    fov: c.fov ?? FRAME_DEFAULTS.fov,
  };
}

const MAX_PITCH = 89;

/** Unit vector from the subject toward the camera. yaw 0/pitch 0 looks from +Z; +yaw is from the right (+X), +pitch from above. */
export function yawPitchToDirection(yaw: number, pitch: number): Vec3 {
  const p = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch)) * DEG2RAD;
  const y = yaw * DEG2RAD;
  return [Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)];
}

/** Inverse of `yawPitchToDirection` (degrees). */
export function directionToYawPitch(dir: Vec3): { yaw: number; pitch: number } {
  const [x, y, z] = normalize(dir);
  return { yaw: Math.atan2(x, z) * RAD2DEG, pitch: Math.asin(Math.max(-1, Math.min(1, y))) * RAD2DEG };
}

export interface Bounds3 {
  min: Vec3;
  max: Vec3;
}

export function boundsOf(points: Vec3[]): Bounds3 {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], p[i]);
      max[i] = Math.max(max[i], p[i]);
    }
  }
  return { min, max };
}

export function boundsCorners(b: Bounds3): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [b.min[0], b.max[0]])
    for (const y of [b.min[1], b.max[1]])
      for (const z of [b.min[2], b.max[2]]) out.push([x, y, z]);
  return out;
}

export function boundsCenter(b: Bounds3): Vec3 {
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
}

/** Radius of the sphere around the box (half its diagonal). */
export function boundsRadius(b: Bounds3): number {
  const dx = b.max[0] - b.min[0], dy = b.max[1] - b.min[1], dz = b.max[2] - b.min[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz) / 2;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function normalize(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

export interface LookCamera {
  position: Vec3;
  target: Vec3;
  fov: number; // vertical degrees
  aspect: number; // width / height
}

/**
 * Project a world point with a look-at perspective camera (up = +Y, no view offset).
 * Returns NDC x, y in [-1, 1] when visible, and the view depth (> 0 in front).
 */
export function projectPoint(cam: LookCamera, p: Vec3): { x: number; y: number; depth: number } {
  const f = normalize(sub(cam.target, cam.position));
  let r = cross(f, [0, 1, 0]);
  if (Math.hypot(...r) < 1e-9) r = [1, 0, 0];
  r = normalize(r);
  const u = cross(r, f);
  const v = sub(p, cam.position);
  const depth = dot(v, f);
  const t = Math.tan((cam.fov * DEG2RAD) / 2);
  const d = Math.max(depth, 1e-9);
  return { x: dot(v, r) / (d * t * cam.aspect), y: dot(v, u) / (d * t), depth };
}

/** NDC bounds of points (x0, x1, y0, y1). */
export function projectedNdcBounds(cam: LookCamera, points: Vec3[]) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of points) {
    const q = projectPoint(cam, p);
    x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x);
    y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
  }
  return { x0, x1, y0, y1 };
}

export interface FrameResult {
  position: Vec3;
  target: Vec3;
  fov: number;
  near: number;
  far: number;
  /** Projection shift as a fraction of the view: use `camera.setViewOffset(W, H, ox * W, oy * H, W, H)`. */
  offset: { x: number; y: number };
  distance: number;
  radius: number;
}

/**
 * Frame `points` per a resolved `frame` camera on a canvas of the given aspect (width/height).
 * Returns null for an empty point set.
 */
export function frameSubject(points: Vec3[], cam: ResolvedFrame, aspect: number): FrameResult | null {
  if (points.length === 0) return null;
  const b = boundsOf(points);
  const target = boundsCenter(b);
  const radius = Math.max(boundsRadius(b), 1e-4);
  const dir = yawPitchToDirection(cam.yaw, cam.pitch);
  const h = Math.max(0.01, cam.height / 100);
  const t = Math.tan((cam.fov * DEG2RAD) / 2);

  // Start: the bounding sphere's diameter spans `h` of the view height.
  let distance = Math.max(radius / (h * t), radius * 1.05);
  const minDistance = radius * 1.01;
  for (let i = 0; i < 12; i++) {
    const look: LookCamera = { position: add(target, scale(dir, distance)), target, fov: cam.fov, aspect };
    const nb = projectedNdcBounds(look, points);
    const projected = (nb.y1 - nb.y0) / 2; // fraction of view height
    if (!(projected > 0)) break;
    const next = Math.max(minDistance, distance * (projected / h));
    if (Math.abs(next - distance) < distance * 1e-5) {
      distance = next;
      break;
    }
    distance = next;
  }
  const position = add(target, scale(dir, distance));
  const nb = projectedNdcBounds({ position, target, fov: cam.fov, aspect }, points);
  const cx = (nb.x0 + nb.x1) / 2;
  const cy = (nb.y0 + nb.y1) / 2;
  const tx = cam.x / 50 - 1;
  const ty = 1 - cam.y / 50;
  return {
    position,
    target,
    fov: cam.fov,
    near: Math.max(1e-3, (distance - radius) * 0.1),
    far: (distance + radius) * 20,
    offset: { x: (cx - tx) / 2, y: (ty - cy) / 2 },
    distance,
    radius,
  };
}

/**
 * Where a world point lands on the canvas (px) for a look-at camera plus a view offset given as
 * fractions (as returned by `frameSubject`).
 */
export function projectToCanvas(
  cam: LookCamera,
  offset: { x: number; y: number },
  size: { width: number; height: number },
  p: Vec3,
): [number, number] {
  const q = projectPoint(cam, p);
  return [((q.x + 1) / 2 - offset.x) * size.width, ((1 - q.y) / 2 - offset.y) * size.height];
}
