/**
 * Stacked text (`data.stack`): a block placed a set gap below or above another block, measured
 * ink to ink, so its y follows wherever the text above it ends (data-models §2.6).
 *
 * The browser measures each block's ink relative to its own box top. That offset doesn't change
 * when the block moves, so one pass in dependency order resolves every top. A block whose anchor
 * is missing (or hidden), or that is part of a cycle, keeps its own `box.y`.
 */

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

/** Resolve the tops of every stacked item whose anchor is present. */
export function resolveStacks(items: StackItem[], u: number): Map<string, StackPlacement> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out = new Map<string, StackPlacement>();
  const tops = new Map<string, number>();
  const visiting = new Set<string>();

  const topOf = (item: StackItem): number => {
    const known = tops.get(item.id);
    if (known !== undefined) return known;
    const anchorId = stackAnchor(item.stack);
    const anchor = anchorId ? byId.get(anchorId) : undefined;
    if (!anchor || anchor === item || visiting.has(item.id)) {
      tops.set(item.id, item.top);
      return item.top;
    }
    visiting.add(item.id);
    const anchorTop = topOf(anchor);
    visiting.delete(item.id);
    if (tops.has(item.id)) return tops.get(item.id)!; // resolved as part of a cycle
    const dir: 1 | -1 = item.stack?.below ? 1 : -1;
    const base = dir === 1 ? anchorTop + anchor.inkBottom - item.inkTop : anchorTop + anchor.inkTop - item.inkBottom;
    const top = base + dir * (item.stack?.gap ?? 0) * u;
    tops.set(item.id, top);
    out.set(item.id, { top, base, dir, anchor: anchor.id });
    return top;
  };

  for (const item of items) topOf(item);
  return out;
}

/** The gap (in u) that puts a stacked block's top at `top`. */
export function gapForTop(p: Pick<StackPlacement, "base" | "dir">, top: number, u: number, round = 0): number {
  const gap = (p.dir * (top - p.base)) / (u || 1);
  return round > 0 ? Math.round(gap / round) * round : Math.round(gap * 100) / 100;
}
