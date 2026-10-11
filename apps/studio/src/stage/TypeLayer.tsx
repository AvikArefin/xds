/**
 * The type layer: plain DOM text with @font-face rules for the project's font files. Font
 * loading is awaited (`document.fonts.load`) and reported as pending ("fonts: Satoshi 700").
 *
 * Layout relations (stacks, aligns, pins, fit) are resolved by the stage (`SlideStage`): this
 * layer lays the text out at its placed rect, measures each block's ink relative to its box
 * (and its content height) once the fonts are in, and reports it with `onInk`. While the slide
 * has relations and the ink for the current layout has not been reported, "layout: text" is
 * pending, so a render never captures a block in an unresolved place.
 *
 * Expressive treatments (data-models §2.5d) are drawn here, in the DOM, so the audit's layer
 * alpha sees real ink: `skew` is a skewX on an inner box, `stroke`/`fill` a text stroke,
 * `extrude` and `repeat` are absolutely positioned clones behind the text (`editor-core`
 * `extrudeOffsets`/`repeatOffsets`), `plate` a rounded rect behind the measured ink, and
 * `fitWidth` sets the size that makes the widest line fill the box (`fitWidthSize`), measured
 * from canvas text metrics once the fonts are in. Ink is measured in the box's own space
 * (rotation and skew off) and grown by the treatments (`treatedExtent`), so a stack gap under a
 * plated or extruded block is measured from the plate or the extrusion.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Project, TypeNode } from "@xds/protocol";
import {
  boxToPx,
  extrudeOffsets,
  fitWidthSize,
  hasTreatment,
  plateRect,
  repeatOffsets,
  strokePx,
  treatedExtent,
  type CloneOffset,
  type LayoutPlacement,
  type Rect,
} from "@xds/editor-core";
import { fileUrl } from "../api";
import type { Guide } from "../types";
import { inkExtent, widestLinePx, withoutTransforms } from "./ink";
import { usePending } from "./readiness";
import { cssFontFamily, effectiveTypeStyle, tokenHex, type EffectiveTypeStyle } from "./typeStyle";

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
  /** Ink extent relative to the box, px, grown by the block's treatments (plate, extrusion, repeats). */
  top: number;
  bottom: number;
  left: number;
  right: number;
  /** The laid-out text's height, px. */
  contentHeight: number;
  /** The size `fitWidth` chose, px (absent when the block does not fit its width). */
  fittedSize?: number;
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
  return JSON.stringify(
    nodes.map((n, i) => [
      n.id,
      widths[i],
      n.data.text,
      n.data.align,
      n.data.valign,
      styles[i],
      n.data.skew,
      n.data.stroke,
      n.data.fill,
      n.data.extrude,
      n.data.repeat,
      n.data.plate,
      n.data.fitWidth,
    ]),
  );
}

/** `#rrggbb` at an alpha. */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

/** The stroke CSS for a text element (outline text, or a stroke around the fill). */
function strokeStyle(node: TypeNode, style: EffectiveTypeStyle, project: Project, u: number, outlineOnly: boolean): CSSProperties {
  const d = node.data;
  const px = strokePx(d, u);
  const color = tokenHex(project, d.stroke?.color) ?? style.color;
  if (!px && !outlineOnly) return {};
  const width = px || Math.max(1, u / 8);
  return {
    WebkitTextStroke: `${width}px ${color}`,
    paintOrder: "stroke fill",
    ...(d.fill === "none" || outlineOnly ? { WebkitTextFillColor: "transparent" } : {}),
  } as CSSProperties;
}

