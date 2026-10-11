/**
 * Gap readouts while dragging (human-interaction §3): the gap from the moving block to its
 * nearest neighbor above, below, left and right, drawn as a thin measurement line with the
 * value in u, and marked "=" on both sides when the block sits at the same gap from two
 * neighbors. Canvas-only; nothing here is saved.
 */
import { neighbors, type Neighbor, type PxRect } from "@xds/editor-core";

const TICK = 6;

function label(gap: number, u: number): string {
  const v = gap / u;
  const r = Math.round(v * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1)}u`;
}

export function GapReadouts({ rect, others, u, W, H, zoom }: { rect: PxRect; others: PxRect[]; u: number; W: number; H: number; zoom: number }) {
  const y = neighbors(rect, others, "y");
  const x = neighbors(rect, others, "x");
  const items: { n: Neighbor; axis: "x" | "y"; equal: boolean }[] = [];
  const eq = (a: Neighbor | null, b: Neighbor | null) => !!a && !!b && Math.abs(a.gap - b.gap) < 0.5;
  for (const n of [y.before, y.after]) if (n && n.gap > 0) items.push({ n, axis: "y", equal: eq(y.before, y.after) });
  for (const n of [x.before, x.after]) if (n && n.gap > 0) items.push({ n, axis: "x", equal: eq(x.before, x.after) });
  if (!items.length) return null;
  const fs = 11 / zoom;
  return (
    <svg className="overlay readouts" viewBox={`0 0 ${W} ${H}`} width={W * zoom} height={H * zoom} preserveAspectRatio="none" aria-hidden>
      {items.map(({ n, axis, equal }, i) => {
        if (axis === "y") {
          // a vertical measure line in the horizontal overlap of the two blocks
          const x0 = Math.max(rect.x, n.rect.x);
          const x1 = Math.min(rect.x + rect.w, n.rect.x + n.rect.w);
          const cx = (x0 + x1) / 2;
          const from = n.side === "before" ? n.edge : rect.y + rect.h;
          const to = from + n.gap;
          return (
            <g key={i} className={equal ? "equal" : undefined}>
              <line x1={cx} y1={from} x2={cx} y2={to} />
              <line className="tick" x1={cx - TICK / zoom} y1={from} x2={cx + TICK / zoom} y2={from} />
              <line className="tick" x1={cx - TICK / zoom} y1={to} x2={cx + TICK / zoom} y2={to} />
              <text x={cx + 14 / zoom} y={(from + to) / 2} fontSize={fs}>
                {equal ? "= " : ""}
                {label(n.gap, u)}
              </text>
            </g>
          );
        }
        const y0 = Math.max(rect.y, n.rect.y);
        const y1 = Math.min(rect.y + rect.h, n.rect.y + n.rect.h);
        const cy = (y0 + y1) / 2;
        const from = n.side === "before" ? n.edge : rect.x + rect.w;
        const to = from + n.gap;
        return (
          <g key={i} className={equal ? "equal" : undefined}>
            <line x1={from} y1={cy} x2={to} y2={cy} />
            <line className="tick" x1={from} y1={cy - TICK / zoom} x2={from} y2={cy + TICK / zoom} />
            <line className="tick" x1={to} y1={cy - TICK / zoom} x2={to} y2={cy + TICK / zoom} />
            <text x={(from + to) / 2} y={cy - 10 / zoom} fontSize={fs}>
              {equal ? "= " : ""}
              {label(n.gap, u)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
