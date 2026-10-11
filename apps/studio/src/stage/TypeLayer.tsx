/**
 * The type layer: plain DOM text with @font-face rules for the project's font files. Font
 * loading is awaited (`document.fonts.load`) and reported as pending ("fonts: Satoshi 700").
 *
 * Layout relations (stacks, aligns, pins, fit) are resolved by the stage (`SlideStage`): this
 * layer lays the text out at its placed rect, measures each block's ink relative to its box
 * (and its content height) once the fonts are in, and reports it with `onInk`. While the slide
 * has relations and the ink for the current layout has not been reported, "layout: relations"
 * is pending, so a render never captures a block in an unresolved place.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Project, TypeNode } from "@xds/protocol";
import { boxToPx, type LayoutPlacement } from "@xds/editor-core";
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

/** What the stage needs from a laid-out text block to resolve relations. */
export interface TextInk {
  /** Ink extent relative to the box, px. */
  top: number;
  bottom: number;
  left: number;
  right: number;
  /** The laid-out text's height, px. */
  contentHeight: number;
}

export interface TypeLayerProps {
  project: Project;
  nodes: TypeNode[];
  background: string | null;
  guide?: Guide | null;
  width: number;
  height: number;
  overlay?: ReactNode;
  /** The stage's resolved placements (every 2D node with a decided field). */
  placements?: Map<string, LayoutPlacement>;
  /** True when the slide has layout relations: the ink is measured and reported, and pending until it is. */
  needsInk?: boolean;
  /** Called with every text block's ink for the current layout, keyed by the layout key. */
  onInk?: (ink: Map<string, TextInk>, key: string) => void;
}

/** The spacing unit stacks are measured in: the guide's, else the format's default (s / 135). */
export function stackUnit(project: Project, guide?: Guide | null): number {
  return guide?.u ?? Math.max(4, Math.round(Math.min(project.format.width, project.format.height) / 135));
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

/** The key of a text layout: what changes the ink of a block relative to its box (width, text, style). */
export function textLayoutKey(nodes: TypeNode[], styles: EffectiveTypeStyle[], widths: number[]): string {
  return JSON.stringify(nodes.map((n, i) => [n.id, widths[i], n.data.text, n.data.align, n.data.valign, styles[i]]));
}

export function TypeLayer({ project, nodes, background, guide, width, height, placements, needsInk, onInk }: TypeLayerProps) {
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

  // --- placed rects and ink ---------------------------------------------------------------
  const rects = useMemo(
    () =>
      nodes.map((n) => {
        const b = boxToPx(n.box, { width, height });
        const p = placements?.get(n.id);
        return p ? { ...b, ...p.rect } : b;
      }),
    [nodes, placements, width, height],
  );
  const els = useRef(new Map<string, HTMLDivElement>());
  const measure = !!needsInk;
  const layoutKey = useMemo(
    () => (measure ? textLayoutKey(nodes, styled.map((s) => s.style), rects.map((r) => r.w)) : ""),
    [measure, nodes, styled, rects],
  );
  const [fontTick, setFontTick] = useState(0);
  const [reported, setReported] = useState<string | null>(null);
  const key = `${layoutKey}|${fontTick}`;
  usePending("layout:relations", "layout: relations", measure && reported !== key);

  useEffect(() => {
    if (!measure) return;
    const bump = () => setFontTick((t) => t + 1);
    document.fonts.addEventListener("loadingdone", bump);
    return () => document.fonts.removeEventListener("loadingdone", bump);
  }, [measure]);

  const onInkRef = useRef(onInk);
  onInkRef.current = onInk;
  useLayoutEffect(() => {
    if (!measure) return;
    // Reading the layout starts any font loads; measure again once they're done.
    if (document.fonts.status === "loading") {
      let alive = true;
      document.fonts.ready.then(() => alive && setFontTick((t) => t + 1));
      return () => {
        alive = false;
      };
    }
    const ink = new Map<string, TextInk>();
    for (const { node } of styled) {
      const el = els.current.get(node.id);
      if (!el) continue;
      const scale = el.getBoundingClientRect().width / Math.max(1e-6, el.offsetWidth) || 1;
      const ext = inkExtent(el, scale);
      const textEl = (el.querySelector("[data-xds-text]") as HTMLElement) ?? el;
      const b = rects[nodes.indexOf(node)];
      ink.set(node.id, {
        top: ext?.top ?? 0,
        bottom: ext?.bottom ?? b.h,
        left: ext?.left ?? 0,
        right: ext?.right ?? b.w,
        contentHeight: textEl.offsetHeight,
      });
    }
    onInkRef.current?.(ink, key);
    setReported(key);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {fonts.map((f) => (
        <FontLoad key={`${f.family}|${f.weight}|${f.italic}`} req={f} />
      ))}
      {styled.map(({ node, style }, i) => {
        const b = rects[i];
        const v = node.data.valign ?? "top";
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
              top: b.y,
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
