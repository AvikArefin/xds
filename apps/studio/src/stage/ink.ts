/**
 * Text ink geometry from the laid-out DOM: line boxes from Range.getClientRects merged per visual
 * line, with each line's ink extent from canvas text metrics. measure() (the audit's geometry) and
 * the type layer's stacking both use it, so a stack gap is the gap the audit measures.
 *
 * Coordinates are canvas px relative to `origin`. `scale` is how much CSS transforms enlarge the
 * stage on screen (the editor zooms it); client rects are divided by it, font metrics are not.
 */
import type { MeasuredLine, Rect } from "@xds/protocol";

const r2 = (v: number) => Math.round(v * 100) / 100;
export const rect = (x: number, y: number, w: number, h: number): Rect => ({ x: r2(x), y: r2(y), w: r2(w), h: r2(h) });

let ctx2d: CanvasRenderingContext2D | null = null;
function textMetrics(font: string, letterSpacingPx: number, text: string): TextMetrics {
  ctx2d ??= document.createElement("canvas").getContext("2d")!;
  ctx2d.font = font;
  (ctx2d as unknown as { letterSpacing: string }).letterSpacing = `${letterSpacingPx}px`;
  return ctx2d.measureText(text);
}

export function measureLines(textEl: HTMLElement, origin: { left: number; top: number }, scale = 1): MeasuredLine[] {
  const cs = getComputedStyle(textEl);
  const uppercase = cs.textTransform === "uppercase";
  const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const ls = cs.letterSpacing === "normal" ? 0 : parseFloat(cs.letterSpacing) || 0;
  const fm = textMetrics(font, 0, "Hg");
  const k = scale || 1;

  type Acc = { text: string; x0: number; x1: number; top: number; bottom: number };
  const lines: Acc[] = [];
  const walker = document.createTreeWalker(textEl, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const s = node.data;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === "\n") {
        lines.push({ text: "", x0: Infinity, x1: -Infinity, top: NaN, bottom: NaN }); // force a break
        continue;
      }
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const rects = Array.from(range.getClientRects()).filter((r) => r.height > 0);
      if (!rects.length) continue;
      const c = rects[rects.length - 1];
      const r = {
        left: (c.left - origin.left) / k,
        right: (c.right - origin.left) / k,
        top: (c.top - origin.top) / k,
        bottom: (c.bottom - origin.top) / k,
      };
      let line = lines[lines.length - 1];
      const mid = (r.top + r.bottom) / 2;
      if (!line || (!Number.isNaN(line.top) && (mid > line.bottom || mid < line.top))) {
        line = { text: "", x0: Infinity, x1: -Infinity, top: NaN, bottom: NaN };
        lines.push(line);
      }
      if (Number.isNaN(line.top)) {
        line.top = r.top;
        line.bottom = r.bottom;
      }
      line.text += ch;
      if (ch.trim()) {
        line.x0 = Math.min(line.x0, r.left);
        line.x1 = Math.max(line.x1, r.right);
      }
      line.top = Math.min(line.top, r.top);
      line.bottom = Math.max(line.bottom, r.bottom);
    }
  }
  const out: MeasuredLine[] = [];
  for (const l of lines) {
    const text = l.text.trim();
    if (!text || !Number.isFinite(l.x0)) continue;
    const baseline = l.bottom - fm.fontBoundingBoxDescent;
    const ink = textMetrics(font, ls, uppercase ? text.toUpperCase() : text);
    const asc = Math.max(0, ink.actualBoundingBoxAscent);
    const desc = Math.max(0, ink.actualBoundingBoxDescent);
    // trailing letter-spacing after the last glyph is not ink
    const x1 = l.x1 - ls;
    out.push({ text, rect: rect(l.x0, baseline - asc, Math.max(0, x1 - l.x0), asc + desc), baseline: r2(baseline) });
  }
  return out;
}

/** A text block's ink extent relative to its box top (the element carrying `data-node-id`), px. */
export function inkExtent(el: HTMLElement, scale = 1): { top: number; bottom: number } | null {
  const textEl = (el.querySelector("[data-xds-text]") as HTMLElement) ?? el;
  const lines = measureLines(textEl, el.getBoundingClientRect(), scale);
  if (!lines.length) return null;
  return {
    top: Math.min(...lines.map((l) => l.rect.y)),
    bottom: Math.max(...lines.map((l) => l.rect.y + l.rect.h)),
  };
}
