/**
 * Everything inside the RenderLayer's <Canvas>: tone mapping/exposure, the studio rig, the
 * slide's render nodes, auto-framing, the grounded shadow and the editor's extra content.
 *
 * Each frame (cheap: a bounding-box walk) it recomputes the subject bounds; when they or the
 * camera settings change it re-frames the camera, and it reports the subject's on-screen layout
 * so the ground can place its spotlight/horizon behind the product.
 */
import { useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  NeutralToneMapping,
  SRGBColorSpace,
  Vector3,
  type Group,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from "three";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import type { Project, RenderNode, Slide } from "@xds/protocol";
import { resolveCamera } from "@xds/editor-core";
import type { SubjectLayout } from "../design/resolve";
import { ReadinessContext } from "../stage/readiness";
import { tokenHex } from "../stage/typeStyle";
import { RenderObject } from "./objects";
import { SceneRegistry, SceneRegistryContext } from "./registry";
import { applyFrameCamera, applyFreeCamera, cameraSignature } from "./studio/framing";
import { resolveLighting } from "./studio/looks";
import { Shadows, type ShadowBounds } from "./studio/Shadows";
import { StudioRig } from "./studio/StudioRig";
import { boxOfPoints, sameLayout, subjectLayout, subjectPoints } from "./studio/subject";

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

export function SceneRoot(props: SceneRootProps) {
  const { project, slide, nodes, width, height } = props;
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const readiness = useContext(ReadinessContext);
  const registry = useMemo(() => new SceneRegistry(), []);
  const subjectRef = useRef<Group>(null);
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

    const points = subjectPoints(group);
    const box = boxOfPoints(points);
    registry.subjectBounds = box;
    const st = frameState.current;
    const radius = box ? box.getSize(new Vector3()).length() / 2 : 0;
    const eps = Math.max(radius * 1e-4, 1e-6);
    const boxSig = box
      ? [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].map((v) => round(v, eps).toFixed(6)).join(",")
      : "none";
    const camSig = `${cameraSignature(cam)}|${boxSig}|${width}x${height}`;
    if (camSig !== st.camSig && !props.freezeCamera) {
      if (cam.mode === "frame") applyFrameCamera(camera, points, cam, width, height);
      else applyFreeCamera(camera, cam, width, height, radius);
      st.camSig = camSig;
    }
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
          <RenderObject key={n.id} node={n} project={project} hash={props.hash} />
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
