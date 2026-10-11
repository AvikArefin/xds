/**
 * Stacked text (`data.stack`): a block placed a set gap below or above another block, measured
 * ink to ink, so its y follows wherever the text above it ends (data-models §2.6).
 *
 * The browser measures each block's ink relative to its own box top. That offset doesn't change
 * when the block moves, so one pass in dependency order resolves every top. A block whose anchor
 * is missing (or hidden), or that is part of a cycle, keeps its own `box.y`.
 */

import { fallbackGuide, resolveLayout } from "./layout";

export interface StackSpec {
  below?: string | null;
  above?: string | null;
  gap?: number | null;
}

export interface StackItem {
  id: string;
  /** The block's own box top, canvas px. */
  top: number;
  /** Ink extent relative to the box top, px (an image's box: 0 and its height). */
  inkTop: number;
  inkBottom: number;
  stack?: StackSpec | null;
}

export interface StackPlacement {
  /** The resolved box top, canvas px. */
  top: number;
  /** The top at gap 0: `top = base + dir · gap · u`. */
  base: number;
  /** +1 below the anchor, −1 above it. */
  dir: 1 | -1;
  anchor: string;
}

export function stackAnchor(s: StackSpec | null | undefined): string | null {
  return s?.below || s?.above || null;
}

/** Resolve the tops of every stacked item whose anchor is present (the vertical case of `resolveLayout`). */
export function resolveStacks(items: StackItem[], u: number): Map<string, StackPlacement> {
  const laid = resolveLayout(
    items.map((i) => ({
      id: i.id,
      rect: { x: 0, y: i.top, w: 1, h: Math.max(1, i.inkBottom) },
      ink: { top: i.inkTop, bottom: i.inkBottom },
      layout: i.stack
        ? { stack: { below: i.stack.below ?? undefined, above: i.stack.above ?? undefined, gap: i.stack.gap ?? 0 } }
        : null,
    })),
    { ...fallbackGuide(1000, 1000), u },
  );
  const out = new Map<string, StackPlacement>();
  for (const [id, p] of laid) {
    if (p.stack?.axis === "y") out.set(id, { top: p.rect.y, base: p.stack.base, dir: p.stack.dir, anchor: p.stack.anchor });
  }
  return out;
}

/** The gap (in u) that puts a stacked block's top at `top`. */
export function gapForTop(p: Pick<StackPlacement, "base" | "dir">, top: number, u: number, round = 0): number {
  const gap = (p.dir * (top - p.base)) / (u || 1);
  return round > 0 ? Math.round(gap / round) * round : Math.round(gap * 100) / 100;
}
