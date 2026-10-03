/**
 * The type layer: plain DOM text with @font-face rules for the project's font files. Font
 * loading is awaited (`document.fonts.load`) and reported as pending ("fonts: Satoshi 700").
 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { Project, TypeNode } from "@xds/protocol";
import { boxToPx } from "@xds/editor-core";
import { fileUrl } from "../api";
import type { Guide } from "../types";
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
  background: string | null;
  guide?: Guide | null;
  width: number;
  height: number;
  overlay?: ReactNode;
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
    margin: 0,
    fontKerning: "normal",
    fontSynthesis: "none",
  };
}

export function TypeLayer({ project, nodes, background, guide, width, height }: TypeLayerProps) {
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

  return (
    <>
      {fonts.map((f) => (
        <FontLoad key={`${f.family}|${f.weight}|${f.italic}`} req={f} />
      ))}
      {styled.map(({ node, style }) => {
        const b = boxToPx(node.box, { width, height });
        const v = node.data.valign ?? "top";
        return (
          <div
            key={node.id}
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
