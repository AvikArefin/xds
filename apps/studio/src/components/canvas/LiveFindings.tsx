/**
 * The live rules' findings on the canvas (design-rules §2.1): a thin dashed outline in the
 * severity color around each finding's region, drawn under the audit's own regions and only
 * while the audit overlay toggle is on. Hovering and clicking are the audit overlay's and the
 * panel's; this layer is a glance, not a control.
 */
import type { Finding } from "@xds/protocol";

export function LiveFindings({ findings, W, H, zoom }: { findings: Finding[]; W: number; H: number; zoom: number }) {
  const regions = findings.filter((f) => f.region);
  if (!regions.length) return null;
  return (
    <svg className="overlay live" viewBox={`0 0 ${W} ${H}`} width={W * zoom} height={H * zoom} preserveAspectRatio="none" aria-hidden>
      {regions.map((f, i) => {
        const r = f.region!;
        return <rect key={`${f.rule}-${i}`} className={`sev-${f.severity}`} x={r.x} y={r.y} width={Math.max(1, r.w)} height={Math.max(1, r.h)} />;
      })}
    </svg>
  );
}
