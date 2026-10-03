import { describe, expect, it } from "vitest";
import {
  eulerXYZFromQuat,
  poseFromTransform,
  poseMatrix,
  quatFromEulerXYZ,
  resolvePose,
  rotateVec,
  transformFromPose,
  transformPoint,
  wrapDegrees,
} from "./pose";

describe("pose", () => {
  it("resolves node pose over catalog pose field by field", () => {
    const p = resolvePose({ position: [1, 2, 3], rotation: [0, 90, 0], scale: [2, 2, 2] }, { position: [0, 0, 1] });
    expect(p).toEqual({ position: [0, 0, 1], rotation: [0, 90, 0], scale: [2, 2, 2] });
    expect(resolvePose()).toEqual({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
  });

  it("round-trips Euler XYZ through quaternions", () => {
    const e: [number, number, number] = [0.3, -0.7, 1.1];
    const back = eulerXYZFromQuat(quatFromEulerXYZ(e));
    back.forEach((v, i) => expect(v).toBeCloseTo(e[i]));
  });

  it("rotates +X to -Z with yaw 90°", () => {
    const v = rotateVec(quatFromEulerXYZ([0, Math.PI / 2, 0]), [1, 0, 0]);
    expect(v[0]).toBeCloseTo(0);
    expect(v[2]).toBeCloseTo(-1);
  });

  it("builds a TRS matrix", () => {
    const m = poseMatrix({ position: [1, 0, 0], rotation: [0, 0, 90], scale: [2, 2, 2] });
    const p = transformPoint(m, [1, 0, 0]);
    expect(p[0]).toBeCloseTo(1);
    expect(p[1]).toBeCloseTo(2);
  });

  it("converts degrees ↔ radians and rounds", () => {
    const t = transformFromPose({ position: [0, 0, 0], rotation: [180, 45, 0], scale: [1, 1, 1] });
    expect(t.rotationRad[0]).toBeCloseTo(Math.PI);
    const back = poseFromTransform({ position: [0.123456, -0, 0], rotationRad: t.rotationRad, scale: [1, 1, 1] });
    expect(back.rotation).toEqual([180, 45, 0]);
    expect(back.position).toEqual([0.1235, 0, 0]);
  });

  it("wraps angles", () => {
    expect(wrapDegrees(270)).toBe(-90);
    expect(wrapDegrees(-180)).toBe(180);
  });
});
