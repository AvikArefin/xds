/**
 * <SlideStage> draws one slide: the flat background fill, then the four layers stacked in
 * `project.layerOrder` (back → front), at the format's native pixel size. The editor wraps it
 * in a CSS-scaled container and adds handles/gizmos; the /render page draws it bare. Both use
 * this component, so they cannot disagree.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import type { GroundNode, ImageNode, Layer, Project, RenderNode, TypeNode } from "@xds/protocol";
import { DEFAULT_LAYER_ORDER } from "@xds/protocol";
import type { StackPlacement } from "@xds/editor-core";
import type { SubjectLayout } from "../design/resolve";
import type { SceneApi } from "../scene/SceneRoot";
import type { DesignInfo, Guide } from "../types";
import { GroundLayer } from "./GroundLayer";
import { ImageLayer } from "./ImageLayer";
import { Readiness, ReadinessProvider, useFailure } from "./readiness";
import { RenderLayer } from "./RenderLayer";
import { ProjectFonts, TypeLayer } from "./TypeLayer";
import { slideBaseColor } from "./typeStyle";

export interface StageStatus {
  /** Nothing pending and no error. */
  ready: boolean;
  /** Human labels of what is still loading/settling, e.g. "fonts: Satoshi 700", "model: bottle". */
  waiting: string[];
  /** A fatal problem (unknown slide/design/object, failed model load, bad design expression). */
  error: string | null;
  /** The 3D subject's on-screen layout (canvas px), null when the slide has no visible render node; undefined until known. */
  subject: SubjectLayout | null | undefined;
}

/** Imperative access for measure() and the render page. */
export interface StageHandle {
  root: HTMLDivElement | null;
  scene: SceneApi | null;
  readiness: Readiness;
  subject: SubjectLayout | null | undefined;
}

export interface SlideStageProps {
  project: Project;
  designs: Record<string, DesignInfo>;
  slideId: string;
  /** Source hash (screen texture URLs). */
  hash?: string;
  /** The format guide from /api/project (type band defaults); derived locally when absent. */
  guide?: Guide | null;
  /** Layers to show (default: all). Hidden layers stay mounted (CSS visibility), so nothing reloads. */
  visibleLayers?: Layer[];
  /** Layers to mount at all (default: all). `xds measure` mounts only "type": no 3D, no backgrounds. */
  mountLayers?: Layer[];
  /** The resolved stacked text blocks (`data.stack`), whenever they change. */
  onLayout?: (placements: Map<string, StackPlacement>) => void;
  /** The slide's flat background fill (default true). */
  showBackground?: boolean;
  /** The contact/soft shadow in the 3D layer (default true). */
  showShadows?: boolean;
  mode?: "render" | "editor";
  /**
   * Which layer receives pointer events in editor mode (default: "render" when `onObjectPointerDown`
   * is set, else none). That layer's container (full slide) gets `pointer-events: auto`; every
   * other layer is click-through. 2D node elements carry `data-node-id`.
   */
  interactiveLayer?: Layer | null;
  /** Keep the camera where it is (e.g. while the editor drags a gizmo). */
  freezeCamera?: boolean;
  /** Extra R3F content inside the Canvas (editor gizmos); can call useSceneRegistry(). */
  sceneChildren?: ReactNode;
  onObjectPointerDown?: (objectId: string, e: ThreeEvent<PointerEvent>, nodeId: string) => void;
  /** Editor handles per layer, drawn above that layer's content (wrapper has pointer-events: none). */
  layerOverlay?: Partial<Record<Layer, ReactNode>>;
  onStatus?: (s: StageStatus) => void;
  /** Filled with imperative access (render page / measure). */
  handleRef?: { current: StageHandle | null };
  className?: string;
}

const ALL_LAYERS: Layer[] = ["ground", "render", "image", "type"];

