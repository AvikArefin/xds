/**
 * Everything inside the RenderLayer's <Canvas>: tone mapping/exposure, the studio rig, the
 * slide's render nodes, auto-framing, the grounded shadow and the editor's extra content.
 *
 * Each frame (cheap: a bounding-box walk) it recomputes the subject bounds; when they or the
 * camera settings change it re-frames the camera, and it reports the subject's on-screen layout
 * so the ground can place its spotlight/horizon behind the product.
 *
 * Render nodes with `data.place` are left out of the framing. Once the camera is set, each is
 * scaled and moved (by a wrapper group around it) so its projected bounds land where `place`
 * says. When every node is placed, a frame camera looks at the origin from yaw/pitch, at the
 * distance that shows the largest placed object about at its own size.
 */
import { useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Matrix4,
  NeutralToneMapping,
  Plane,
  Raycaster,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type Group,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from "three";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import type { Project, RenderNode, Slide } from "@xds/protocol";
import {
  boundsCenter,
  boundsCorners,
  boundsOf,
  placeObject,
  resolveCamera,
  resolvePlace,
  type PlaceCamera,
  type PlaceTarget,
} from "@xds/editor-core";
import type { Vec3 } from "@xds/protocol";
import type { SubjectLayout } from "../design/resolve";
import { ReadinessContext } from "../stage/readiness";
import { tokenHex } from "../stage/typeStyle";
import { RenderObject } from "./objects";
import { SceneRegistry, SceneRegistryContext } from "./registry";
import { applyFrameCamera, applyFreeCamera, cameraSignature } from "./studio/framing";
import { resolveLighting } from "./studio/looks";
import { Shadows, type ShadowBounds } from "./studio/Shadows";
import { StudioRig } from "./studio/StudioRig";
import { boxOfPoints, projectToPx, sameLayout, subjectLayout, subjectPoints } from "./studio/subject";

/** What measure() and the stage need from the live scene. */
export interface SceneApi {
  registry: SceneRegistry;
  subject: Group;
  shadows: Group;
  extra: Group;
  gl: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  width: number;
  height: number;
}

export interface SceneRootProps {
  project: Project;
  slide: Slide;
  nodes: RenderNode[];
  hash?: string;
  width: number;
  height: number;
  showShadows: boolean;
  freezeCamera?: boolean;
  temporalShadows?: boolean;
  interactive: boolean;
  sceneChildren?: ReactNode;
  onObjectPointerDown?: (objectId: string, e: ThreeEvent<PointerEvent>, nodeId: string) => void;
  onSubject: (layout: SubjectLayout | null) => void;
  onFramed: () => void;
  onEnvironmentReady: () => void;
  onShadowsReady: () => void;
  apiRef: { current: SceneApi | null };
}

function rootOf(o: Object3D | null): Object3D | null {
  for (let p = o; p; p = p.parent) if (p.userData && p.userData.nodeId) return p;
  return null;
}

const round = (v: number, r: number) => Math.round(v / r) * r;

function boxSignature(points: Vec3[]): { sig: string; radius: number } {
  const box = boxOfPoints(points);
  if (!box) return { sig: "none", radius: 0 };
  const radius = box.getSize(new Vector3()).length() / 2;
  const eps = Math.max(radius * 1e-4, 1e-6);
  return {
    sig: [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].map((v) => round(v, eps).toFixed(6)).join(","),
    radius,
  };
}

const _inv = new Matrix4();
const _v3 = new Vector3();

/** World points of `root`, in the frame of `wrapper` (i.e. before the wrapper's placement). */
function pointsInside(root: Object3D, wrapper: Object3D): Vec3[] {
  wrapper.updateWorldMatrix(true, false);
  _inv.copy(wrapper.matrixWorld).invert();
  return subjectPoints(root).map((p) => {
    _v3.set(p[0], p[1], p[2]).applyMatrix4(_inv);
    return [_v3.x, _v3.y, _v3.z] as Vec3;
  });
}

export function SceneRoot(props: SceneRootProps) {
  const { project, slide, nodes, width, height } = props;
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const readiness = useContext(ReadinessContext);
  const registry = useMemo(() => new SceneRegistry(), []);
  const subjectRef = useRef<Group>(null);
  const wrappers = useRef(new Map<string, Group>());
  const shadowRef = useRef<Group>(null);
  const extraRef = useRef<Group>(null);

  const lighting = useMemo(
    () => resolveLighting(project.lighting, slide.lighting),
    [project.lighting, slide.lighting],
  );
  const tintHex = tokenHex(project, lighting.tint);

  useLayoutEffect(() => {
    gl.toneMapping = NeutralToneMapping;
    gl.toneMappingExposure = Math.pow(2, lighting.brightness);
    gl.outputColorSpace = SRGBColorSpace;
    gl.setClearColor(0x000000, 0);
  }, [gl, lighting.brightness]);

  useLayoutEffect(() => {
    props.apiRef.current = {
      registry,
      subject: subjectRef.current!,
      shadows: shadowRef.current!,
      extra: extraRef.current!,
      gl,
      scene,
      camera,
      width,
      height,
    };
  });

  const cam = useMemo(() => resolveCamera(slide.camera), [slide.camera]);
  const [shadowBounds, setShadowBounds] = useState<(ShadowBounds & { sig: string }) | null>(null);
  const frameState = useRef({ camSig: "", layout: undefined as SubjectLayout | null | undefined, framed: false });

  useFrame(() => {
    const group = subjectRef.current;
    if (!group) return;
    const expected = nodes.filter(
      (n) => project.objects?.some((o) => o.id === n.data.object) && !readiness?.hasError(`object:${n.id}`),
    );
    if (!expected.every((n) => registry.has(n.id))) return;

    // Placed nodes are framed one by one after the camera; the rest frame together.
    const placed: { id: string; place: PlaceTarget; wrapper: Group; local: Vec3[] }[] = [];
    const framed: Vec3[] = [];
    for (const n of nodes) {
      const root = registry.getNode(n.id);
      const wrapper = wrappers.current.get(n.id);
      if (!root || !wrapper) continue;
      if (n.data.place) placed.push({ id: n.id, place: resolvePlace(n.data.place), wrapper, local: pointsInside(root, wrapper) });
      else {
        if (wrapper.scale.x !== 1 || wrapper.position.lengthSq() > 0) {
          wrapper.position.set(0, 0, 0);
          wrapper.scale.set(1, 1, 1);
          wrapper.updateMatrixWorld(true);
        }
        framed.push(...subjectPoints(root));
      }
    }
    const st = frameState.current;
    const framedBox = boxSignature(framed);
    const camSig = [
      cameraSignature(cam),
      framedBox.sig,
      ...placed.map((p) => `${p.id}:${JSON.stringify(p.place)}:${boxSignature(p.local).sig}`),
      `${width}x${height}`,
    ].join("|");
    if (camSig !== st.camSig && !props.freezeCamera) {
      let planePoint = new Vector3(0, 0, 0);
      if (cam.mode === "frame") {
        if (framed.length || !placed.length) {
          applyFrameCamera(camera, framed, cam, width, height);
          if (framed.length) planePoint = new Vector3(...boundsCenter(boundsOf(framed)));
        } else {
          // all placed: look at the origin from far enough to show the largest one about at its size
          const big = placed.reduce((a, b) => (boxSignature(b.local).radius > boxSignature(a.local).radius ? b : a));
          const b = boundsOf(big.local);
          const h = Math.max(1e-4, b.max[1] - b.min[1], b.max[0] - b.min[0], b.max[2] - b.min[2]);
          const cube = boundsCorners({ min: [-h / 2, -h / 2, -h / 2], max: [h / 2, h / 2, h / 2] });
          applyFrameCamera(camera, cube, { ...cam, x: 50, y: 50, height: big.place.height }, width, height);
        }
      } else {
        applyFreeCamera(camera, cam, width, height, framedBox.radius || 10);
        planePoint = new Vector3(...cam.target);
      }
      camera.updateMatrixWorld(true);
      if (placed.length) {
        const normal = camera.getWorldDirection(new Vector3());
        const plane = new Plane().setFromNormalAndCoplanarPoint(normal, planePoint);
        const ray = new Raycaster();
        const placeCam: PlaceCamera = {
          project: (p) => projectToPx(new Vector3(p[0], p[1], p[2]), camera, width, height),
          toPlane: (x, y) => {
            ray.setFromCamera(new Vector2((x / width) * 2 - 1, 1 - (y / height) * 2), camera);
            const hit = ray.ray.intersectPlane(plane, new Vector3());
            return hit ? [hit.x, hit.y, hit.z] : null;
          },
        };
        for (const p of placed) {
          const pl = placeObject(p.local, p.place, { width, height }, placeCam);
          if (!pl) continue;
          p.wrapper.scale.setScalar(pl.scale);
          p.wrapper.position.set(
            pl.position[0] - pl.scale * pl.center[0],
            pl.position[1] - pl.scale * pl.center[1],
            pl.position[2] - pl.scale * pl.center[2],
          );
          p.wrapper.updateMatrixWorld(true);
        }
      }
      st.camSig = camSig;
    }

    const points = subjectPoints(group);
    const box = boxOfPoints(points);
    registry.subjectBounds = box;
    const radius = box ? box.getSize(new Vector3()).length() / 2 : 0;
    const boxSig = boxSignature(points).sig;
    camera.updateMatrixWorld(true);
    const layout = box ? subjectLayout(points, box, camera, width, height) : null;
    if (st.layout === undefined || !sameLayout(layout, st.layout)) {
      st.layout = layout;
      props.onSubject(layout);
    }
    if (box) {
      const c = box.getCenter(new Vector3());
      if (!shadowBounds || shadowBounds.sig !== boxSig) {
        setShadowBounds({ center: [c.x, c.y, c.z], minY: box.min.y, radius, sig: boxSig });
      }
    } else {
      if (shadowBounds) setShadowBounds(null);
      props.onShadowsReady(); // nothing visible casts a shadow
    }
    if (!st.framed) {
      st.framed = true;
      props.onFramed();
    }
  });

  // No subject at all: shadows are trivially ready.
  const hasSubject = nodes.length > 0;
  useLayoutEffect(() => {
    if (!hasSubject) props.onShadowsReady();
  }, [hasSubject]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPointerDown = props.interactive && props.onObjectPointerDown
    ? (e: ThreeEvent<PointerEvent>) => {
        const root = rootOf(e.object);
        if (!root) return;
        e.stopPropagation();
        props.onObjectPointerDown!(root.userData.objectId, e, root.userData.nodeId);
      }
    : undefined;

  return (
    <SceneRegistryContext.Provider value={registry}>
      <StudioRig lighting={lighting} tintHex={tintHex} onReady={props.onEnvironmentReady} />
      <group ref={subjectRef} name="xds:subject" onPointerDown={onPointerDown}>
        {nodes.map((n) => (
          <group
            key={n.id}
            name={`xds:place:${n.id}`}
            ref={(g) => {
              if (g) wrappers.current.set(n.id, g);
              else wrappers.current.delete(n.id);
            }}
          >
            <RenderObject node={n} project={project} hash={props.hash} />
          </group>
        ))}
      </group>
      <group ref={shadowRef} name="xds:shadows" visible={props.showShadows}>
        {shadowBounds && (
          <Shadows
            kind={lighting.shadow}
            angle={lighting.angle}
            elevation={lighting.elevation}
            bounds={shadowBounds}
            sig={`${shadowBounds.sig}|${lighting.angle}|${lighting.elevation}|${lighting.shadow}`}
            temporal={props.temporalShadows}
            onReady={props.onShadowsReady}
          />
        )}
      </group>
      <group ref={extraRef} name="xds:extra">
        {props.sceneChildren}
      </group>
    </SceneRegistryContext.Provider>
  );
}
