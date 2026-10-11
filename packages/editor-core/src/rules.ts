/**
 * The text-geometry audit rules, in the editor (design-rules §2.1). Each one mirrors a rule in
 * xds/audit/rules (same id, severity, thresholds and fix), but runs on what the editor already
 * knows: the resolved boxes and the measured text lines of the active slide. No pixels, so
 * contrast, the subject, images' opaque ink and composition stay the audit's. The live set is a
 * preview; `xds audit` is the source of truth.
 *
 * Differences from the audit, by design: EDGES_KISSING and POSITION_NEAR_MISS skip the 3D
 * subject (its silhouette needs a render); OUTSIDE_MARGIN and EDGES_KISSING use an image's box,
 * not its opaque pixels; GROUPING_AMBIGUOUS and SPACING_INCONSISTENT look at declared groups
 * only (the audit also clusters ungrouped blocks by gap).
 */
import type { Edit, Finding } from "@xds/protocol";
import type { Rect } from "./box";

export type Severity = "error" | "warn" | "info";

export interface LiveNode {
  id: string;
  name?: string;
  layer: "ground" | "image" | "type" | "render";
  /** The resolved box, px (the subject's bounds for a render node, when known). */
  rect: Rect;
  /** A text block's ink line rects and their text, px. */
  lines?: Rect[];
  lineTexts?: string[];
  /** The browser reports overflow (text taller or wider than its box). */
  overflow?: boolean;
  /** The laid-out text's height, px. */
  contentHeight?: number;
  size?: number;
  level?: string;
  group?: string | null;
  decorative?: boolean;
  align?: "left" | "center" | "right";
  /** `"\n"` in the source text (a forced last line is not a widow). */
  forcedLastLine?: boolean;
  /** Where a move on an axis is written: the stack gap (path + dir + gap) or the box. */
  stack?: { axis: "x" | "y"; path: string; dir: 1 | -1; gap: number } | null;
  /** Rules waived on this node (its `exceptions`). */
  waived?: string[];
}

export interface LiveBand {
  min: number;
  max: number;
  maxLines: number;
  chars: [number | null, number | null];
}

export interface LiveGuide {
  width: number;
  height: number;
  u: number;
  margins: { top: number; right: number; bottom: number; left: number };
  safeZones?: { name: string; x: number; y: number; w: number; h: number }[];
  spacingScale?: number[];
  bands?: Record<string, LiveBand>;
  /** Display scale (screen px per canvas px), for the size messages. */
  k?: number;
  /** The slide budget: blocks (default 7). */
  blocks?: number;
}

export interface LiveOptions {
  slideId?: string;
  /** `project.rules.off`. */
  off?: string[];
  /** `project.rules.set` (the keys this module reads; others are ignored). */
  set?: Record<string, number | number[]>;
  /** Rules waived on the slide (`Slide.exceptions`). */
  slideWaived?: string[];
}

export type LiveFinding = Finding;

/** Every rule this module runs, in the order it runs them. */
export const LIVE_RULES = [
  "TEXT_OVERLAP",
  "TEXT_CROWDED",
  "TEXT_CLIPPED",
  "IN_SAFE_ZONE",
  "OUTSIDE_MARGIN",
  "EDGES_KISSING",
  "ALIGN_NEAR_MISS",
  "MARGIN_NEAR_MISS",
  "GROUPING_AMBIGUOUS",
  "SPACING_INCONSISTENT",
  "SPACING_OFF_SCALE",
  "POSITION_NEAR_MISS",
  "TOO_MANY_ELEMENTS",
  "TEXT_TOO_SMALL",
  "TEXT_TOO_LARGE",
  "HIERARCHY_WEAK",
  "SIZE_NEAR_MISS",
  "TOO_MANY_SIZES",
  "TOO_MANY_LINES",
  "WIDOW",
  "LINE_LENGTH",
] as const;

export type LiveRule = (typeof LIVE_RULES)[number];

const FAMILY: Record<LiveRule, string> = {
  TEXT_OVERLAP: "collision",
  TEXT_CROWDED: "collision",
  TEXT_CLIPPED: "collision",
  IN_SAFE_ZONE: "collision",
  OUTSIDE_MARGIN: "collision",
  EDGES_KISSING: "collision",
  ALIGN_NEAR_MISS: "spacing",
  MARGIN_NEAR_MISS: "spacing",
  GROUPING_AMBIGUOUS: "spacing",
  SPACING_INCONSISTENT: "spacing",
  SPACING_OFF_SCALE: "spacing",
  POSITION_NEAR_MISS: "composition",
  TOO_MANY_ELEMENTS: "composition",
  TEXT_TOO_SMALL: "type",
  TEXT_TOO_LARGE: "type",
  HIERARCHY_WEAK: "type",
  SIZE_NEAR_MISS: "type",
  TOO_MANY_SIZES: "type",
  TOO_MANY_LINES: "type",
  WIDOW: "type",
  LINE_LENGTH: "type",
};

