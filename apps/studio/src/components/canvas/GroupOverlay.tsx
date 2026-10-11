/**
 * The flow group a selected member belongs to, drawn as a dashed box over the canvas (editor
 * only), from the store's `layout` placements (what the stage resolved).
 */
import { useStudio } from "../../store";

export function GroupOverlay({ ids, W, H, zoom }: { ids: string[]; W: number; H: number; zoom: number }) {
  const layout = useStudio((s) => s.layout);
  const seen = new Set<string>();
  const els: JSX.Element[] = [];
  for (const id of ids) {
    const g = layout[id]?.group;
    if (!g || seen.has(g.name)) continue;
    seen.add(g.name);
    els.push(<rect key={g.name} className="rel-group" x={g.box.x} y={g.box.y} width={g.box.w} height={g.box.h} />);
    els.push(
      <text key={`${g.name}-t`} className="rel-label" x={g.box.x} y={g.box.y - 4 / zoom} style={{ fontSize: 11 / zoom }}>
        {g.name} · {g.axis === "x" ? "row" : "column"}
      </text>,
    );
  }
  if (!els.length) return null;
  return (
    <svg className="overlay relations" viewBox={`0 0 ${W} ${H}`} width={W * zoom} height={H * zoom} preserveAspectRatio="none">
      {els}
    </svg>
  );
}
