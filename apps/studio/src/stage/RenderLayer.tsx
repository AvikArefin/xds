/**
 * The 3D layer: an R3F <Canvas> with a transparent background that covers the whole slide.
 * Light comes only from the studio environment (scene/studio), tone mapping is Khronos PBR
 * Neutral with exposure 2^brightness, output is sRGB.
 */
import { useCallback, useState, type ReactNode } from "react";
import { Canvas, events as createPointerEvents, type ThreeEvent } from "@react-three/fiber";
import type { EventManager, RootState } from "@react-three/fiber";
import { NeutralToneMapping, SRGBColorSpace } from "three";
import type { Project, RenderNode, Slide } from "@xds/protocol";
import type { SubjectLayout } from "../design/resolve";
import { SceneRoot, type SceneApi } from "../scene/SceneRoot";
import { usePending } from "./readiness";

/**
 * Pointer events that stay correct when a parent scales the stage with a CSS transform: the
 * pointer is mapped through the canvas' on-screen rectangle (getBoundingClientRect).
 */
function scaledEvents(store: Parameters<typeof createPointerEvents>[0]): EventManager<HTMLElement> {
  const base = createPointerEvents(store);
  return {
    ...base,
    compute(event: { clientX: number; clientY: number }, state: RootState) {
      const r = state.gl.domElement.getBoundingClientRect();
      const x = ((event.clientX - r.left) / Math.max(1, r.width)) * 2 - 1;
      const y = -((event.clientY - r.top) / Math.max(1, r.height)) * 2 + 1;
      state.pointer.set(x, y);
      state.raycaster.setFromCamera(state.pointer, state.camera);
    },
  } as EventManager<HTMLElement>;
}

export interface RenderLayerProps {
  project: Project;
  slide: Slide;
  /** Visible (non-hidden) render nodes of the slide. */
  nodes: RenderNode[];
  hash?: string;
  width: number;
  height: number;
  mode: "render" | "editor";
  showShadows: boolean;
  /** Stop drawing frames. Software WebGL queues every frame drawn while the canvas is hidden
   *  and replays them when it is shown again (~15 s per hide on the render page). */
  paused?: boolean;
  interactive: boolean;
  freezeCamera?: boolean;
  sceneChildren?: ReactNode;
  onObjectPointerDown?: (objectId: string, e: ThreeEvent<PointerEvent>, nodeId: string) => void;
  onSubject: (layout: SubjectLayout | null) => void;
  sceneApiRef: { current: SceneApi | null };
}

export function RenderLayer(props: RenderLayerProps) {
  const { width, height, mode } = props;
  const [framed, setFramed] = useState(false);
  const [envReady, setEnvReady] = useState(false);
  const [shadowsReady, setShadowsReady] = useState(false);
  usePending("3d:framing", "framing", !framed);
  usePending("3d:environment", "environment", !envReady);
  usePending("3d:shadows", "shadows", !shadowsReady);
  const onFramed = useCallback(() => setFramed(true), []);
  const onEnv = useCallback(() => setEnvReady(true), []);
  const onShadows = useCallback(() => setShadowsReady(true), []);

  return (
    <Canvas
      style={{ position: "absolute", left: 0, top: 0, width, height }}
      resize={{ offsetSize: true, scroll: false, debounce: 0 }}
      dpr={mode === "render" ? 1 : Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 1, 2)}
      gl={{ preserveDrawingBuffer: true, antialias: true, alpha: true }}
      shadows
      frameloop={props.paused ? "never" : "always"}
      camera={{ fov: 30, near: 0.01, far: 1000, position: [0, 1, 5] }}
      events={mode === "editor" ? scaledEvents : undefined}
      onCreated={({ gl }) => {
        gl.toneMapping = NeutralToneMapping;
        gl.outputColorSpace = SRGBColorSpace;
        gl.setClearColor(0x000000, 0);
      }}
    >
      <SceneRoot
        project={props.project}
        slide={props.slide}
        nodes={props.nodes}
        hash={props.hash}
        width={width}
        height={height}
        showShadows={props.showShadows}
        freezeCamera={props.freezeCamera}
        temporalShadows={mode === "editor"}
        interactive={props.interactive}
        sceneChildren={props.sceneChildren}
        onObjectPointerDown={props.onObjectPointerDown}
        onSubject={props.onSubject}
        onFramed={onFramed}
        onEnvironmentReady={onEnv}
        onShadowsReady={onShadows}
        apiRef={props.sceneApiRef}
      />
    </Canvas>
  );
}
