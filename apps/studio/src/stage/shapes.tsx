/**
 * Ornaments (`ShapeData`, data-models §2.5d): parameterized vector shapes drawn by the renderer
 * as inline SVG, so they are real ink for the audit's image-layer mask and need no file.
 *
 * Geometry is computed in the box's own px (viewBox = the box), with `preserveAspectRatio="none"`,
 * so the SVG maps 1:1 onto the box at any scale (the stage, a thumbnail, a 14 px menu preview).
 * Shapes that keep their aspect (stars, sparkle, ring, plus, arc) are drawn in the largest
 * centered square; the others (ellipse, lens, rings, rect, line, grid) fill the box.
 *
 * Stroke width is `stroke.width × u` px. Defaults: a shape with a stroke has no fill; a shape
 * without one is filled with the stroke color; the stroke color defaults to the slide's default
 * text color (the brand's `ink`, else the color that contrasts with the background).
 */
import type { CSSProperties, ReactNode } from "react";
import type { Project, Shape, ShapeData } from "@xds/protocol";
import { defaultTextColor, tokenHex } from "./typeStyle";

export const SHAPES: Shape[] = ["star-4", "star-8", "sparkle", "ring", "rings", "lens", "ellipse", "rect", "line", "plus", "arc", "grid"];

export const SHAPE_LABELS: Record<Shape, string> = {
  "star-4": "Star, 4 points",
  "star-8": "Star, 8 points",
  sparkle: "Sparkle",
  ring: "Ring",
  rings: "Rings",
  lens: "Lens",
  ellipse: "Ellipse",
  rect: "Rectangle",
  line: "Line",
  plus: "Plus",
  arc: "Arc",
  grid: "Grid",
};

export interface ShapeParam {
  key: string;
  label: string;
  default: number;
  step: number;
  min?: number;
  max?: number;
  /** Shown after the field. */
  unit?: string;
}

const POINTS = (d: number): ShapeParam => ({ key: "points", label: "Points", default: d, step: 1, min: 3, max: 24 });
const INNER = (d: number): ShapeParam => ({ key: "inner", label: "Inner", default: d, step: 0.05, min: 0.05, max: 0.95 });
const ANGLE = (d: number): ShapeParam => ({ key: "angle", label: "Angle", default: d, step: 1, min: -360, max: 360, unit: "°" });

/** The knobs each shape reads from `params`, with their defaults (documented in data-models §2.5d). */
export const SHAPE_PARAMS: Record<Shape, ShapeParam[]> = {
  "star-4": [POINTS(4), INNER(0.4)],
  "star-8": [POINTS(8), INNER(0.4)],
  sparkle: [POINTS(4), INNER(0.15)],
  ring: [],
  rings: [
    { key: "count", label: "Count", default: 3, step: 1, min: 1, max: 24 },
    { key: "spread", label: "Spread", default: 0, step: 0.25, min: 0, max: 40, unit: "u" },
    ANGLE(90),
  ],
  lens: [{ key: "count", label: "Count", default: 3, step: 1, min: 1, max: 12 }],
  ellipse: [],
  rect: [{ key: "radius", label: "Radius", default: 0, step: 0.25, min: 0, max: 40, unit: "u" }],
  line: [ANGLE(0)],
  plus: [],
  arc: [ANGLE(0), { key: "sweep", label: "Sweep", default: 180, step: 5, min: 1, max: 359, unit: "°" }],
  grid: [{ key: "count", label: "Lines", default: 4, step: 1, min: 1, max: 40 }],
};

export const paramDefault = (shape: Shape, key: string): number => SHAPE_PARAMS[shape].find((p) => p.key === key)?.default ?? 0;

export interface ShapeStyle {
  /** Stroke width in px (0 = no stroke). */
  stroke: number;
  strokeColor: string;
  /** A hex color, or "none". */
  fill: string;
}