const PRINCIPLE: Record<LiveRule, string> = {
  TEXT_OVERLAP: "Overlapping text can't be read.",
  TEXT_CROWDED: "A tangent gap reads as a mistake, not a choice.",
  TEXT_CLIPPED: "Cut-off text is broken text.",
  IN_SAFE_ZONE: "The app's UI will cover anything in a platform safe zone.",
  OUTSIDE_MARGIN: "Content outside the margin creates edge tension: it feels about to fall off.",
  EDGES_KISSING: "Tangency creates visual tension and looks unintended.",
  ALIGN_NEAR_MISS: "Align exactly, or separate clearly.",
  MARGIN_NEAR_MISS: "Snap to the margin.",
  GROUPING_AMBIGUOUS: "Gestalt proximity: related things sit closer than unrelated ones.",
  SPACING_INCONSISTENT: "Rhythm: gaps in one stack should be equal.",
  SPACING_OFF_SCALE: "A consistent spacing scale: vertical gaps are multiples of u.",
  POSITION_NEAR_MISS: "Commit to the center or to a third.",
  TOO_MANY_ELEMENTS: "A glance takes in a handful of things; more is clutter.",
  TEXT_TOO_SMALL: "Legibility on the device: text below its level's minimum can't be read where it's seen.",
  TEXT_TOO_LARGE: "Text above its level's maximum means the level is wrong, or the role is.",
  HIERARCHY_WEAK: "Levels must be clearly different to read as levels.",
  SIZE_NEAR_MISS: "Make two sizes the same, or clearly different.",
  TOO_MANY_SIZES: "Too many sizes on one slide blur the hierarchy.",
  TOO_MANY_LINES: "A headline that needs five lines is body text.",
  WIDOW: "A one-word or very short last line looks ragged and unfinished.",
  LINE_LENGTH: "A comfortable measure: lines neither too long to track nor too short to flow.",
};

const LEVEL_RANK: Record<string, number> = { expressive: -1, display: 0, headline: 1, subhead: 2, body: 3, caption: 4 };
const LEVELS = ["expressive", "display", "headline", "subhead", "body", "caption"];

// --- rect helpers (the same operations as xds/audit/geometry.R) ------------------------------

const x1 = (r: Rect) => r.x + r.w;
const y1 = (r: Rect) => r.y + r.h;
const cx = (r: Rect) => r.x + r.w / 2;
const cy = (r: Rect) => r.y + r.h / 2;
const area = (r: Rect) => r.w * r.h;

export function intersect(a: Rect, b: Rect): Rect | null {
  const l = Math.max(a.x, b.x);
  const t = Math.max(a.y, b.y);
  const r = Math.min(x1(a), x1(b));
  const btm = Math.min(y1(a), y1(b));
  return r > l && btm > t ? { x: l, y: t, w: r - l, h: btm - t } : null;
}

export function union(a: Rect, b: Rect): Rect {
  const l = Math.min(a.x, b.x);
  const t = Math.min(a.y, b.y);
  return { x: l, y: t, w: Math.max(x1(a), x1(b)) - l, h: Math.max(y1(a), y1(b)) - t };
}

export function unionAll(rects: Rect[]): Rect | null {
  return rects.length ? rects.reduce((acc, r) => union(acc, r)) : null;
}

/** Euclidean distance between two rects (0 when they touch or overlap). */
export function rectGap(a: Rect, b: Rect): number {
  const dx = Math.max(0, b.x - x1(a), a.x - x1(b));
  const dy = Math.max(0, b.y - y1(a), a.y - y1(b));
  return Math.hypot(dx, dy);
}

const hOverlap = (a: Rect, b: Rect) => Math.min(x1(a), x1(b)) - Math.max(a.x, b.x);
const vOverlap = (a: Rect, b: Rect) => Math.min(y1(a), y1(b)) - Math.max(a.y, b.y);

/** The rectangle spanning the space between two rects (for the region drawn on the canvas). */
export function gapRegion(a: Rect, b: Rect): Rect {
  let [gx0, gx1] = x1(a) <= b.x ? [x1(a), b.x] : [x1(b), a.x];
  let [gy0, gy1] = y1(a) <= b.y ? [y1(a), b.y] : [y1(b), a.y];
  if (gx0 > gx1) [gx0, gx1] = [gx1, gx0];
  if (gy0 > gy1) [gy0, gy1] = [gy1, gy0];
  if (hOverlap(a, b) > 0) [gx0, gx1] = [Math.max(a.x, b.x), Math.min(x1(a), x1(b))];
  if (vOverlap(a, b) > 0) [gy0, gy1] = [Math.max(a.y, b.y), Math.min(y1(a), y1(b))];
  return { x: gx0, y: gy0, w: Math.max(gx1, gx0 + 1) - gx0, h: Math.max(gy1, gy0 + 1) - gy0 };
}

const expand = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });
const r1 = (v: number) => Math.round(v * 10) / 10;
const f0 = (v: number) => `${Math.round(v)}`;

// --- thresholds (xds/audit/thresholds.py defaults, overridable by project.rules.set) ----------

interface T {
  u: number;
  crowdedGap: number;
  edgeKiss: number;
  alignNearMiss: [number, number];
  marginNearMiss: number;
  groupingRatio: number;
  spacingVariation: number;
  spacingTolerance: number;
  hierarchyRatio: number;
  sizeNearMiss: number;
  distinctSizes: number;
  widowRatio: number;
  positionNearMiss: [number, number];
  blocks: number;
  band: (level: string | undefined) => LiveBand | null;
}

