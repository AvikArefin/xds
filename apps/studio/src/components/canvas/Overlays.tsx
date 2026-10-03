/** Non-interactive overlays drawn over the canvas: guides, snap lines, audit regions. */
import type { Finding } from "@xds/protocol";
import type { SnapLine } from "@xds/editor-core";
import type { Guide } from "../../types";

/** The margin, hatched safe zones, the u grid and the third lines (canvas px viewBox). */
export function GuidesOverlay({ guide, W, H, zoom }: { guide: Guide; W: number; H: number; zoom: number }) {
  const m = guide.margins;
  const u = guide.u;
  const showGrid = u * zoom >= 5;
  const grid: JSX.Element[] = [];
  if (showGrid) {
    for (let x = u; x < W; x += u) grid.push(<line key={`gx${x}`} x1={x} x2={x} y1={0} y2={H} />);
    for (let y = u; y < H; y += u) grid.push(<line key={`gy${y}`} x1={0} x2={W} y1={y} y2={y} />);
  }
  return (
    <svg className="overlay guides" viewBox={`0 0 ${W} ${H}`} width={W * zoom} height={H * zoom} preserveAspectRatio="none">
      <defs>
        <pattern id="xds-hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="12" className="hatch-line" />
        </pattern>
      </defs>
      {showGrid && <g className="grid">{grid}</g>}
      <g className="thirds">
        <line x1={W / 3} x2={W / 3} y1={0} y2={H} />
        <line x1={(2 * W) / 3} x2={(2 * W) / 3} y1={0} y2={H} />
        <line x1={0} x2={W} y1={H / 3} y2={H / 3} />
        <line x1={0} x2={W} y1={(2 * H) / 3} y2={(2 * H) / 3} />
      </g>
      {guide.safe_zones.map((z, i) => (
        <g key={i} className="safe-zone">
          <rect x={z.x} y={z.y} width={z.w} height={z.h} fill="url(#xds-hatch)" />
          <rect x={z.x} y={z.y} width={z.w} height={z.h} className="safe-outline" />
          <text x={z.x + 8 / zoom} y={z.y + 16 / zoom} style={{ fontSize: 11 / zoom }}>
            {z.name}
          </text>
        </g>
      ))}
      <rect className="margin" x={m.left} y={m.top} width={W - m.left - m.right} height={H - m.top - m.bottom} />
    </svg>
  );
}

export function SnapLinesOverlay({ lines, W, H, zoom }: { lines: SnapLine[]; W: number; H: number; zoom: number }) {
  if (!lines.length) return null;
  return (
    <svg className="overlay snaps" viewBox={`0 0 ${W} ${H}`} width={W * zoom} height={H * zoom} preserveAspectRatio="none">
      {lines.map((l, i) =>
        l.axis === "x" ? (
          <line key={i} x1={l.value} x2={l.value} y1={0} y2={H} className={`snap-${l.kind}`} />
        ) : (
          <line key={i} x1={0} x2={W} y1={l.value} y2={l.value} className={`snap-${l.kind}`} />
        ),
      )}
    </svg>
  );
}

export function AuditOverlay({
  findings,
  W,
  H,
  zoom,
  hover,
  highlight,
}: {
  findings: Finding[];
  W: number;
  H: number;
  zoom: number;
  hover: Finding | null;
  highlight: Finding | null;
}) {
  const withRegion = findings.filter((f) => f.region);
  if (!withRegion.length) return null;
  return (
    <>
      <svg className="overlay audit" viewBox={`0 0 ${W} ${H}`} width={W * zoom} height={H * zoom} preserveAspectRatio="none">
        {withRegion.map((f, i) => {
          const r = f.region!;
          const on = f === hover || f === highlight;
          return (
            <g key={i} className={`audit-region sev-${f.severity}${on ? " on" : ""}`}>
              <rect x={r.x} y={r.y} width={Math.max(r.w, 1)} height={Math.max(r.h, 1)} />
              <text x={r.x + 3 / zoom} y={r.y - 4 / zoom} style={{ fontSize: 10 / zoom }}>
                {i + 1}
              </text>
            </g>
          );
        })}
      </svg>
      {hover?.region && (
        <div
          className={`audit-tip sev-${hover.severity}`}
          style={{
            left: Math.min(hover.region.x * zoom, W * zoom - 260),
            top: (hover.region.y + hover.region.h) * zoom + 6,
          }}
        >
          <div className="audit-tip-rule">{hover.rule}</div>
          <div>{hover.message}</div>
          {hover.fix && <div className="audit-tip-fix">Fix: {hover.fix}</div>}
        </div>
      )}
    </>
  );
}

/** The smallest finding region containing a canvas px point. */
export function findingAt(findings: Finding[], x: number, y: number): Finding | null {
  let best: Finding | null = null;
  let area = Infinity;
  for (const f of findings) {
    const r = f.region;
    if (!r) continue;
    const pad = 4;
    if (x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad && r.w * r.h < area) {
      best = f;
      area = r.w * r.h;
    }
  }
  return best;
}
