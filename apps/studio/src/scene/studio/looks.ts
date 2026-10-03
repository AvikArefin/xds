/**
 * Lighting looks (lighting-and-backgrounds §1.3): fixed arrangements of Lightformer softboxes in
 * a procedural studio environment. Read each table as a lighting diagram, seen from above:
 *
 *   az   azimuth in degrees around the subject, relative to the key (the rig's `angle` is added;
 *        0 = where the key is, +90 = a quarter turn counter-clockwise seen from above)
 *   el   elevation in degrees above the horizon (the key's comes from the `elevation` knob)
 *   w, h size of the softbox in meters at `dist` meters from the subject
 *   power  relative strength before normalization
 *
 * Every look is normalized to the same energy budget (Σ intensity × area), so switching looks
 * changes the character of the light, not its overall level. The backdrop is the environment's
 * background: never black, so nothing goes fully dark.
 */
import type { Lighting } from "@xds/protocol";

export type LookName = NonNullable<Lighting["look"]>;

export interface Softbox {
  role: "key" | "fill" | "rim" | "top" | "strip";
  az: number;
  el: number;
  dist: number;
  w: number;
  h: number;
  power: number;
  form?: "rect" | "circle";
}

export interface Look {
  name: LookName;
  /** Backdrop gray (sRGB 0..1). */
  backdrop: number;
  lights: Softbox[];
}

export interface NormalizedSoftbox extends Softbox {
  intensity: number;
}

export interface NormalizedLook extends Omit<Look, "lights"> {
  lights: NormalizedSoftbox[];
}

/** Σ intensity × area for every look. */
export const ENERGY_BUDGET = 48;

const RAW: Record<LookName, Look> = {
  softbox: {
    name: "softbox",
    backdrop: 0.42,
    lights: [
      { role: "key", az: 0, el: 30, dist: 5, w: 4, h: 4, power: 1 },
      { role: "fill", az: -100, el: 15, dist: 5, w: 5, h: 4, power: 0.3 },
      { role: "top", az: 0, el: 89, dist: 5, w: 5, h: 5, power: 0.45 },
      { role: "rim", az: 160, el: 20, dist: 5, w: 1, h: 4, power: 0.8 },
    ],
  },
  contrast: {
    name: "contrast",
    backdrop: 0.3,
    lights: [
      { role: "key", az: 0, el: 30, dist: 5, w: 2.5, h: 4, power: 1.4 },
      { role: "fill", az: -100, el: 15, dist: 5, w: 4, h: 4, power: 0.2 },
      { role: "strip", az: 125, el: 10, dist: 5, w: 0.6, h: 6, power: 2.4 },
      { role: "strip", az: -135, el: 10, dist: 5, w: 0.6, h: 6, power: 2.4 },
    ],
  },
  rim: {
    name: "rim",
    backdrop: 0.24,
    lights: [
      { role: "key", az: 0, el: 30, dist: 5, w: 3, h: 3, power: 0.25 },
      { role: "strip", az: 150, el: 15, dist: 5, w: 1, h: 6, power: 3 },
      { role: "strip", az: -150, el: 15, dist: 5, w: 1, h: 6, power: 3 },
      { role: "top", az: 0, el: 89, dist: 5, w: 3, h: 3, power: 0.3 },
    ],
  },
  bright: {
    name: "bright",
    backdrop: 0.62,
    lights: [
      { role: "key", az: 0, el: 30, dist: 5, w: 6, h: 6, power: 1 },
      { role: "fill", az: -100, el: 15, dist: 5, w: 6, h: 5, power: 0.7 },
      { role: "top", az: 0, el: 89, dist: 5, w: 7, h: 7, power: 0.6 },
      { role: "fill", az: 120, el: 10, dist: 5, w: 5, h: 4, power: 0.5 },
    ],
  },
};

function normalize(look: Look): NormalizedLook {
  const energy = look.lights.reduce((s, l) => s + l.power * l.w * l.h, 0);
  const k = ENERGY_BUDGET / energy;
  return { ...look, lights: look.lights.map((l) => ({ ...l, intensity: l.power * k })) };
}

export const LOOKS: Record<LookName, NormalizedLook> = Object.fromEntries(
  Object.entries(RAW).map(([k, v]) => [k, normalize(v)]),
) as Record<LookName, NormalizedLook>;

export const LIGHTING_DEFAULTS: Required<Omit<Lighting, "tint">> & { tint: string | null } = {
  look: "softbox",
  angle: 35,
  elevation: 30,
  shadow: "contact",
  brightness: 0,
  tint: null,
};

export type ResolvedLighting = typeof LIGHTING_DEFAULTS;

/** project.lighting, overridden field by field by slide.lighting (null/undefined = inherit). */
export function resolveLighting(project?: Partial<Lighting> | null, slide?: Partial<Lighting> | null): ResolvedLighting {
  const out = { ...LIGHTING_DEFAULTS };
  for (const src of [project, slide]) {
    if (!src) continue;
    for (const [k, v] of Object.entries(src)) {
      if (v !== null && v !== undefined) (out as Record<string, unknown>)[k] = v;
    }
  }
  if (!LOOKS[out.look]) out.look = "softbox";
  return out;
}

/** Position of a softbox in the environment for a rig angle/elevation (Y up, angle 0 = +Z). */
export function softboxPosition(l: Softbox, angle: number, elevation: number): [number, number, number] {
  const el = ((l.role === "key" ? elevation : l.el) * Math.PI) / 180;
  const az = ((angle + l.az) * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el) * l.dist, Math.sin(el) * l.dist, Math.cos(az) * Math.cos(el) * l.dist];
}