function thresholds(g: LiveGuide, set: Record<string, number | number[]> = {}): T {
  const num = (k: string, d: number) => (typeof set[k] === "number" ? (set[k] as number) : d);
  const pair = (k: string, d: [number, number]): [number, number] =>
    Array.isArray(set[k]) && (set[k] as number[]).length === 2 ? [(set[k] as number[])[0], (set[k] as number[])[1]] : d;
  const u = num("unit", g.u);
  return {
    u,
    crowdedGap: num("crowdedGap", 0.5),
    edgeKiss: num("edgeKiss", u / 2),
    alignNearMiss: pair("alignNearMiss", [1, u / 2]),
    marginNearMiss: num("marginNearMiss", u / 2),
    groupingRatio: num("groupingRatio", 2 / 3),
    spacingVariation: num("spacingVariation", 0.2),
    spacingTolerance: num("spacingTolerance", 2),
    hierarchyRatio: num("hierarchyRatio", 1.25),
    sizeNearMiss: num("sizeNearMiss", 8),
    distinctSizes: num("distinctSizes", 4),
    widowRatio: num("widowRatio", 0.15),
    positionNearMiss: pair("positionNearMiss", [2, 5]),
    blocks: num("blocks", g.blocks ?? 7),
    band: (level) => {
      if (!level || !g.bands?.[level]) return null;
      const b = g.bands[level];
      const size = pair(`${level}.size`, [b.min, b.max]);
      const chars = Array.isArray(set[`${level}.chars`]) ? ((set[`${level}.chars`] as number[]).map((v) => v || null) as [number | null, number | null]) : b.chars;
      return { min: size[0], max: size[1], maxLines: num(`${level}.maxLines`, b.maxLines), chars };
    },
  };
}

// --- the slide as the rules see it ----------------------------------------------------------

interface Block {
  id: string;
  name: string;
  layer: LiveNode["layer"];
  rect: Rect;
  node: LiveNode;
}

class Live {
  readonly W: number;
  readonly H: number;
  readonly s: number;
  readonly content: { x0: number; x1: number; y0: number; y1: number };
  readonly text: LiveNode[];
  readonly reading: LiveNode[];
  readonly images: LiveNode[];
  readonly renders: LiveNode[];
  readonly blocks: Block[];

  constructor(
    readonly nodes: LiveNode[],
    readonly g: LiveGuide,
    readonly t: T,
  ) {
    this.W = g.width;
    this.H = g.height;
    this.s = Math.min(g.width, g.height);
    const m = g.margins;
    this.content = { x0: m.left, x1: g.width - m.right, y0: m.top, y1: g.height - m.bottom };
    this.text = nodes.filter((n) => n.layer === "type" && n.lines?.length);
    this.reading = this.text.filter((n) => !n.decorative && n.size && n.level);
    this.images = nodes.filter((n) => n.layer === "image");
    this.renders = nodes.filter((n) => n.layer === "render");
    this.blocks = [...this.text, ...this.images].map((n) => ({ id: n.id, name: this.name(n.id), layer: n.layer, rect: this.ink(n), node: n }));
  }

  name(id: string): string {
    const n = this.nodes.find((x) => x.id === id);
    return n?.name || id;
  }

  ink(n: LiveNode): Rect {
    return (n.lines?.length ? unionAll(n.lines) : null) ?? n.rect;
  }

  /** Blocks the spacing rules compare: everything but full-bleed images. */
  layoutBlocks(): Block[] {
    const canvas = this.W * this.H;
    return this.blocks.filter((b) => !(b.layer === "image" && area(b.rect) >= 0.95 * canvas));
  }

  /** Vertically adjacent pairs (top to bottom, overlapping horizontally) with their gap. */
  static stack(blocks: Block[]): [Block, Block, number][] {
    const out: [Block, Block, number][] = [];
    const ordered = [...blocks].sort((a, b) => a.rect.y - b.rect.y);
    ordered.forEach((a, i) => {
      const below = ordered.slice(i + 1).filter((b) => hOverlap(b.rect, a.rect) > 0 && b.rect.y >= y1(a.rect) - 0.5);
      if (!below.length) return;
      const b = below.reduce((p, q) => (q.rect.y < p.rect.y ? q : p));
      out.push([a, b, Math.max(0, b.rect.y - y1(a.rect))]);
    });
    return out;
  }

  /** Declared groups (two or more text members). */
  groups(): [string, Block[]][] {
    const by = new Map<string, Block[]>();
    for (const b of this.blocks) if (b.layer === "type" && b.node.group) by.set(b.node.group, [...(by.get(b.node.group) ?? []), b]);
    return [...by.entries()].filter(([, m]) => m.length >= 2);
  }

  /** The edits that move a node by (dx, dy) px: its stack gap on a stacked axis, else its box. */
  moveEdits(id: string, dx = 0, dy = 0): Edit[] {
    const n = this.nodes.find((x) => x.id === id);
    if (!n || n.layer === "render") return [];
    const out: Edit[] = [];
    const pct = (v: number, size: number) => Math.round((v / size) * 1000) / 10;
    for (const [axis, d, size] of [
      ["x", dx, this.W],
      ["y", dy, this.H],
    ] as const) {
      if (!d) continue;
      if (n.stack && n.stack.axis === axis) {
        const gap = n.stack.gap + (n.stack.dir * d) / this.t.u;
        out.push({ nodeId: id, path: n.stack.path, value: Math.round(gap * 4) / 4 });
      } else out.push({ nodeId: id, path: `box.${axis}`, value: pct(n.rect[axis] + d, size) });
    }
    return out;
  }

