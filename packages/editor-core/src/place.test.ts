import { describe, expect, it } from "vitest";
import type { Vec3 } from "@xds/protocol";
import { boundsCorners, projectPoint, yawPitchToDirection, type LookCamera } from "./framing";
import { applyPlacement, placeObject, type PlaceCamera } from "./place";

const size = { width: 1440, height: 1080 };

/** A look-at camera as a PlaceCamera, with the placement plane through its target. */
function camera(yaw: number, pitch: number, distance: number): PlaceCamera {
  const target: Vec3 = [0, 0, 0];
  const d = yawPitchToDirection(yaw, pitch);
  const cam: LookCamera = { position: [d[0] * distance, d[1] * distance, d[2] * distance], target, fov: 30, aspect: size.width / size.height };
  const toPx = (p: Vec3): [number, number] => {
    const q = projectPoint(cam, p);
    return [((q.x + 1) / 2) * size.width, ((1 - q.y) / 2) * size.height];
  };
  // the plane through the target facing the camera, spanned by the view's right and up
  const f = [-d[0], -d[1], -d[2]];
  let r: Vec3 = [-f[2], 0, f[0]]; // cross(f, up) for up = +Y, as projectPoint
  const rl = Math.hypot(...r);
  r = [r[0] / rl, r[1] / rl, r[2] / rl];
  const u: Vec3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const t = Math.tan((15 * Math.PI) / 180);
  return {
    project: toPx,
    toPlane: (x, y) => {
      const nx = (x / size.width) * 2 - 1;
      const ny = 1 - (y / size.height) * 2;
      const a = nx * t * cam.aspect * distance;
      const b = ny * t * distance;
      return [r[0] * a + u[0] * b, r[1] * a + u[1] * b, r[2] * a + u[2] * b];
    },
  };
}

function bounds(points: Vec3[], cam: PlaceCamera) {
  const px = points.map((p) => cam.project(p));
  const xs = px.map((p) => p[0]);
  const ys = px.map((p) => p[1]);
  return { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2, h: Math.max(...ys) - Math.min(...ys) };
}

describe("placeObject", () => {
  const phone = boundsCorners({ min: [-0.036, 0, -0.004], max: [0.036, 0.15, 0.004] });
  const bell = boundsCorners({ min: [-0.03, 0, -0.012], max: [0.03, 0.16, 0.012] });

  for (const [label, cam] of [
    ["head-on", camera(0, 0, 1)],
    ["from the side and above", camera(-28, 12, 0.6)],
  ] as const) {
    it(`puts two objects where they are asked to go (${label})`, () => {
      for (const [pts, target] of [
        [phone, { x: 30, y: 62, height: 70 }],
        [bell, { x: 74, y: 36, height: 45 }],
      ] as const) {
        const pl = placeObject(pts as Vec3[], target, size, cam)!;
        const b = bounds((pts as Vec3[]).map((p) => applyPlacement(pl, p)), cam);
        expect(b.cx).toBeCloseTo((target.x / 100) * size.width, 0);
        expect(b.cy).toBeCloseTo((target.y / 100) * size.height, 0);
        expect(b.h).toBeCloseTo((target.height / 100) * size.height, 0);
      }
    });
  }

  it("returns null without points", () => {
    expect(placeObject([], { x: 50, y: 50, height: 40 }, size, camera(0, 0, 1))).toBeNull();
  });
});
