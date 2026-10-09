/**
 * The type layer: plain DOM text with @font-face rules for the project's font files. Font
 * loading is awaited (`document.fonts.load`) and reported as pending ("fonts: Satoshi 700").
 *
 * Stacked blocks (`data.stack`) are placed after layout: each block's ink is measured relative to
 * its box, `resolveStacks` turns the stack gaps into tops, and the blocks are moved there before
 * the frame is painted. Until fonts have loaded and the tops are known, "layout: stacked text" is
 * pending, so a render never captures a block in its unstacked place.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { ImageNode, Project, TypeNode } from "@xds/protocol";
import { boxToPx, resolveStacks, type StackItem, type StackPlacement } from "@xds/editor-core";
import { fileUrl } from "../api";
import type { Guide } from "../types";
import { inkExtent } from "./ink";
import { usePending } from "./readiness";
import { cssFontFamily, effectiveTypeStyle, type EffectiveTypeStyle } from "./typeStyle";

export function fontFaceCss(project: Project): string {
  return (project.fonts ?? [])
    .map((f) => {
      const ext = f.path.split(".").pop()?.toLowerCase();
      const format = ext === "woff2" ? "woff2" : ext === "woff" ? "woff" : ext === "otf" ? "opentype" : "truetype";
      return (
        `@font-face{font-family:"${f.family.replace(/"/g, "")}";` +
        `src:url("${fileUrl(f.path)}") format("${format}");` +
        `font-weight:${f.weight ?? 400};font-style:${f.italic ? "italic" : "normal"};font-display:block;}`
      );
    })
    .join("\n");
}

/** The @font-face rules for the project; mount once per page. */
export function ProjectFonts({ project }: { project: Project }) {
  const css = useMemo(() => fontFaceCss(project), [project.fonts]); // eslint-disable-line react-hooks/exhaustive-deps
  return <style data-xds-fonts="">{css}</style>;
}

interface FontReq {
  family: string;
  weight: number;
  italic: boolean;
  sample: string;
}

function FontLoad({ req }: { req: FontReq }) {
  const label = `fonts: ${req.family} ${req.weight}${req.italic ? " italic" : ""}`;
  const [done, setDone] = useState(false);
  usePending(`font:${label}`, label, !done);
  useEffect(() => {
    let alive = true;
    setDone(false);
    const spec = `${req.italic ? "italic " : ""}${req.weight} 32px "${req.family}"`;
    document.fonts
      .load(spec, req.sample || "A")
      .catch(() => [])
      .then((faces) => {
        if (!faces.length) console.warn(`xds: no font file matches ${spec}; the browser falls back`);
        return document.fonts.ready;
      })
      .then(() => alive && setDone(true));
    return () => {
      alive = false;
    };
  }, [req.family, req.weight, req.italic, req.sample]);
  return null;
}

export interface TypeLayerProps {
  project: Project;
  nodes: TypeNode[];
  /** The slide's visible image nodes: stack anchors (their box). */
  images?: ImageNode[];
  background: string | null;
  guide?: Guide | null;
  width: number;
  height: number;
  overlay?: ReactNode;
  /** Called with the resolved stacked blocks whenever they change (the editor's handles follow them). */
  onLayout?: (placements: Map<string, StackPlacement>) => void;
}

/** The spacing unit stacks are measured in: the guide's, else the format's default (s / 135). */
export function stackUnit(project: Project, guide?: Guide | null): number {
  return guide?.u ?? Math.max(4, Math.round(Math.min(project.format.width, project.format.height) / 135));
}

function samePlacements(a: Map<string, StackPlacement>, b: Map<string, StackPlacement>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, p] of a) {
    const q = b.get(id);
    if (!q || Math.abs(q.top - p.top) > 0.01 || Math.abs(q.base - p.base) > 0.01 || q.dir !== p.dir) return false;
  }
  return true;
}

export function typeTextStyle(s: EffectiveTypeStyle, align: string | undefined): CSSProperties {
  return {
    fontFamily: cssFontFamily(s.family),
    fontSize: `${s.size}px`,
    fontWeight: s.weight,
    fontStyle: s.italic ? "italic" : "normal",
    lineHeight: `${s.lineHeight * s.size}px`,
    letterSpacing: `${s.letterSpacing}em`,
    textTransform: s.uppercase ? "uppercase" : "none",
    color: s.color,
    textAlign: (align ?? "left") as CSSProperties["textAlign"],
    whiteSpace: "pre-line",
    overflowWrap: "break-word",
    ...(s.wrap !== "normal" ? ({ textWrap: s.wrap } as CSSProperties) : {}),
    margin: 0,
    fontKerning: "normal",
    fontSynthesis: "none",
  };
}

