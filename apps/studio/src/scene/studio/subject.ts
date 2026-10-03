/**
 * Subject bounds (lighting-and-backgrounds §1.5): everything size-dependent (shadow plane, soft
 * shadow light, auto-camera) is computed from the visible render nodes, so a 3 cm earring and a
 * 1.8 m lamp get the same look.
 */
import { Box3, Matrix4, Mesh, Vector3, type Camera, type Object3D } from "three";
import type { Vec3 } from "@xds/protocol";
import type { SubjectLayout } from "../../design/resolve";

const _v = new Vector3();
const _box = new Box3();
const _m = new Matrix4();

function isVisible(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/** Visible meshes under `root` (respecting hidden parents). */
export function visibleMeshes(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverseVisible((o) => {
    if ((o as Mesh).isMesh && (o as Mesh).geometry) out.push(o as Mesh);
  });
  return out.filter((m) => isVisible(m));
}

/** The 8 world-space corners of each visible mesh's local bounding box: a tight point cloud for framing. */
export function subjectPoints(root: Object3D): Vec3[] {
  root.updateWorldMatrix(true, true);
  const pts: Vec3[] = [];
  for (const mesh of visibleMeshes(root)) {
    const g = mesh.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox!;
    if (bb.isEmpty()) continue;
    _m.copy(mesh.matrixWorld);
    for (const x of [bb.min.x, bb.max.x])
      for (const y of [bb.min.y, bb.max.y])
        for (const z of [bb.min.z, bb.max.z]) {
          _v.set(x, y, z).applyMatrix4(_m);
          pts.push([_v.x, _v.y, _v.z]);
        }
  }
  return pts;
}

export function boxOfPoints(points: Vec3[]): Box3 | null {
  if (!points.length) return null;
  _box.makeEmpty();
  for (const p of points) _box.expandByPoint(_v.set(p[0], p[1], p[2]));
  return _box.clone();
}

/** Project a world point to canvas px (the camera's projection includes any view offset). */
export function projectToPx(p: Vector3, camera: Camera, width: number, height: number): [number, number] {
  const q = p.clone().project(camera);
  return [((q.x + 1) / 2) * width, ((1 - q.y) / 2) * height];
}

/** The subject's on-screen layout (bounds of its projected points, center, floor line). */
export function subjectLayout(points: Vec3[], box: Box3, camera: Camera, width: number, height: number): SubjectLayout {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) {
    const [x, y] = projectToPx(_v.set(p[0], p[1], p[2]), camera, width, height);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const center = box.getCenter(new Vector3());
  const [, floor] = projectToPx(new Vector3(center.x, box.min.y, center.z), camera, width, height);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, floor };
}

export function sameLayout(a: SubjectLayout | null | undefined, b: SubjectLayout | null | undefined, eps = 0.25): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (["x", "y", "w", "h", "cx", "cy", "floor"] as const).every((k) => Math.abs(a[k] - b[k]) <= eps);
}
