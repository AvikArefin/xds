/**
 * The editable canvas: the same <SlideStage> the export renders, scaled with a CSS transform,
 * plus the editor's overlays (guides, selection handles, audit regions) and the 3D viewport
 * gestures (orbit / pan / scroll / L+drag light).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import type { Finding } from "@xds/protocol";
import { SlideStage } from "../../stage";
import { effectiveCamera, effectiveLighting, getSlide, nodesOf, useStudio } from "../../store";
import { importModel } from "../commands";
import { AuditOverlay, GuidesOverlay, findingAt } from "./Overlays";
import { Overlay2D } from "./Overlay2D";
import { Scene3D, gizmoState } from "./Scene3D";

const PAD = 48;

/** Keys held right now (for L + drag). */
const held = new Set<string>();
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    held.add(e.key.toLowerCase());
  });
  window.addEventListener("keyup", (e) => held.delete(e.key.toLowerCase()));
  window.addEventListener("blur", () => held.clear());
}

type CamDrag = {
  kind: "orbit" | "pan" | "light";
  x: number;
  y: number;
  moved: boolean;
  start: { yaw: number; pitch: number; x: number; y: number; angle: number; elevation: number };
};

export function EditableStage() {
  const project = useStudio((s) => s.project)!;
  const designs = useStudio((s) => s.designs);
  const guide = useStudio((s) => s.guide);
  const hash = useStudio((s) => s.hash);
  const slideId = useStudio((s) => s.activeSlideId);
  const mode = useStudio((s) => s.mode);
  const hiddenLayers = useStudio((s) => s.hiddenLayers);
  const zoomSetting = useStudio((s) => s.zoom);
  const fitZoom = useStudio((s) => s.fitZoom);
  const showGuides = useStudio((s) => s.showGuides);
  const showAudit = useStudio((s) => s.showAudit);
  const report = useStudio((s) => s.report);
  const highlight = useStudio((s) => s.hoverFinding);
  const focusRect = useStudio((s) => s.focusRect);
  const readOnly = useStudio((s) => s.readOnly);
  const syncStackLayout = useStudio((s) => s.syncStackLayout);
  const [hoverFinding, setHoverFinding] = useState<Finding | null>(null);
  const [status, setStatus] = useState<{ waiting: string[]; error: string | null }>({ waiting: [], error: null });
  const [frozen, setFrozen] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const hitObject = useRef(false);
  const camDrag = useRef<CamDrag | null>(null);

  const onStatus = useCallback(
    (s: { waiting: string[]; error: string | null }) =>
      setStatus((prev) =>
        prev.error === s.error && prev.waiting.join("|") === s.waiting.join("|") ? prev : { waiting: s.waiting, error: s.error },
      ),
    [],
  );

  const { width: W, height: H } = project.format;
  const zoom = zoomSetting === "fit" ? fitZoom : zoomSetting;

  // fit zoom follows the viewport size
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => {
      const z = Math.min((el.clientWidth - PAD * 2) / W, (el.clientHeight - PAD * 2) / H);
      useStudio.getState().setFitZoom(Math.max(0.05, Math.floor(z * 1000) / 1000));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H]);

  // zoom to a finding / node
  useEffect(() => {
    if (!focusRect || focusRect.slideId !== slideId) return;
    const el = viewportRef.current;
    if (!el) return;
    const st = useStudio.getState();
    let z = st.zoom === "fit" ? st.fitZoom : st.zoom;
    const fits = focusRect.w * z <= el.clientWidth * 0.8 && focusRect.h * z <= el.clientHeight * 0.8;
    if (!fits) {
      z = Math.max(0.05, Math.min((el.clientWidth * 0.6) / Math.max(focusRect.w, 1), (el.clientHeight * 0.6) / Math.max(focusRect.h, 1)));
      st.setZoom(z);
    } else if (focusRect.w * z < 80 && focusRect.h * z < 80) {
      z = Math.min(4, Math.max(z, 120 / Math.max(focusRect.w, focusRect.h, 1)));
      st.setZoom(z);
    }
    requestAnimationFrame(() => {
      const frame = frameRef.current;
      if (!frame) return;
      const cx = frame.offsetLeft + (focusRect.x + focusRect.w / 2) * z;
      const cy = frame.offsetTop + (focusRect.y + focusRect.h / 2) * z;
      el.scrollTo({ left: cx - el.clientWidth / 2, top: cy - el.clientHeight / 2, behavior: "smooth" });
    });
  }, [focusRect, slideId]);

  // wheel: Cmd/Ctrl zooms; in 3D mode a plain wheel sets the camera height
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const st = useStudio.getState();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        st.zoomBy(Math.exp(-e.deltaY * 0.01));
        return;
      }
      if (st.mode !== "render" || st.readOnly) return;
      if (!frameRef.current?.contains(e.target as Node)) return;
      const slide = getSlide(st.project, st.activeSlideId);
      const cam = effectiveCamera(slide);
      if (cam.mode !== "frame") return;
      e.preventDefault();
      const h = Math.max(5, Math.min(150, cam.height * Math.exp(-e.deltaY * 0.0015)));
      // one undo step per burst of wheel events
      st.beginGesture();
      st.patchCamera({ height: Math.round(h * 10) / 10 });
      clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => useStudio.getState().endGesture(), 350);
    };
    let wheelTimer = 0;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onObjectPointerDown = useCallback((_objectId: string, e: ThreeEvent<PointerEvent>, nodeId: string) => {
    if (e.nativeEvent.button !== 0) return;
    hitObject.current = true;
    if (gizmoState.hovered || gizmoState.dragging) return;
    const st = useStudio.getState();
    if (st.mode !== "render") return;
    const additive = e.nativeEvent.shiftKey || e.nativeEvent.metaKey;
    st.select([nodeId], additive ? { toggle: true } : {});
  }, []);

  // --- 3D viewport gestures (bubbled from the canvas) ---------------------------------------
  const on3DPointerDown = (e: React.PointerEvent) => {
    if (mode !== "render") return;
    const hit = hitObject.current;
    hitObject.current = false;
    if (gizmoState.hovered || gizmoState.dragging) return;
    const lightKey = held.has("l");
    if (e.button === 0 && hit && !lightKey) return; // selection handled in onObjectPointerDown
    if (e.button !== 0 && e.button !== 2) return;
    const st = useStudio.getState();
    const slide = getSlide(st.project, st.activeSlideId);
    const cam = effectiveCamera(slide);
    const light = effectiveLighting(st.project!, slide);
    const kind: CamDrag["kind"] = lightKey ? "light" : e.button === 2 ? "pan" : "orbit";
    camDrag.current = {
      kind,
      x: e.clientX,
      y: e.clientY,
      moved: false,
      start: {
        yaw: cam.mode === "frame" ? cam.yaw : 0,
        pitch: cam.mode === "frame" ? cam.pitch : 0,
        x: cam.mode === "frame" ? cam.x : 50,
        y: cam.mode === "frame" ? cam.y : 50,
        angle: light.angle,
        elevation: light.elevation,
      },
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const on3DPointerMove = (e: React.PointerEvent) => {
    const d = camDrag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < 3) return;
      const st = useStudio.getState();
      if (st.readOnly) return;
      if (d.kind !== "light" && effectiveCamera(getSlide(st.project, st.activeSlideId)).mode !== "frame") {
        st.notify("info", "The camera is in Free mode; switch it to Frame in the inspector to orbit and pan.");
        camDrag.current = null;
        return;
      }
      d.moved = true;
      st.beginGesture();
    }
    const st = useStudio.getState();
    const r1 = (v: number) => Math.round(v * 10) / 10;
    if (d.kind === "orbit") {
      st.patchCamera({ yaw: r1(d.start.yaw - dx * 0.35), pitch: r1(Math.max(-60, Math.min(85, d.start.pitch + dy * 0.25))) });
    } else if (d.kind === "pan") {
      st.patchCamera({ x: r1(d.start.x + (dx / (W * zoom)) * 100), y: r1(d.start.y + (dy / (H * zoom)) * 100) });
    } else {
      let angle = (d.start.angle + dx * 0.5) % 360;
      if (angle < 0) angle += 360;
      st.patchLighting({ angle: Math.round(angle), elevation: Math.round(Math.max(0, Math.min(80, d.start.elevation - dy * 0.3))) });
    }
  };
  const on3DPointerUp = (e: React.PointerEvent) => {
    const d = camDrag.current;
    camDrag.current = null;
    if (!d) return;
    if (d.moved) useStudio.getState().endGesture();
    else if (e.button === 0 && d.kind === "orbit" && !e.shiftKey) useStudio.getState().clearSelection();
  };

  // --- audit regions for this slide ---------------------------------------------------------
  const findings = showAudit ? (report?.findings ?? []).filter((f) => f.slideId === slideId && f.status !== "waived" && f.region) : [];
  const onFrameMove = (e: React.PointerEvent) => {
    if (camDrag.current || !findings.length) return;
    const r = frameRef.current!.getBoundingClientRect();
    const f = findingAt(findings, (e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom);
    if (f !== hoverFinding) setHoverFinding(f);
  };

  const slide = getSlide(project, slideId);
  if (!slide) return <div className="viewport empty">No slide.</div>;
  const hasRender = nodesOf(slide).some((n) => n.layer === "render");

  return (
    <div
      ref={viewportRef}
      className={`viewport mode-${mode}`}
      onPointerDown={(e) => {
        // clicks on the gray area around the slide clear the selection
        if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("stage-scroll"))
          useStudio.getState().clearSelection();
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        const f = [...e.dataTransfer.files].find((x) => /\.(glb|gltf|dae)$/i.test(x.name));
        if (!f) return;
        e.preventDefault();
        if (readOnly) return;
        void importModel(f);
      }}
    >
      <div className="stage-scroll" style={{ width: W * zoom + PAD * 2, height: H * zoom + PAD * 2, padding: PAD }}>
        <div
          ref={frameRef}
          className="stage-frame"
          style={{ width: W * zoom, height: H * zoom }}
          onPointerDown={on3DPointerDown}
          onPointerMove={(e) => {
            on3DPointerMove(e);
            onFrameMove(e);
          }}
          onPointerUp={on3DPointerUp}
          onPointerCancel={on3DPointerUp}
          onPointerLeave={() => setHoverFinding(null)}
          onContextMenu={(e) => mode === "render" && e.preventDefault()}
        >
          <div className="stage-scale" style={{ width: W, height: H, transform: `scale(${zoom})` }}>
            <SlideStage
              project={project}
              designs={designs}
              slideId={slideId}
              hash={hash}
              guide={guide}
              mode="editor"
              interactiveLayer={mode === "render" && !hiddenLayers.includes("render") ? "render" : null}
              visibleLayers={(["ground", "render", "image", "type"] as const).filter((l) => !hiddenLayers.includes(l))}
              freezeCamera={frozen}
              onObjectPointerDown={onObjectPointerDown}
              sceneChildren={<Scene3D onDragChange={setFrozen} />}
              onStatus={onStatus}
              onLayout={syncStackLayout}
            />
          </div>
          {showGuides && guide && mode !== "present" && <GuidesOverlay guide={guide} W={W} H={H} zoom={zoom} />}
          {findings.length > 0 && (
            <AuditOverlay findings={findings} W={W} H={H} zoom={zoom} hover={hoverFinding} highlight={highlight} />
          )}
          {mode !== "present" && mode !== "render" && <Overlay2D layer={mode} W={W} H={H} zoom={zoom} />}
        </div>
      </div>
      {(status.error || status.waiting.length > 0) && (
        <div className={`stage-status${status.error ? " sev-error" : ""}`}>
          {status.error ? status.error : `Loading ${status.waiting.slice(0, 3).join(", ")}${status.waiting.length > 3 ? "…" : ""}`}
        </div>
      )}
      {mode === "render" && !hasRender && <div className="stage-hint">No 3D object on this slide. Add a model or a shape from the side panel.</div>}
    </div>
  );
}
