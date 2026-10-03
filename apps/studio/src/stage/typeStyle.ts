/**
 * Effective type style (CONTRACTS.md, data-models §2.5):
 * `node.data.<field> ?? brand.typography[role].<field> ?? band default for the level`.
 * Size from the band default, lineHeight = midpoint of the band's line-height range, weight 400,
 * letterSpacing 0; color: node/role color → the brand color named "ink" → the brand color with
 * the best contrast against the slide background.
 */
import type { Project, TypeData, TypeRole } from "@xds/protocol";
import { contrastRatio } from "../design/color";
import type { Guide, GuideBand, Level } from "../types";

export interface EffectiveTypeStyle {
  family: string | null;
  size: number;
  weight: number;
  italic: boolean;
  lineHeight: number; // unitless
  letterSpacing: number; // em
  uppercase: boolean;
  color: string; // #rrggbb
  level: Level;
}

/** Band fractions of the short edge (design-rules §1.2), used when no guide is available. */
const FALLBACK_BANDS: Record<Level, { default: number; lh: [number, number] }> = {
  display: { default: 0.11, lh: [0.9, 1.1] },
  headline: { default: 0.065, lh: [1.0, 1.2] },
  subhead: { default: 0.042, lh: [1.1, 1.35] },
  body: { default: 0.034, lh: [1.3, 1.6] },
  caption: { default: 0.029, lh: [1.3, 1.6] },
};

export function bandFor(level: Level, project: Project, guide?: Guide | null): Pick<GuideBand, "default" | "line_height"> {
  const b = guide?.bands?.[level];
  if (b) return b;
  const s = Math.min(project.format.width, project.format.height);
  const f = FALLBACK_BANDS[level] ?? FALLBACK_BANDS.body;
  return { default: Math.round(f.default * s), line_height: f.lh };
}

const HEX = /^#([0-9a-fA-F]{6})$/;

export function tokenHex(project: Project, token: string | undefined | null): string | null {
  if (!token) return null;
  const c = project.brand?.colors?.find((t) => t.name === token);
  if (c) return c.hex.toLowerCase();
  return HEX.test(token) ? token.toLowerCase() : null;
}

export function defaultTextColor(project: Project, background: string | null): string {
  const ink = tokenHex(project, "ink");
  if (ink) return ink;
  const bg = background ?? "#ffffff";
  let best: string | null = null;
  let bestRatio = 0;
  for (const c of project.brand?.colors ?? []) {
    const r = contrastRatio(c.hex, bg);
    if (r > bestRatio) {
      bestRatio = r;
      best = c.hex.toLowerCase();
    }
  }
  if (best && bestRatio >= 3) return best;
  return contrastRatio("#111111", bg) >= contrastRatio("#ffffff", bg) ? "#111111" : "#ffffff";
}

export function effectiveTypeStyle(
  data: TypeData,
  project: Project,
  slideBackground: string | null,
  guide?: Guide | null,
): EffectiveTypeStyle {
  const role: Partial<TypeRole> = project.brand?.typography?.[data.role] ?? {};
  const level = (role.level ?? "body") as Level;
  const band = bandFor(level, project, guide);
  const color =
    tokenHex(project, data.color) ?? tokenHex(project, role.color) ?? defaultTextColor(project, slideBackground);
  return {
    family: role.font ?? null,
    size: data.size ?? role.size ?? band.default,
    weight: data.weight ?? role.weight ?? 400,
    italic: data.italic ?? role.italic ?? false,
    lineHeight: data.lineHeight ?? role.lineHeight ?? (band.line_height[0] + band.line_height[1]) / 2,
    letterSpacing: data.letterSpacing ?? role.letterSpacing ?? 0,
    uppercase: data.uppercase ?? role.uppercase ?? false,
    color,
    level,
  };
}

export function cssFontFamily(family: string | null): string {
  return family ? `"${family.replace(/"/g, "")}", system-ui, sans-serif` : "system-ui, sans-serif";
}