  moveFix(id: string, dx = 0, dy = 0): string {
    const edits = this.moveEdits(id, dx, dy);
    if (!edits.length) return "No move needed";
    return `Set '${this.name(id)}' ` + edits.map((e) => `${e.path} to ${e.value}${e.path.endsWith("gap") ? " (u)" : ""}`).join(" and ");
  }

  sizes(): [number, LiveNode[]][] {
    const out: [number, LiveNode[]][] = [];
    for (const n of [...this.reading].sort((a, b) => a.size! - b.size!)) {
      if (out.length && n.size! - out[out.length - 1][0] <= 0.5) out[out.length - 1][1].push(n);
      else out.push([n.size!, [n]]);
    }
    return out;
  }
}

type Hit = Pick<Finding, "nodes" | "region" | "message" | "fix" | "edits"> & { severity?: Severity };
type Rule = (s: Live) => Hit[];

const names = (s: Live, ns: LiveNode[]) => ns.map((n) => `'${s.name(n.id)}'`).join(", ");
const clearDy = (ink: Rect, obstacle: Rect, gap: number) => {
  const up = obstacle.y - gap - y1(ink);
  const down = y1(obstacle) + gap - ink.y;
  return Math.abs(up) <= Math.abs(down) ? up : down;
};

const RULES: Record<LiveRule, { severity: Severity; run: Rule }> = {
  TEXT_OVERLAP: {
    severity: "error",
    run: (s) => {
      const out: Hit[] = [];
      for (let i = 0; i < s.text.length; i++)
        for (let j = i + 1; j < s.text.length; j++) {
          const a = s.text[i];
          const b = s.text[j];
          const hits: Rect[] = [];
          for (const ra of a.lines!) for (const rb of b.lines!) {
            const h = intersect(ra, rb);
            if (h && area(h) >= 1) hits.push(h);
          }
          if (!hits.length) continue;
          const px = hits.reduce((acc, h) => acc + area(h), 0);
          const ia = s.ink(a);
          const ib = s.ink(b);
          const dy = clearDy(ib, ia, s.t.u);
          out.push({
            nodes: [a.id, b.id],
            region: unionAll(hits)!,
            message: `'${s.name(a.id)}' and '${s.name(b.id)}' overlap by ${f0(px)} px².`,
            fix: `${s.moveFix(b.id, 0, dy)} (clear of '${s.name(a.id)}' by ${s.t.u}px)`,
            edits: s.moveEdits(b.id, 0, dy),
          });
        }
      return out;
    },
  },
  TEXT_CROWDED: {
    severity: "warn",
    run: (s) => {
      const out: Hit[] = [];
      for (let i = 0; i < s.text.length; i++)
        for (let j = i + 1; j < s.text.length; j++) {
          const a = s.text[i];
          const b = s.text[j];
          let best: [number, Rect, Rect] | null = null;
          for (const ra of a.lines!) for (const rb of b.lines!) {
            const g = rectGap(ra, rb);
            if (!best || g < best[0]) best = [g, ra, rb];
          }
          if (!best || best[0] <= 0) continue;
          const [gap, ra, rb] = best;
          const sizes = [a, b].map((n) => n.size).filter((v): v is number => !!v);
          const need = sizes.length ? Math.max(s.t.u, s.t.crowdedGap * Math.min(...sizes)) : s.t.u;
          if (gap >= need) continue;
          const ia = s.ink(a);
          const ib = s.ink(b);
          const second = ia.y <= ib.y ? b : a;
          const dy = vOverlap(ib, ia) <= 0 ? need - gap : 0;
          const dx = dy ? 0 : need - gap;
          out.push({
            nodes: [a.id, b.id],
            region: gapRegion(ra, rb),
            message: `'${s.name(a.id)}' and '${s.name(b.id)}' are ${f0(gap)}px apart, which reads as touching.`,
            fix: `${s.moveFix(second.id, dx, dy)} (gap ≥ ${f0(need)}px), or group them tighter on purpose`,
            edits: s.moveEdits(second.id, dx, dy),
          });
        }
      return out;
    },
  },
  TEXT_CLIPPED: {
    severity: "error",
    run: (s) => {
      const out: Hit[] = [];
      for (const n of s.text) {
        const off = n.lines!.filter((r) => r.x < -0.5 || r.y < -0.5 || x1(r) > s.W + 0.5 || y1(r) > s.H + 0.5);
        if (!n.overflow && !off.length) continue;
        const need = n.contentHeight ? (100 * (n.contentHeight + 1)) / s.H : null;
        const boxH = (n.rect.h / s.H) * 100;
        const taller = need !== null && need > boxH + 0.05;
        const needTxt = taller ? Math.min(100, need!).toFixed(1) : "";
        let fix: string;
        let edits: Edit[] = [];
        if (off.length) fix = `Move the block inside the canvas${taller ? ` and set box.h to ${needTxt}` : ""}, or shorten the text`;
        else if (taller) {
          fix = `Set box.h to ${needTxt}, shorten the text, or lower data.size`;
          edits = [{ nodeId: n.id, path: "box.h", value: Math.round(Math.min(100, need!) * 10) / 10 }];
        } else fix = "Widen box.w (a word is wider than the box), or lower data.size";
        out.push({ nodes: [n.id], region: unionAll(off) ?? n.rect, message: `'${s.name(n.id)}' doesn't fit: its text is cut off.`, fix, edits });
      }
      return out;
    },
  },
  IN_SAFE_ZONE: {
    severity: "error",
    run: (s) => {
      const out: Hit[] = [];
      for (const z of s.g.safeZones ?? []) {
        const zone = { x: z.x, y: z.y, w: z.w, h: z.h };
        for (const n of s.text) {
          const hits = n.lines!.map((r) => intersect(r, zone)).filter((h): h is Rect => !!h);
          if (!hits.length) continue;
          const dy = clearDy(s.ink(n), zone, s.t.u);
          out.push({
            nodes: [n.id],
            region: unionAll(hits)!,
            message: `'${s.name(n.id)}' sits under the ${z.name} safe zone, which the app covers.`,
            fix: s.moveFix(n.id, 0, dy),
            edits: s.moveEdits(n.id, 0, dy),
          });
        }
      }
      return out;
    },
  },
  OUTSIDE_MARGIN: {
    severity: "warn",
    run: (s) => {
      const out: Hit[] = [];
      const c = s.content;
      const canvas = s.W * s.H;
      const zones = (s.g.safeZones ?? []).map((z) => ({ x: z.x, y: z.y, w: z.w, h: z.h }));
      for (const b of s.blocks) {
        if (zones.some((z) => intersect(b.rect, z))) continue;
        if (b.layer === "image" && area(b.rect) >= 0.95 * canvas) continue;
        const r = b.rect;
        const dx = Math.max(0, c.x0 - r.x) - Math.max(0, x1(r) - c.x1);
        const dy = Math.max(0, c.y0 - r.y) - Math.max(0, y1(r) - c.y1);
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
        out.push({
          nodes: [b.id],
          region: r,
          message: `'${b.name}' extends ${f0(Math.max(Math.abs(dx), Math.abs(dy)))}px past the margin.`,
          fix: `${s.moveFix(b.id, dx, dy)} (or narrow its box)`,
          edits: s.moveEdits(b.id, dx, dy),
        });
      }
      return out;
    },
  },
  EDGES_KISSING: {
    severity: "warn",
    run: (s) => {
      const out: Hit[] = [];
      const blocks = s.blocks;
      for (let i = 0; i < blocks.length; i++)
        for (let j = i + 1; j < blocks.length; j++) {
          const a = blocks[i];
          const b = blocks[j];
          if (a.layer === "type" && b.layer === "type") continue;
          if (intersect(a.rect, b.rect)) continue;
          const gap = rectGap(a.rect, b.rect);
          if (gap > s.t.edgeKiss) continue;
          const horizontal = vOverlap(a.rect, b.rect) > 0;
          const aFirst = horizontal ? a.rect.x <= b.rect.x : a.rect.y <= b.rect.y;
          const second = aFirst ? b : a;
          const push = s.t.u - gap;
          const dx = horizontal ? push : 0;
          const dy = horizontal ? 0 : push;
          out.push({
            nodes: [a.id, b.id],
            region: expand(gapRegion(a.rect, b.rect), 2),
            message: `'${a.name}' and '${b.name}' almost touch (${f0(gap)}px).`,
            fix: `${s.moveFix(second.id, dx, dy)} (≥ ${s.t.u}px apart), or overlap them deliberately`,
            edits: s.moveEdits(second.id, dx, dy),
          });
        }
      return out;
    },
  },
  ALIGN_NEAR_MISS: {
    severity: "warn",
    run: (s) => {
      const out: Hit[] = [];
      const [lo, hi] = s.t.alignNearMiss;
      const blocks = s.layoutBlocks();
      for (let i = 0; i < blocks.length; i++)
        for (let j = i + 1; j < blocks.length; j++) {
          const a = blocks[i];
          const b = blocks[j];
          const diffs: [string, number][] = [
            ["left", b.rect.x - a.rect.x],
            ["center", cx(b.rect) - cx(a.rect)],
            ["right", x1(b.rect) - x1(a.rect)],
          ];
          if (diffs.some(([, d]) => Math.abs(d) < lo)) continue;
          const near = diffs.filter(([, d]) => Math.abs(d) >= lo && Math.abs(d) <= hi);
          if (!near.length) continue;
          const [edge, d] = near.reduce((p, q) => (Math.abs(q[1]) < Math.abs(p[1]) ? q : p));
          out.push({
            nodes: [a.id, b.id],
            region: union(a.rect, b.rect),
            message: `The ${edge} edges of '${a.name}' and '${b.name}' miss alignment by ${r1(Math.abs(d))}px.`,
            fix: `${s.moveFix(b.id, -d, 0)} to align its ${edge} edge with '${a.name}'`,
            edits: s.moveEdits(b.id, -d, 0),
          });
        }
      return out;
    },
  },
  MARGIN_NEAR_MISS: {
    severity: "info",
    run: (s) => {
      const out: Hit[] = [];
      const c = s.content;
      for (const b of s.layoutBlocks()) {
        const r = b.rect;
        const checks: [string, number, "x" | "y"][] = [
          ["left", c.x0 - r.x, "x"],
          ["right", c.x1 - x1(r), "x"],
          ["top", c.y0 - r.y, "y"],
          ["bottom", c.y1 - y1(r), "y"],
        ];
        for (const [side, d, axis] of checks) {
          if (Math.abs(d) < 1 || Math.abs(d) > s.t.marginNearMiss) continue;
          out.push({
            nodes: [b.id],
            region: r,
            message: `The ${side} edge of '${b.name}' is ${r1(Math.abs(d))}px off the margin.`,
            fix: `${s.moveFix(b.id, axis === "x" ? d : 0, axis === "y" ? d : 0)} to sit on the margin`,
            edits: s.moveEdits(b.id, axis === "x" ? d : 0, axis === "y" ? d : 0),
          });
          break;
        }
      }
      return out;
    },
  },
  GROUPING_AMBIGUOUS: {
    severity: "warn",
    run: (s) => {
      const out: Hit[] = [];
      const blocks = s.layoutBlocks();
      for (const [label, members] of s.groups()) {
        const ids = new Set(members.map((m) => m.id));
        const inner = Math.max(...members.map((a) => Math.min(...members.filter((b) => b !== a).map((b) => rectGap(a.rect, b.rect)))));
        const outside = members.flatMap((a) => blocks.filter((o) => !ids.has(o.id)).map((o) => [rectGap(a.rect, o.rect), o] as const));
        if (!outside.length) continue;
        const [gapOut, o] = outside.reduce((p, q) => (q[0] < p[0] ? q : p));
        const limit = s.t.groupingRatio * gapOut;
        if (inner <= limit) continue;
        out.push({
          nodes: [...ids, o.id],
          region: unionAll(members.map((m) => m.rect))!,
          message: `Group ${label} has an inner gap of ${f0(inner)}px but sits only ${f0(gapOut)}px from '${o.name}', so it's unclear what belongs together.`,
          fix: `Tighten the gaps inside the group to ≤ ${f0(limit)}px, or move '${o.name}' to ≥ ${f0(inner / s.t.groupingRatio)}px away`,
        });
      }
      return out;
    },
  },
  SPACING_INCONSISTENT: {
    severity: "warn",
    run: (s) => {
      const out: Hit[] = [];
      for (const [label, members] of s.groups()) {
        const pairs = Live.stack(members);
        if (pairs.length < 2) continue;
        const gaps = pairs.map((p) => p[2]);
        const lo = Math.min(...gaps);
        const hi = Math.max(...gaps);
        if (hi <= 0 || (hi - lo) / hi <= s.t.spacingVariation) continue;
        const target = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length / s.t.u) * s.t.u || s.t.u;
        const [, b, gap] = pairs.reduce((p, q) => (Math.abs(q[2] - target) > Math.abs(p[2] - target) ? q : p));
        out.push({
          nodes: members.map((m) => m.id),
          region: unionAll(members.map((m) => m.rect))!,
          message: `Gaps in group ${label} vary from ${f0(lo)} to ${f0(hi)}px.`,
          fix: `Use one gap (${target}px) between all blocks; e.g. ${s.moveFix(b.id, 0, target - gap)}`,
          edits: s.moveEdits(b.id, 0, target - gap),
        });
      }
      return out;
    },
  },
  SPACING_OFF_SCALE: {
    severity: "info",
    run: (s) => {
      const out: Hit[] = [];
      const scale = s.g.spacingScale?.length ? s.g.spacingScale : [s.t.u, 2, 3, 4, 6, 8, 12, 16].map((k, i) => (i ? k * s.t.u : k));
      const largest = scale[scale.length - 1];
      for (const [a, b, gap] of Live.stack(s.layoutBlocks())) {
        if (gap <= 0 || gap > largest) continue;
        const nearest = Math.max(s.t.u, Math.round(gap / s.t.u) * s.t.u);
        if (Math.abs(gap - nearest) <= s.t.spacingTolerance) continue;
        out.push({
          nodes: [a.id, b.id],
          region: gapRegion(a.rect, b.rect),
          message: `The ${f0(gap)}px gap between '${a.name}' and '${b.name}' is off the ${s.t.u}px scale.`,
          fix: `${s.moveFix(b.id, 0, nearest - gap)} (gap ${nearest}px)`,
          edits: s.moveEdits(b.id, 0, nearest - gap),
        });
      }
      return out;
    },
  },
  POSITION_NEAR_MISS: {
    severity: "info",
    run: (s) => {
      const out: Hit[] = [];
      const [lo, hi] = s.t.positionNearMiss.map((v) => (v * s.s) / 100);
      const linesX: [string, number][] = [
        ["center", s.W / 2],
        ["left third", s.W / 3],
        ["right third", (2 * s.W) / 3],
      ];
      const linesY: [string, number][] = [
        ["center", s.H / 2],
        ["upper third", s.H / 3],
        ["lower third", (2 * s.H) / 3],
      ];
      for (const b of s.blocks) {
        const axes: ["x" | "y", number, [string, number][]][] = [];
        if (b.layer === "image" || b.node.align === "center") axes.push(["x", cx(b.rect), linesX]);
        if (b.layer === "image") axes.push(["y", cy(b.rect), linesY]);
        for (const [axis, c, lines] of axes) {
          const [name, d] = lines.map(([k, v]) => [k, v - c] as [string, number]).reduce((p, q) => (Math.abs(q[1]) < Math.abs(p[1]) ? q : p));
          if (Math.abs(d) < lo || Math.abs(d) > hi) continue;
          const dx = axis === "x" ? d : 0;
          const dy = axis === "y" ? d : 0;
          out.push({
            nodes: [b.id],
            region: b.rect,
            message: `'${b.name}' is ${f0(Math.abs(d))}px off the ${name}: close, but not on it.`,
            fix: `${s.moveFix(b.id, dx, dy)} to sit on the ${name}`,
            edits: s.moveEdits(b.id, dx, dy),
          });
          break;
        }
      }
      return out;
    },
  },
  TOO_MANY_ELEMENTS: {
    severity: "warn",
    run: (s) => {
      const count = s.text.length + s.images.length + s.renders.length;
      if (count <= s.t.blocks) return [];
      return [
        {
          nodes: s.nodes.filter((n) => n.layer !== "ground").map((n) => n.id),
          message: `The slide has ${count} visible blocks.`,
          fix: `Remove or merge ${count - s.t.blocks} blocks (set hidden, or combine text into one node)`,
        },
      ];
    },
  },
  TEXT_TOO_SMALL: {
    severity: "error",
    run: (s) => {
      const out: Hit[] = [];
      for (const n of s.reading) {
        const band = s.t.band(n.level);
        if (!band || n.size! >= band.min - 0.5) continue;
        const k = s.g.k ?? 1;
        out.push({
          nodes: [n.id],
          region: s.ink(n),
          message: `'${s.name(n.id)}' is ${f0(n.size!)}px (${r1(n.size! * k)}px on the device), below the ${n.level} minimum of ${f0(band.min)}px.`,
          fix: `Set data.size to ${f0(band.min)} (${n.level} min)`,
          edits: [{ nodeId: n.id, path: "data.size", value: Math.round(band.min) }],
        });
      }
      return out;
    },
  },
  TEXT_TOO_LARGE: {
    severity: "warn",
    run: (s) => {
      const out: Hit[] = [];
      for (const n of s.reading) {
        const band = s.t.band(n.level);
        if (!band || n.size! <= band.max + 0.5) continue;
        const higher = LEVELS.filter((lv) => LEVEL_RANK[lv] < (LEVEL_RANK[n.level!] ?? 9));
        const alt = higher.length ? `, or use a ${higher[higher.length - 1]} role in data.role` : "";
        out.push({
          nodes: [n.id],
          region: s.ink(n),
          message: `'${s.name(n.id)}' is ${f0(n.size!)}px, above the ${n.level} maximum of ${f0(band.max)}px.`,
          fix: `Set data.size to ${f0(band.max)} (${n.level} max)${alt}`,
          edits: [{ nodeId: n.id, path: "data.size", value: Math.round(band.max) }],
        });
      }
      return out;
    },
  },
  HIERARCHY_WEAK: {
    severity: "warn",
    run: (s) => {
      const out: Hit[] = [];
      const sizes = s.sizes();
      for (let i = 0; i + 1 < sizes.length; i++) {
        const [small, sn] = sizes[i];
        const [big, bn] = sizes[i + 1];
        const ratio = big / small;
        if (ratio < 1 + s.t.sizeNearMiss / 100 || ratio >= s.t.hierarchyRatio) continue;
        const up = small * s.t.hierarchyRatio;
        const band = s.t.band(bn[0].level);
        let fix: string;
        let edits: Edit[];
        if (band && up <= band.max) {
          fix = `Set data.size of ${names(s, bn)} to ${f0(up)}`;
          edits = bn.map((n) => ({ nodeId: n.id, path: "data.size", value: Math.round(up) }));
        } else {
          const down = big / s.t.hierarchyRatio;
          fix = `Set data.size of ${names(s, sn)} to ${f0(down)}`;
          edits = sn.map((n) => ({ nodeId: n.id, path: "data.size", value: Math.round(down) }));
        }
        out.push({
          nodes: [...sn, ...bn].map((n) => n.id),
          region: unionAll([...sn, ...bn].map((n) => s.ink(n))) ?? undefined,
          message: `${names(s, bn)} (${f0(big)}px) and ${names(s, sn)} (${f0(small)}px) differ by only ×${ratio.toFixed(2)}.`,
          fix: `${fix} (ratio ≥ ${s.t.hierarchyRatio})`,
          edits,
        });
      }
      return out;
    },
  },
  SIZE_NEAR_MISS: {
    severity: "warn",
    run: (s) => {
      const out: Hit[] = [];
      const sizes = s.sizes();
      for (let i = 0; i + 1 < sizes.length; i++) {
        const [small, sn] = sizes[i];
        const [big, bn] = sizes[i + 1];
        const pct = (100 * (big - small)) / small;
        if (pct >= s.t.sizeNearMiss) continue;
        const [keep, change] = bn.length >= sn.length ? [bn, sn] : [sn, bn];
        out.push({
          nodes: [...sn, ...bn].map((n) => n.id),
          region: unionAll([...sn, ...bn].map((n) => s.ink(n))) ?? undefined,
          message: `${names(s, sn)} (${r1(small)}px) and ${names(s, bn)} (${r1(big)}px) are nearly the same size.`,
          fix: `Set data.size of ${names(s, change)} to ${f0(keep[0].size!)} to match`,
          edits: change.map((n) => ({ nodeId: n.id, path: "data.size", value: Math.round(keep[0].size!) })),
        });
      }
      return out;
    },
  },
  TOO_MANY_SIZES: {
    severity: "warn",
    run: (s) => {
      const sizes = s.sizes();
      if (sizes.length <= s.t.distinctSizes) return [];
      return [
        {
          nodes: sizes.flatMap(([, ns]) => ns.map((n) => n.id)),
          message: `The slide uses ${sizes.length} text sizes: ${sizes.map(([v]) => f0(v)).join(", ")}px.`,
          fix: `Remove data.size overrides so blocks follow their role sizes (≤ ${s.t.distinctSizes} sizes)`,
        },
      ];
    },
  },
  TOO_MANY_LINES: {
    severity: "warn",
    run: (s) => {
      const out: Hit[] = [];
      for (const n of s.reading) {
        const band = s.t.band(n.level);
        if (!band || n.lines!.length <= band.maxLines) continue;
        out.push({
          nodes: [n.id],
          region: s.ink(n),
          message: `'${s.name(n.id)}' runs to ${n.lines!.length} lines; ${n.level} allows ${band.maxLines}.`,
          fix: `Shorten data.text to ≤ ${band.maxLines} lines, widen box.w, or use a lower-level data.role`,
        });
      }
      return out;
    },
  },
  WIDOW: {
    severity: "warn",
    run: (s) => {
      const out: Hit[] = [];
      for (const n of s.reading) {
        const lines = n.lines!;
        const texts = n.lineTexts ?? [];
        if (lines.length < 2 || n.level === "expressive" || texts.length !== lines.length) continue;
        const last = lines[lines.length - 1];
        const longest = Math.max(...lines.map((l) => l.w));
        const words = texts[texts.length - 1].trim().split(/\s+/).filter(Boolean);
        const ratio = longest ? last.w / longest : 1;
        if (words.length > 1 && ratio >= s.t.widowRatio) continue;
        if (n.forcedLastLine) continue;
        const prev = texts[texts.length - 2].trim().split(/\s+/).filter(Boolean);
        const hint = prev.length ? `before '${prev[prev.length - 1]}'` : "earlier";
        out.push({
          nodes: [n.id],
          region: last,
          message: `'${s.name(n.id)}' ends with a widow: '${texts[texts.length - 1].trim()}' alone on the last line.`,
          fix: `Break the line ${hint} with "\\n", set data.wrap to "pretty", or widen box.w`,
        });
      }
      return out;
    },
  },
  LINE_LENGTH: {
    severity: "warn",
    run: (s) => {
      const out: Hit[] = [];
      for (const n of s.reading) {
        const band = s.t.band(n.level);
        if (!band || n.level === "expressive" || !n.lineTexts?.length) continue;
        const [lo, hi] = band.chars;
        const counts = n.lineTexts.map((t) => t.trim().length);
        const long = counts.filter((c) => hi && c > hi);
        const short = counts.slice(0, -1).filter((c) => lo && c < lo);
        if (!long.length && !short.length) continue;
        const [worst, target] = long.length ? [Math.max(...long), hi!] : [Math.min(...short), lo!];
        const boxW = (n.rect.w / s.W) * 100;
        out.push({
          nodes: [n.id],
          region: s.ink(n),
          message: `'${s.name(n.id)}' has lines of ${worst} characters; ${n.level} reads best at ${lo ?? 0}–${hi ?? "∞"}.`,
          fix: `Set box.w to ${((boxW * target) / Math.max(worst, 1)).toFixed(1)} (≈ ${target} chars per line)`,
        });
      }
      return out;
    },
  },
};