export function SlideStage(props: SlideStageProps) {
  const { project, designs, slideId, mode = "editor" } = props;
  const width = project.format.width;
  const height = project.format.height;
  const slide = project.slides.find((s) => s.id === slideId);
  const readiness = useMemo(() => new Readiness(), []);
  const rootRef = useRef<HTMLDivElement>(null);
  const sceneApiRef = useRef<SceneApi | null>(null);
  const [subject, setSubject] = useState<SubjectLayout | null | undefined>(undefined);

  const order = useMemo(() => {
    const o = (project.layerOrder?.length ? project.layerOrder : DEFAULT_LAYER_ORDER) as Layer[];
    return [...o, ...ALL_LAYERS.filter((l) => !o.includes(l))];
  }, [project.layerOrder]);
  const visible = new Set(props.visibleLayers ?? ALL_LAYERS);
  const mounted = new Set(props.mountLayers ?? ALL_LAYERS);

  const byLayer = useMemo(() => {
    const nodes = (slide?.nodes ?? []).filter((n) => !n.hidden);
    return {
      ground: nodes.filter((n): n is GroundNode => n.layer === "ground"),
      image: nodes.filter((n): n is ImageNode => n.layer === "image"),
      type: nodes.filter((n): n is TypeNode => n.layer === "type"),
      render: nodes.filter((n): n is RenderNode => n.layer === "render"),
    };
  }, [slide]);

  // No render nodes → the subject is known to be absent right away.
  useEffect(() => {
    if (byLayer.render.length === 0) setSubject(null);
  }, [byLayer.render.length]);

  const onSubject = useCallback((s: SubjectLayout | null) => setSubject(s), []);

  const bg = slide ? slideBaseColor(project, slide) : null;  // for the default text color only

  // status reporting
  const onStatus = props.onStatus;
  const subjectRef = useRef(subject);
  subjectRef.current = subject;
  useEffect(() => {
    const report = () => {
      const waiting = readiness.waiting();
      const error = readiness.error();
      onStatus?.({ ready: waiting.length === 0 && !error, waiting, error, subject: subjectRef.current });
    };
    report();
    return readiness.subscribe(report);
  }, [readiness, onStatus, subject]);

  useEffect(() => {
    if (props.handleRef) {
      props.handleRef.current = {
        root: rootRef.current,
        get scene() {
          return sceneApiRef.current;
        },
        readiness,
        subject,
      };
    }
  });

  const interactiveLayer =
    props.interactiveLayer !== undefined ? props.interactiveLayer : props.onObjectPointerDown ? "render" : null;

  return (
    <ReadinessProvider value={readiness}>
      <StageErrors slideMissing={!slide ? slideId : null} />
      <ProjectFonts project={project} />
      <div
        ref={rootRef}
        className={props.className}
        data-slide-id={slideId}
        style={{ position: "relative", width, height, overflow: "hidden", isolation: "isolate" }}
      >
        <div
          data-xds-background=""
          style={{
            position: "absolute",
            inset: 0,
            background: "transparent", // the ground layer paints the canvas; no page color
            visibility: props.showBackground === false ? "hidden" : "visible",
            opacity: props.showBackground === false ? 0 : 1,
          }}
        />
        {slide &&
          order.map((layer, i) => {
            const show = visible.has(layer);
            const interactive = mode === "editor" && interactiveLayer === layer;
            return (
              <div
                key={layer}
                data-layer-root={layer}
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: i + 1,
                  // opacity too: Chrome still paints SVG filter output (e.g. feTurbulence grain) under visibility:hidden
                  visibility: show ? "visible" : "hidden",
                  opacity: show ? 1 : 0,
                  pointerEvents: interactive ? "auto" : "none",
                }}
              >
                {!mounted.has(layer) ? null : layer === "ground" ? (
                  <GroundLayer nodes={byLayer.ground} project={project} designs={designs} subject={subject} width={width} height={height} />
                ) : layer === "image" ? (
                  <ImageLayer nodes={byLayer.image} project={project} hash={props.hash} width={width} height={height} />
                ) : layer === "type" ? (
                  <TypeLayer
                    nodes={byLayer.type}
                    images={byLayer.image}
                    project={project}
                    background={bg}
                    guide={props.guide}
                    width={width}
                    height={height}
                    onLayout={props.onLayout}
                  />
                ) : (
                  <RenderLayer
                    project={project}
                    slide={slide}
                    nodes={byLayer.render}
                    hash={props.hash}
                    width={width}
                    height={height}
                    mode={mode}
                    showShadows={props.showShadows !== false}
                    paused={mode === "render" && !show}
                    interactive={interactive}
                    freezeCamera={props.freezeCamera}
                    sceneChildren={props.sceneChildren}
                    onObjectPointerDown={props.onObjectPointerDown}
                    onSubject={onSubject}
                    sceneApiRef={sceneApiRef}
                  />
                )}
                {props.layerOverlay?.[layer] && (
                  <div data-layer-overlay={layer} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                    {props.layerOverlay[layer]}
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </ReadinessProvider>
  );
}

function StageErrors({ slideMissing }: { slideMissing: string | null }) {
  useFailure("stage:slide", slideMissing ? `no slide '${slideMissing}' in the project` : null);
  return null;
}
