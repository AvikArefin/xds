/**
 * Pose math without Three.js. A `Pose` is position (m), rotation (Euler degrees, XYZ order, as
 * in three.js) and scale. These helpers resolve a node pose over the catalog pose and convert
 * Euler angles ↔ quaternions ↔ matrices with plain number arrays.
 */
import type { Pose, Vec3 } from "@xds/protocol";

export type Quat = [number, number, number, number]; // x, y, z, w

export interface ResolvedPose {
  position: Vec3;
  rotation: Vec3; // degrees
  scale: Vec3;
}

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export const degToRad = (d: number) => d * DEG2RAD;
export const radToDeg = (r: number) => r * RAD2DEG;

export const IDENTITY_POSE: ResolvedPose = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

/** Node pose overrides the catalog pose field by field; missing fields use the identity. */
export function resolvePose(catalog?: Pose | null, override?: Pose | null): ResolvedPose {
  return {
    position: [...(override?.position ?? catalog?.position ?? IDENTITY_POSE.position)] as Vec3,
    rotation: [...(override?.rotation ?? catalog?.rotation ?? IDENTITY_POSE.rotation)] as Vec3,
    scale: [...(override?.scale ?? catalog?.scale ?? IDENTITY_POSE.scale)] as Vec3,
  };
}

export function eulerDegToRad(e: Vec3): Vec3 {
  return [e[0] * DEG2RAD, e[1] * DEG2RAD, e[2] * DEG2RAD];
}

export function eulerRadToDeg(e: Vec3): Vec3 {
  return [e[0] * RAD2DEG, e[1] * RAD2DEG, e[2] * RAD2DEG];
}

/** Euler XYZ (radians) → quaternion; same convention as THREE.Quaternion.setFromEuler. */
export function quatFromEulerXYZ([x, y, z]: Vec3): Quat {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

/** Rotation matrix (row-major 3×3) of a quaternion. */
export function mat3FromQuat([x, y, z, w]: Quat): number[] {
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    1 - (yy + zz), xy - wz, xz + wy,
    xy + wz, 1 - (xx + zz), yz - wx,
    xz - wy, yz + wx, 1 - (xx + yy),
  ];
}

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

/** Quaternion → Euler XYZ (radians); same convention as THREE.Euler.setFromQuaternion(q, "XYZ"). */
export function eulerXYZFromQuat(q: Quat): Vec3 {
  const m = mat3FromQuat(q);
  const [m11, m12, m13, , m22, m23, , m32, m33] = [m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]];
  const y = Math.asin(clamp1(m13));
  let x: number, z: number;
  if (Math.abs(m13) < 0.9999999) {
    x = Math.atan2(-m23, m33);
    z = Math.atan2(-m12, m11);
  } else {
    x = Math.atan2(m32, m22);
    z = 0;
  }
  return [x, y, z];
}

export function quatMultiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    ax * bw + aw * bx + ay * bz - az * by,
    ay * bw + aw * by + az * bx - ax * bz,
    az * bw + aw * bz + ax * by - ay * bx,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Rotate a vector by a quaternion. */
export function rotateVec(q: Quat, v: Vec3): Vec3 {
  const m = mat3FromQuat(q);
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** Column-major 4×4 (THREE.Matrix4.elements layout) of a resolved pose. */
export function poseMatrix(pose: ResolvedPose): number[] {
  const q = quatFromEulerXYZ(eulerDegToRad(pose.rotation));
  const r = mat3FromQuat(q);
  const [sx, sy, sz] = pose.scale;
  const [px, py, pz] = pose.position;
  return [
    r[0] * sx, r[3] * sx, r[6] * sx, 0,
    r[1] * sy, r[4] * sy, r[7] * sy, 0,
    r[2] * sz, r[5] * sz, r[8] * sz, 0,
    px, py, pz, 1,
  ];
}

/** Apply a column-major 4×4 to a point. */
export function transformPoint(m: number[], [x, y, z]: Vec3): Vec3 {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

function round(v: number, decimals: number): number {
  const f = 10 ** decimals;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

/**
 * The pose an Object3D's transform represents, in file units: position (m), rotation in
 * Euler XYZ degrees, scale. Values are rounded (position/scale to 4 decimals, angles to 2)
 * so a gesture writes readable numbers.
 */
export function poseFromTransform(t: { position: Vec3; rotationRad: Vec3; scale: Vec3 }): Required<Pose> {
  return {
    position: t.position.map((v) => round(v, 4)) as Vec3,
    rotation: eulerRadToDeg(t.rotationRad).map((v) => round(v, 2)) as Vec3,
    scale: t.scale.map((v) => round(v, 4)) as Vec3,
  };
}

/** The pose as numbers an Object3D takes: position, rotation in radians (XYZ), scale. */
export function transformFromPose(pose: ResolvedPose): { position: Vec3; rotationRad: Vec3; scale: Vec3 } {
  return {
    position: [...pose.position] as Vec3,
    rotationRad: eulerDegToRad(pose.rotation),
    scale: pose.scale.map((s) => (s === 0 ? 1e-6 : s)) as Vec3,
  };
}

/** Normalize an angle in degrees to (-180, 180]. */
export function wrapDegrees(d: number): number {
  let r = ((d + 180) % 360 + 360) % 360 - 180;
  if (r === -180) r = 180;
  return r;
}