export function TypeLayer({ project, nodes, background, guide, width, height, placements, needsInk, onInk }: TypeLayerProps) {
  const u = stackUnit(project, guide);
  const base = useMemo(
    () => nodes.map((n) => ({ node: n, style: effectiveTypeStyle(n.data, project, background, guide) })),
    [nodes, project, background, guide],
  );
  const fonts = useMemo(() => {
    const m = new Map<string, FontReq>();
    for (const { node, style } of base) {
      if (!style.family) continue;
      const k = `${style.family}|${style.weight}|${style.italic}`;
      const prev = m.get(k);
      const text = node.data.text.replace(/\s+/g, "");
      if (prev) prev.sample = (prev.sample + text).slice(0, 64);
      else m.set(k, { family: style.family, weight: style.weight, italic: style.italic, sample: text.slice(0, 64) });
    }
    return [...m.values()];
  }, [base]);

  // --- placed rects, fitted sizes and ink -------------------------------------------------
  const rects = useMemo(
    () =>
      nodes.map((n) => {
        const b = boxToPx(n.box, { width, height });
        const p = placements?.get(n.id);
        return p ? { ...b, ...p.rect } : b;
      }),
    [nodes, placements, width, height],
  );
  const [fitted, setFitted] = useState<Map<string, number>>(() => new Map());
  const styled = useMemo(
    () => base.map(({ node, style }) => ({ node, style: fitted.has(node.id) ? { ...style, size: fitted.get(node.id)! } : style })),
    [base, fitted],
  );
  const [plates, setPlates] = useState<Map<string, Rect>>(() => new Map());
  const els = useRef(new Map<string, HTMLDivElement>());
  // Fit-to-width and plates need the ink even when the slide has no relations.
  const needsLocal = nodes.some((n) => n.data.fitWidth || n.data.plate);
  const measure = !!needsInk || needsLocal;
  const layoutKey = useMemo(
    () => (measure ? textLayoutKey(nodes, styled.map((s) => s.style), rects.map((r) => r.w)) : ""),
    [measure, nodes, styled, rects],
  );
  const [fontTick, setFontTick] = useState(0);
  const [reported, setReported] = useState<string | null>(null);
  const key = `${layoutKey}|${fontTick}`;
  usePending("layout:text", "layout: text", measure && reported !== key);

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
    // Fit-to-width first: the size that makes the widest line fill the box, from the base style.
    const nextFit = new Map<string, number>();
    base.forEach(({ node, style }, i) => {
      if (!node.data.fitWidth) return;
      const font = `${style.italic ? "italic " : ""}${style.weight} ${style.size}px ${cssFontFamily(style.family)}`;
      const natural = widestLinePx(font, style.letterSpacing * style.size, node.data.text, style.uppercase);
      nextFit.set(node.id, fitWidthSize(natural, style.size, rects[i].w));
    });
    let fitChanged = nextFit.size !== fitted.size;
    for (const [id, size] of nextFit) if (fitted.get(id) !== size) fitChanged = true;
    if (fitChanged) {
      setFitted(nextFit);
      return; // the re-render with the fitted sizes runs this effect again
    }
    const ink = new Map<string, TextInk>();
    const nextPlates = new Map<string, Rect>();
    for (const { node } of styled) {
      const el = els.current.get(node.id);
      if (!el) continue;
      const scale = withoutTransforms(el, () => el.getBoundingClientRect().width / Math.max(1e-6, el.offsetWidth) || 1);
      const ext = inkExtent(el, scale);
      const textEl = (el.querySelector("[data-xds-text]") as HTMLElement) ?? el;
      const b = rects[nodes.indexOf(node)];
      const glyphs = { top: ext?.top ?? 0, bottom: ext?.bottom ?? b.h, left: ext?.left ?? 0, right: ext?.right ?? b.w };
      const grown = hasTreatment(node.data) ? treatedExtent(node.data, glyphs, u) : glyphs;
      const entry: TextInk = { ...grown, contentHeight: textEl.offsetHeight };
      if (fitted.has(node.id)) entry.fittedSize = fitted.get(node.id);
      ink.set(node.id, entry);
      if (node.data.plate) {
        const skewEl = el.querySelector<HTMLElement>("[data-xds-skew]");
        const p = plateRect(node.data, glyphs, u);
        nextPlates.set(node.id, { ...p, y: p.y - (skewEl?.offsetTop ?? 0) });
      }
    }
    let platesChanged = nextPlates.size !== plates.size;
    for (const [id, r] of nextPlates) {
      const q = plates.get(id);
      if (!q || q.x !== r.x || q.y !== r.y || q.w !== r.w || q.h !== r.h) platesChanged = true;
    }
    if (platesChanged) setPlates(nextPlates);
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
        const d = node.data;
        const v = d.valign ?? "top";
        const text = typeTextStyle(style, d.align);
        const stroke = strokeStyle(node, style, project, u, false);
        const clones: (CloneOffset & { color: string; kind: "extrude" | "repeat" })[] = [];
        if (d.extrude) {
          const color = tokenHex(project, d.extrude.color) ?? withAlpha(style.color, 0.4);
          for (const c of [...extrudeOffsets(d.extrude, u)].reverse()) clones.push({ ...c, color, kind: "extrude" });
        }
        if (d.repeat) {
          for (const c of [...repeatOffsets(d.repeat, u)].reverse()) clones.push({ ...c, color: style.color, kind: "repeat" });
        }
        const plate = plates.get(node.id);
        const plateFill = d.plate ? tokenHex(project, d.plate.fill) : null;
        const plateStroke = d.plate?.stroke ? `${d.plate.stroke.width * u}px solid ${tokenHex(project, d.plate.stroke.color) ?? style.color}` : undefined;
        return (
          <div
            key={node.id}
            ref={(el) => {
              if (el) els.current.set(node.id, el);
              else els.current.delete(node.id);
            }}
            data-node-id={node.id}
            data-layer="type"
            data-treated={hasTreatment(d) || b.rotation ? "" : undefined}
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
            <div
              data-xds-skew=""
              style={{
                position: "relative",
                width: "100%",
                transform: d.skew ? `skewX(${d.skew}deg)` : undefined,
                transformOrigin: "center",
              }}
            >
              {plate && (
                <div
                  data-xds-plate=""
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: plate.x,
                    top: plate.y,
                    width: plate.w,
                    height: plate.h,
                    borderRadius: (d.plate?.radius ?? 0) * u,
                    background: plateFill && plateFill !== "none" ? plateFill : d.plate?.fill === "none" || plateStroke ? "transparent" : withAlpha(style.color, 0.12),
                    border: plateStroke,
                    boxSizing: "border-box",
                    zIndex: 0,
                  }}
                />
              )}
              {clones.map((c, k) => (
                <div
                  key={k}
                  data-xds-clone={c.kind}
                  aria-hidden
                  style={{
                    ...text,
                    ...(c.outline ? strokeStyle(node, { ...style, color: c.color }, project, u, true) : stroke),
                    ...(c.outline ? {} : { color: c.color }),
                    position: "absolute",
                    left: c.dx,
                    top: c.dy,
                    width: "100%",
                    opacity: c.opacity,
                    zIndex: 1,
                    pointerEvents: "none",
                  }}
                >
                  {d.text}
                </div>
              ))}
              <div data-xds-text="" style={{ ...text, ...stroke, position: "relative", zIndex: 2 }}>
                {d.text}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
