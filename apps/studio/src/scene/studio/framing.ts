/**
 * The auto-camera (lighting-and-backgrounds §2), applied to a Three.js camera. The math lives in
 * @xds/editor-core (`frameSubject`); this file only writes the result into the camera, shifting
 * the projection with `setViewOffset` (a shift lens) rather than moving the camera sideways.
 */
import type { PerspectiveCamera } from "three";
import type { FreeCamera, Vec3 } from "@xds/protocol";
import { frameSubject, yawPitchToDirection, type ResolvedCamera, type ResolvedFrame } from "@xds/editor-core";

export function applyFrameCamera(camera: PerspectiveCamera, points: Vec3[], cam: ResolvedFrame, width: number, height: number): void {
  const aspect = width / height;
  const f = frameSubject(points, cam, aspect);
  if (!f) {
    // Nothing to frame: a neutral camera looking at the origin from the requested direction.
    const d = yawPitchToDirection(cam.yaw, cam.pitch);
    camera.position.set(d[0] * 5, d[1] * 5 + 0.5, d[2] * 5);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0.5, 0);
    camera.fov = cam.fov;
    camera.near = 0.01;
    camera.far = 1000;
    camera.aspect = aspect;
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    return;
  }
  camera.position.set(...f.position);
  camera.up.set(0, 1, 0);
  camera.lookAt(...f.target);
  camera.fov = f.fov;
  camera.near = f.near;
  camera.far = f.far;
  camera.aspect = aspect;
  camera.setViewOffset(width, height, f.offset.x * width, f.offset.y * height, width, height);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

export function applyFreeCamera(camera: PerspectiveCamera, cam: FreeCamera, width: number, height: number, sceneRadius = 10): void {
  camera.position.set(...cam.position);
  camera.up.set(0, 1, 0);
  camera.lookAt(...cam.target);
  camera.fov = cam.fov;
  const dist = Math.hypot(cam.position[0] - cam.target[0], cam.position[1] - cam.target[1], cam.position[2] - cam.target[2]);
  camera.near = Math.max(1e-3, Math.min(0.1, dist / 100));
  camera.far = Math.max(100, (dist + sceneRadius) * 20);
  camera.aspect = width / height;
  camera.clearViewOffset();
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

export function cameraSignature(cam: ResolvedCamera): string {
  return JSON.stringify(cam);
}
