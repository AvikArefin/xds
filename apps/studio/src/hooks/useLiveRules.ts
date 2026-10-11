/**
 * Rules live in the editor (design-rules §2.1): after every layout of the active slide, measure
 * the text lines the stage laid out, run editor-core's text-geometry rules on the resolved boxes
 * and keep the findings in the store (`liveFindings`, view state). Throttled to a frame, skipped
 * while a gesture (a drag, a scrub) is in progress and run once when it ends, so dragging stays
 * smooth and the readouts settle with the drop.
 *
 * Nodes on a layer hidden on the canvas have no DOM and are left out; the audit sees them.
 */
import { useEffect, type RefObject } from "react";
import { stackOf, type Node } from "@xds/protocol";
import { fallbackGuide, liveFindings, type LiveGuide, type LiveNode } from "@xds/editor-core";
import { measureLines } from "../stage/ink";
import { boxBoundsPx, getSlide, nodesOf, typeStyle, useStudio } from "../store";

function liveGuide(): LiveGuide {
  const s = useStudio.getState();
  const g = s.guide;
  const p = s.project!;
  if (!g) {
    const f = fallbackGuide(p.format.width, p.format.height);
    return { width: f.width, height: f.height, u: f.u, margins: f.margins };
  }
  const bands: LiveGuide["bands"] = {};
  for (const [level, b] of Object.entries(g.bands ?? {})) bands[level] = { min: b.min, max: b.max, maxLines: b.max_lines, chars: b.chars };
  return {
    width: g.width,
    height: g.height,
    u: g.u,
    margins: g.margins,
    safeZones: g.safe_zones,
    spacingScale: g.spacing_scale,
    bands,
    k: g.k,
    blocks: g.budget?.blocks,
  };
}

function stackSpec(n: Node): LiveNode["stack"] {
  const st = stackOf(n);
  if (!st || n.layer === "render") return null;
  const axis = st.rightOf || st.leftOf ? "x" : "y";
  const dir: 1 | -1 = st.below || st.rightOf ? 1 : -1;
  const path = n.layout?.stack ? "layout.stack.gap" : "data.stack.gap";
  return { axis, path, dir, gap: st.gap ?? 2 };
}

/** Build the slide's nodes for the rules, measuring text lines from the stage's DOM. */
function collect(frame: HTMLElement, zoom: number): { nodes: LiveNode[]; slideId: string } | null {
  const s = useStudio.getState();
  const slide = getSlide(s.project, s.activeSlideId);
  if (!s.project || !slide) return null;
  const { width: W, height: H } = s.project.format;
  const origin = frame.getBoundingClientRect();
  const nodes: LiveNode[] = [];
  for (const n of nodesOf(slide)) {
    if (n.hidden || s.hiddenLayers.includes(n.layer)) continue;
    const waived = n.exceptions?.map((e) => e.rule);
    if (n.layer === "render") {
      nodes.push({ id: n.id, name: n.name, layer: "render", rect: { x: 0, y: 0, w: 0, h: 0 }, waived });
      continue;
    }
    const rect = boxBoundsPx(n.box, W, H);
    const base: LiveNode = { id: n.id, name: n.name, layer: n.layer, rect, waived, stack: stackSpec(n) };
    if (n.layer !== "type") {
      nodes.push(base);
      continue;
    }
    const el = frame.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(n.id)}"][data-layer="type"]`);
    if (!el) continue;
    const textEl = el.querySelector<HTMLElement>("[data-xds-text]") ?? el;
    const lines = measureLines(textEl, origin, zoom);
    const style = typeStyle(s.project, n, s.guide);
    const texts = lines.map((l) => l.text);
    const srcLast = n.data.text.includes("\n") ? n.data.text.split("\n").pop()?.trim() : undefined;
    nodes.push({
      ...base,
      lines: lines.map((l) => l.rect),
      lineTexts: texts,
      overflow: textEl.offsetHeight > el.clientHeight + 0.5 || textEl.scrollWidth > el.clientWidth + 0.5,
      contentHeight: textEl.offsetHeight,
      size: style.size,
      level: style.level,
      group: n.data.group ?? n.layout?.group ?? null,
      decorative: n.data.decorative ?? false,
      align: n.data.align ?? "left",
      forcedLastLine: !!srcLast && texts.length > 0 && texts[texts.length - 1].trim() === srcLast,
    });
  }
  return { nodes, slideId: slide.id };
}

export function useLiveRules(frameRef: RefObject<HTMLElement | null>, zoom: number) {
  useEffect(() => {
    let raf = 0;
    let disposed = false;
    const run = () => {
      raf = 0;
      if (disposed) return;
      const st = useStudio.getState();
      const frame = frameRef.current;
      if (!frame || !st.project || st.readOnly) {
        if (st.liveFindings.length) st.setLiveFindings([]);
        return;
      }
      if (!useStudio.temporal.getState().isTracking) return; // mid-gesture: the end re-runs
      const got = collect(frame, zoom);
      if (!got) return st.setLiveFindings([]);
      const slide = getSlide(st.project, got.slideId);
      st.setLiveFindings(
        liveFindings(got.nodes, liveGuide(), {
          slideId: got.slideId,
          off: st.project.rules?.off,
          set: st.project.rules?.set,
          slideWaived: slide?.exceptions?.map((e) => e.rule),
        }),
      );
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(run);
    };
    schedule();
    const unsub = useStudio.subscribe((s, prev) => {
      if (
        s.project !== prev.project ||
        s.layout !== prev.layout ||
        s.activeSlideId !== prev.activeSlideId ||
        s.hiddenLayers !== prev.hiddenLayers ||
        s.guide !== prev.guide ||
        s.readOnly !== prev.readOnly
      )
        schedule();
    });
    const unsubHistory = useStudio.temporal.subscribe((h, prev) => {
      if (h.isTracking && !prev.isTracking) schedule();
    });
    const onFonts = () => schedule();
    document.fonts.addEventListener("loadingdone", onFonts);
    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      unsub();
      unsubHistory();
      document.fonts.removeEventListener("loadingdone", onFonts);
    };
  }, [frameRef, zoom]);
}