/** The resolved style of a shape node on a slide. */
export function shapeStyle(data: ShapeData, project: Project, background: string | null, u: number): ShapeStyle {
  const base = defaultTextColor(project, background);
  const strokeColor = tokenHex(project, data.stroke?.color) ?? base;
  const stroke = data.stroke ? data.stroke.width * u : 0;
  const fill = data.fill === "none" ? "none" : (tokenHex(project, data.fill) ?? (stroke > 0 ? "none" : strokeColor));
  return { stroke, strokeColor, fill };
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const pt = (x: number, y: number) => `${r2(x)},${r2(y)}`;

function star(cx: number, cy: number, R: number, points: number, inner: number, curved: boolean): string {
  const n = Math.max(3, Math.round(points));
  const r = R * inner;
  const tips: [number, number][] = [];
  const dips: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const b = a + Math.PI / n;
    tips.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
    dips.push([cx + r * Math.cos(b), cy + r * Math.sin(b)]);
  }
  let d = `M${pt(...tips[0])}`;
  for (let i = 0; i < n; i++) {
    const next = tips[(i + 1) % n];
    d += curved ? ` Q${pt(...dips[i])} ${pt(...next)}` : ` L${pt(...dips[i])} L${pt(...next)}`;
  }
  return d + " Z";
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, sweepDeg: number): string {
  const s = ((startDeg - 90) * Math.PI) / 180;
  const e = ((startDeg - 90 + sweepDeg) * Math.PI) / 180;
  const large = sweepDeg > 180 ? 1 : 0;
  return `M${pt(cx + r * Math.cos(s), cy + r * Math.sin(s))} A${r2(r)},${r2(r)} 0 ${large} 1 ${pt(cx + r * Math.cos(e), cy + r * Math.sin(e))}`;
}