export function TypeLayer({ project, nodes, images, background, guide, width, height, onLayout }: TypeLayerProps) {
  const styled = useMemo(
    () => nodes.map((n) => ({ node: n, style: effectiveTypeStyle(n.data, project, background, guide) })),
    [nodes, project, background, guide],
  );
  const fonts = useMemo(() => {
    const m = new Map<string, FontReq>();
    for (const { node, style } of styled) {
      if (!style.family) continue;
      const k = `${style.family}|${style.weight}|${style.italic}`;
      const prev = m.get(k);
      const text = node.data.text.replace(/\s+/g, "");
      if (prev) prev.sample = (prev.sample + text).slice(0, 64);
      else m.set(k, { family: style.family, weight: style.weight, italic: style.italic, sample: text.slice(0, 64) });
    }
    return [...m.values()];
  }, [styled]);

  // --- stacked blocks ---------------------------------------------------------------------
  const els = useRef(new Map<string, HTMLDivElement>());
  const u = stackUnit(project, guide);
  const stacked = nodes.some((n) => n.data.stack);
  const layoutKey = useMemo(
    () =>
      stacked
        ? JSON.stringify([
            styled.map(({ node, style }) => [node.id, node.box, node.data.text, node.data.stack, node.data.valign, style]),
            (images ?? []).map((n) => [n.id, n.box]),
            width,
            height,
            u,
          ])
        : "",
    [stacked, styled, images, width, height, u],
  );
  const [placements, setPlacements] = useState<Map<string, StackPlacement>>(() => new Map());
  const [fontTick, setFontTick] = useState(0);
  const [laidOut, setLaidOut] = useState<string | null>(null);
  const key = `${layoutKey}|${fontTick}`;
  usePending("layout:stack", "layout: stacked text", stacked && laidOut !== key);

  useEffect(() => {
    if (!stacked) return;
    const bump = () => setFontTick((t) => t + 1);
    document.fonts.addEventListener("loadingdone", bump);
    return () => document.fonts.removeEventListener("loadingdone", bump);
  }, [stacked]);

  const onLayoutRef = useRef(onLayout);
  onLayoutRef.current = onLayout;
  useLayoutEffect(() => {
    if (!stacked) {
      if (placements.size) {
        setPlacements(new Map());
        onLayoutRef.current?.(new Map());
      }
      return;
    }
    const items: StackItem[] = [];
    for (const { node } of styled) {
      const el = els.current.get(node.id);
      if (!el) continue;
      const scale = el.getBoundingClientRect().width / Math.max(1e-6, el.offsetWidth) || 1;
      const ink = inkExtent(el, scale);
      const b = boxToPx(node.box, { width, height });
      items.push({ id: node.id, top: b.y, inkTop: ink?.top ?? 0, inkBottom: ink?.bottom ?? b.h, stack: node.data.stack });
    }
    for (const n of images ?? []) {
      const b = boxToPx(n.box, { width, height });
      items.push({ id: n.id, top: b.y, inkTop: 0, inkBottom: b.h });
    }
    // Reading the layout starts any font loads; measure again once they're done.
    if (document.fonts.status === "loading") {
      let alive = true;
      document.fonts.ready.then(() => alive && setFontTick((t) => t + 1));
      return () => {
        alive = false;
      };
    }
    const next = resolveStacks(items, u);
    setPlacements((prev) => (samePlacements(prev, next) ? prev : next));
    onLayoutRef.current?.(next);
    setLaidOut(key);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {fonts.map((f) => (
        <FontLoad key={`${f.family}|${f.weight}|${f.italic}`} req={f} />
      ))}
      {styled.map(({ node, style }) => {
        const b = boxToPx(node.box, { width, height });
        const v = node.data.valign ?? "top";
        const placed = placements.get(node.id);
        return (
          <div
            key={node.id}
            ref={(el) => {
              if (el) els.current.set(node.id, el);
              else els.current.delete(node.id);
            }}
            data-node-id={node.id}
            data-layer="type"
            style={{
              position: "absolute",
              left: b.x,
              top: placed ? placed.top : b.y,
              width: b.w,
              height: b.h,
              transform: b.rotation ? `rotate(${b.rotation}deg)` : undefined,
              opacity: b.opacity,
              display: "flex",
              flexDirection: "column",
              justifyContent: v === "middle" ? "center" : v === "bottom" ? "flex-end" : "flex-start",
            }}
          >
            <div data-xds-text="" style={typeTextStyle(style, node.data.align)}>
              {node.data.text}
            </div>
          </div>
        );
      })}
    </>
  );
}