/** Run the live rules on one slide. */
export function liveFindings(nodes: LiveNode[], guide: LiveGuide, opts: LiveOptions = {}): LiveFinding[] {
  const visible = nodes.filter((n) => !("hidden" in n && (n as { hidden?: boolean }).hidden));
  const s = new Live(visible, guide, thresholds(guide, opts.set));
  const off = new Set(opts.off ?? []);
  const slideWaived = new Set(opts.slideWaived ?? []);
  const out: LiveFinding[] = [];
  for (const rule of LIVE_RULES) {
    if (off.has(rule) || slideWaived.has(rule)) continue;
    const spec = RULES[rule];
    for (const hit of spec.run(s)) {
      const ids = hit.nodes ?? [];
      if (ids.some((id) => visible.find((n) => n.id === id)?.waived?.includes(rule))) continue;
      const f: LiveFinding = {
        rule,
        family: FAMILY[rule],
        severity: hit.severity ?? spec.severity,
        status: "open",
        message: hit.message,
        nodes: ids,
        fix: hit.fix ?? "",
        principle: PRINCIPLE[rule],
      };
      if (opts.slideId) f.slideId = opts.slideId;
      if (hit.region) f.region = { x: r1(hit.region.x), y: r1(hit.region.y), w: r1(hit.region.w), h: r1(hit.region.h) };
      if (hit.edits?.length) f.edits = hit.edits.map((e) => (opts.slideId && !e.slideId ? { ...e, slideId: opts.slideId } : e));
      out.push(f);
    }
  }
  return out;
}