/** The SVG children for a shape in a `w × h` px box. */
export function shapeChildren(shape: Shape, w: number, h: number, u: number, style: ShapeStyle, params: Record<string, number> = {}): ReactNode {
  const p = (key: string) => params[key] ?? paramDefault(shape, key);
  const sw = style.stroke;
  const common = { fill: style.fill, stroke: sw > 0 ? style.strokeColor : "none", strokeWidth: sw };
  // open shapes (lines, arcs, grids, cross hairs) are always stroked: a hairline when no stroke is set
  const lineProps = { fill: "none", stroke: style.strokeColor, strokeWidth: sw > 0 ? sw : Math.max(1, u / 8) };
  const cx = w / 2;
  const cy = h / 2;
  const inset = sw / 2;
  const R = Math.max(1, Math.min(w, h) / 2 - inset);
  switch (shape) {
    case "star-4":
    case "star-8":
      return <path d={star(cx, cy, R, p("points"), p("inner"), false)} {...common} strokeLinejoin="miter" />;
    case "sparkle":
      return <path d={star(cx, cy, R, p("points"), p("inner"), true)} {...common} />;
    case "ring":
      return <circle cx={cx} cy={cy} r={R} {...common} />;
    case "ellipse":
      return <ellipse cx={cx} cy={cy} rx={Math.max(1, w / 2 - inset)} ry={Math.max(1, h / 2 - inset)} {...common} />;
    case "rings": {
      const count = Math.max(1, Math.round(p("count")));
      const spread = p("spread") * u;
      const a = (p("angle") * Math.PI) / 180;
      if (spread > 0) {
        // identical ellipses stepping along `angle`, the whole stack centered in the box
        const dx = Math.cos(a) * spread;
        const dy = Math.sin(a) * spread;
        const rx = Math.max(1, (w - Math.abs(dx) * (count - 1)) / 2 - inset);
        const ry = Math.max(1, (h - Math.abs(dy) * (count - 1)) / 2 - inset);
        const x0 = cx - (dx * (count - 1)) / 2;
        const y0 = cy - (dy * (count - 1)) / 2;
        return Array.from({ length: count }, (_, i) => <ellipse key={i} cx={x0 + dx * i} cy={y0 + dy * i} rx={rx} ry={ry} {...common} />);
      }
      return Array.from({ length: count }, (_, i) => {
        const k = (i + 1) / count;
        return <ellipse key={i} cx={cx} cy={cy} rx={Math.max(1, (w / 2 - inset) * k)} ry={Math.max(1, (h / 2 - inset) * k)} {...common} />;
      });
    }
    case "lens": {
      // a framed lens diagram: the frame, nested ellipses narrowing towards the center, a cross hair
      const count = Math.max(1, Math.round(p("count")));
      const ry = Math.max(1, h / 2 - inset - u / 2);
      return (
        <>
          <rect x={inset} y={inset} width={Math.max(1, w - sw)} height={Math.max(1, h - sw)} {...common} />
          {Array.from({ length: count }, (_, i) => {
            const k = 1 - i / (count + 1);
            return <ellipse key={i} cx={cx} cy={cy} rx={Math.max(1, (w / 2 - inset - u / 2) * k)} ry={ry} {...common} fill="none" />;
          })}
          <path d={`M${pt(cx - u, cy)} H${r2(cx + u)} M${pt(cx, cy - u)} V${r2(cy + u)}`} {...lineProps} />
        </>
      );
    }
    case "rect": {
      const rx = p("radius") * u;
      return <rect x={inset} y={inset} width={Math.max(1, w - sw)} height={Math.max(1, h - sw)} rx={rx} ry={rx} {...common} />;
    }
    case "line": {
      const a = (p("angle") * Math.PI) / 180;
      // the longest segment through the center at that angle that stays inside the box
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const tx = dx ? Math.abs((w / 2 - inset) / dx) : Infinity;
      const ty = dy ? Math.abs((h / 2 - inset) / dy) : Infinity;
      const t = Math.min(tx, ty);
      return <path d={`M${pt(cx - dx * t, cy - dy * t)} L${pt(cx + dx * t, cy + dy * t)}`} {...lineProps} strokeLinecap="round" />;
    }
    case "plus":
      return <path d={`M${pt(cx - R, cy)} H${r2(cx + R)} M${pt(cx, cy - R)} V${r2(cy + R)}`} {...lineProps} strokeLinecap="round" />;
    case "arc":
      return <path d={arcPath(cx, cy, R, p("angle"), Math.min(359.9, Math.max(1, p("sweep"))))} {...lineProps} strokeLinecap="round" />;
    case "grid": {
      const n = Math.max(1, Math.round(p("count")));
      let d = "";
      for (let i = 0; i <= n; i++) {
        const x = inset + ((w - sw) * i) / n;
        const y = inset + ((h - sw) * i) / n;
        d += ` M${pt(x, inset)} V${r2(h - inset)} M${pt(inset, y)} H${r2(w - inset)}`;
      }
      return <path d={d.trim()} {...lineProps} />;
    }
  }
}

/** The shape as an SVG that fills its container (`width`/`height` default 100%). */
export function ShapeSvg({
  shape,
  w,
  h,
  u,
  style,
  params,
  width = "100%",
  height = "100%",
  svgStyle,
}: {
  shape: Shape;
  w: number;
  h: number;
  u: number;
  style: ShapeStyle;
  params?: Record<string, number>;
  width?: number | string;
  height?: number | string;
  svgStyle?: CSSProperties;
}) {
  return (
    <svg width={width} height={height} viewBox={`0 0 ${r2(w)} ${r2(h)}`} preserveAspectRatio="none" style={{ display: "block", ...svgStyle }} aria-hidden>
      {shapeChildren(shape, w, h, u, style, params)}
    </svg>
  );
}

/** A small preview for menus: a thin stroke, no fill, in the current text color. */
export function ShapePreview({ shape, size = 14, color = "currentColor" }: { shape: Shape; size?: number; color?: string }) {
  return <ShapeSvg shape={shape} w={size} h={size} u={1.5} style={{ stroke: 1.2, strokeColor: color, fill: "none" }} width={size} height={size} />;
}
