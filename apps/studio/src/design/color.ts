/**
 * Color functions for design expressions (lighting-and-backgrounds §3.3), in OKLCH via culori.
 * Inputs are hex strings; results are gamut-mapped to sRGB by reducing chroma and written as
 * lowercase `#rrggbb`, or `#rrggbbaa` when alpha < 1 (the same contract as xds/designs.py).
 */
import { clampChroma, converter, formatHex, formatHex8, parse, type Oklch } from "culori";

const toOklch = converter("oklch");
const toOklab = converter("oklab");

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export class ColorError extends Error {}

function num(v: unknown): number {
  if (typeof v !== "number" || Number.isNaN(v)) throw new ColorError(`expected a number, got ${JSON.stringify(v)}`);
  return v;
}

function lch(c: unknown): Oklch {
  if (typeof c !== "string" || !HEX.test(c)) throw new ColorError(`expected a hex color, got ${JSON.stringify(c)}`);
  const parsed = parse(c);
  const o = parsed && toOklch(parsed);
  if (!o) throw new ColorError(`cannot read color ${c}`);
  return { mode: "oklch", l: o.l, c: o.c ?? 0, h: o.h ?? 0, alpha: o.alpha ?? 1 };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function out(o: Oklch): string {
  const color: Oklch = { ...o, l: clamp01(o.l), c: Math.max(0, o.c) };
  const mapped = clampChroma(color, "oklch") as Oklch;
  const alpha = mapped.alpha ?? 1;
  return alpha < 1 ? formatHex8({ ...mapped, alpha }) : formatHex({ ...mapped, alpha: undefined });
}

export function tone(c: unknown, lightness: unknown, chroma?: unknown): string {
  const o = lch(c);
  return out({ ...o, l: num(lightness), c: chroma === undefined ? o.c : num(chroma) });
}

export function shade(c: unknown, dl: unknown): string {
  const o = lch(c);
  return out({ ...o, l: o.l + num(dl) });
}

export function hue(c: unknown, deg: unknown): string {
  const o = lch(c);
  return out({ ...o, h: ((((o.h ?? 0) + num(deg)) % 360) + 360) % 360 });
}

export function alpha(c: unknown, a: unknown): string {
  if (typeof c !== "string" || !HEX.test(c)) throw new ColorError(`expected a hex color, got ${JSON.stringify(c)}`);
  const parsed = parse(c)!;
  const al = clamp01(num(a));
  return al < 1 ? formatHex8({ ...parsed, alpha: al }) : formatHex({ ...parsed, alpha: undefined });
}

/** Interpolate in OKLab, then gamut-map in OKLCH. */
export function mix(a: unknown, b: unknown, t: unknown): string {
  const k = clamp01(num(t));
  const pa = lch(a);
  const pb = lch(b);
  const la = toOklab(pa)!;
  const lb = toOklab(pb)!;
  const L = la.l + (lb.l - la.l) * k;
  const A = la.a + (lb.a - la.a) * k;
  const B = la.b + (lb.b - la.b) * k;
  const C = Math.hypot(A, B);
  const H = ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  const al = (pa.alpha ?? 1) + ((pb.alpha ?? 1) - (pa.alpha ?? 1)) * k;
  return out({ mode: "oklch", l: L, c: C, h: H, alpha: al });
}

/** WCAG relative luminance of a hex color (for picking a readable default text color). */
export function luminance(hex: string): number {
  const p = parse(hex);
  if (!p) return 0;
  const rgb = converter("rgb")(p)!;
  const f = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(rgb.r) + 0.7152 * f(rgb.g) + 0.0722 * f(rgb.b);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Normalize any CSS color to `#rrggbb` (alpha dropped); null when it can't be parsed. */
export function toHex(css: string): string | null {
  const p = parse(css);
  return p ? formatHex({ ...p, alpha: undefined }) : null;
}
