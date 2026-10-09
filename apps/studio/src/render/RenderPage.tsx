/**
 * /render?slide=<id>: the headless render page that xds/browser.py drives (CONTRACTS.md).
 * Draws <SlideStage> bare at exactly format.width × format.height CSS px at the page origin, on
 * a transparent page, and exposes `window.xds` (ready, error, waiting, measure, showLayers).
 * `&layers=type` mounts only those layers (`xds measure`: text layout without 3D or backgrounds).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Layer, Project, SlideMeasure } from "@xds/protocol";
import { api } from "../api";
import { SlideStage, type StageHandle, type StageStatus } from "../stage/SlideStage";
import type { ProjectResponse } from "../types";
import { measure } from "./measure";

export interface XdsRenderApi {
  ready: boolean;
  error: string | null;
  waiting(): string[];
  measure(): Promise<SlideMeasure>;
  showLayers(layers: Layer[], opts: { background: boolean; shadows: boolean }): Promise<void>;
}

declare global {
  interface Window {
    xds: XdsRenderApi;
  }
}

const ALL: Layer[] = ["ground", "render", "image", "type"];

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
async function frames(n: number) {
  for (let i = 0; i < n; i++) await nextFrame();
}

export default function RenderPage() {
  const params = new URLSearchParams(window.location.search);
  const slideId = params.get("slide") ?? "";
  const [mountLayers] = useState<Layer[] | undefined>(() => {
    const only = params.get("layers");
    return only ? (only.split(",").filter((l) => (ALL as string[]).includes(l)) as Layer[]) : undefined;
  });
  const [data, setData] = useState<ProjectResponse | null>(null);
  const [view, setView] = useState<{ layers: Layer[]; background: boolean; shadows: boolean }>({
    layers: ALL,
    background: true,
    shadows: true,
  });
  const handleRef = useRef<StageHandle | null>(null);
  const statusRef = useRef<StageStatus | null>(null);
  const readyTimer = useRef(0);

  // window.xds exists from the first script run, so Python can always ask what's pending.
  if (!window.xds) {
    window.xds = {
      ready: false,
      error: null,
      waiting: () => ["project"],
      measure: () => Promise.reject(new Error("not ready")),
      showLayers: () => Promise.reject(new Error("not ready")),
    };
  }

  useLayoutEffect(() => {
    for (const el of [document.documentElement, document.body]) {
      el.style.margin = "0";
      el.style.padding = "0";
      el.style.background = "transparent";
      el.style.overflow = "hidden";
    }
    const root = document.getElementById("root");
    if (root) root.style.cssText = "position:absolute;left:0;top:0;margin:0;padding:0;";
  }, []);

  useEffect(() => {
    if (!slideId) {
      window.xds.error = "no slide given: open /render?slide=<id>";
      return;
    }
    api
      .project()
      .then((r) => {
        const p = r.project as Project | null;
        if (!p || typeof p !== "object" || !Array.isArray(p.slides) || !p.format) {
          window.xds.error = `the project is not readable: ${r.check.findings.map((f) => f.message).join("; ") || "invalid project.json"}`;
          return;
        }
        if (!p.slides.some((s) => s.id === slideId)) {
          window.xds.error = `no slide '${slideId}' in the project`;
          return;
        }
        setData(r);
      })
      .catch((e: Error) => {
        window.xds.error = `could not load the project: ${e.message}`;
      });
  }, [slideId]);

  const project = data?.project as Project | undefined;

  const onStatus = useCallback((s: StageStatus) => {
    statusRef.current = s;
    if (s.error) {
      window.xds.error = s.error;
      return;
    }
    if (window.xds.ready || !s.ready) return;
    // ready = nothing pending, then two more rendered frames (and still nothing pending)
    const token = ++readyTimer.current;
    frames(2).then(() => {
      if (token !== readyTimer.current) return;
      const now = statusRef.current;
      if (now?.ready && !now.error) window.xds.ready = true;
    });
  }, []);

  useEffect(() => {
    if (!project) return;
    window.xds.waiting = () => {
      const s = statusRef.current;
      return s ? s.waiting : ["slide stage"];
    };
    window.xds.measure = async () => {
      const h = handleRef.current;
      if (!h) throw new Error("the slide is not mounted");
      return measure(h, project, slideId);
    };
    window.xds.showLayers = async (layers, opts) => {
      flushSync(() => setView({ layers: [...layers], background: !!opts.background, shadows: !!opts.shadows }));
      await frames(3); // R3F draws the change on the next frame; two more to be safe
    };
  }, [project, slideId]);

  if (!project || !data) return null;
  return (
    <SlideStage
      project={project}
      designs={data.designs}
      slideId={slideId}
      hash={data.hash}
      guide={data.guide}
      mode="render"
      visibleLayers={view.layers}
      mountLayers={mountLayers}
      showBackground={view.background}
      showShadows={view.shadows}
      onStatus={onStatus}
      handleRef={handleRef}
    />
  );
}
