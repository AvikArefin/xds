import { describe, expect, it } from "vitest";
import type { Vec3 } from "@xds/protocol";
import {
  boundsCorners,
  directionToYawPitch,
  frameSubject,
  projectToCanvas,
  resolveCamera,
  yawPitchToDirection,
} from "./framing";

const size = { width: 1080, height: 1350 };
const aspect = size.width / size.height;

function canvasBounds(points: Vec3[], cam: ReturnType<typeof frameSubject>) {
  const pts = points.map((p) =>
    projectToCanvas({ position: cam!.position, target: cam!.target, fov: cam!.fov, aspect }, cam!.offset, size, p),
  );
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

describe("framing", () => {
  it("fills defaults", () => {
    expect(resolveCamera()).toEqual({ mode: "frame", x: 50, y: 55, height: 55, yaw: 25, pitch: 12, fov: 30 });
    expect(resolveCamera({ mode: "free", position: [0, 1, 5], target: [0, 0, 0], fov: 40 }).mode).toBe("free");
  });

  it("converts yaw/pitch to a direction and back", () => {
    expect(yawPitchToDirection(0, 0)).toEqual([0, 0, 1]);
    const d = yawPitchToDirection(90, 0);
    expect(d[0]).toBeCloseTo(1);
    const yp = directionToYawPitch(yawPitchToDirection(25, 12));
    expect(yp.yaw).toBeCloseTo(25);
    expect(yp.pitch).toBeCloseTo(12);
  });

  for (const [label, scale] of [["a 3 cm earring", 0.03], ["a 1.8 m lamp", 1.8]] as const) {
    it(`places ${label} at the requested height and center`, () => {
      const pts = boundsCorners({ min: [-0.2 * scale, 0, -0.2 * scale], max: [0.2 * scale, scale, 0.2 * scale] });
      const cam = resolveCamera({ x: 67, y: 40, height: 45, yaw: 25, pitch: 12 });
      if (cam.mode !== "frame") throw new Error();
      const f = frameSubject(pts, cam, aspect)!;
      const b = canvasBounds(pts, f);
      expect((b.y1 - b.y0) / size.height).toBeCloseTo(0.45, 3);
      expect((b.x0 + b.x1) / 2 / size.width).toBeCloseTo(0.67, 3);
      expect((b.y0 + b.y1) / 2 / size.height).toBeCloseTo(0.4, 3);
    });
  }

  it("returns null with no points", () => {
    expect(frameSubject([], resolveCamera() as never, 1)).toBeNull();
  });
});
