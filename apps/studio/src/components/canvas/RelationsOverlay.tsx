/**
 * The selected nodes' layout relations, drawn over the canvas (editor only): a pin as a tick on
 * the format line it pins to, an align as a dotted line to the anchor's edge, a stack as an arrow
 * to its anchor with the gap in u. Read from the store's `layout` placements (what the stage
 * resolved), so they show exactly what holds the box.
 */
import type { Node } from "@xds/protocol";
import { stackOf, type AlignTo } from "@xds/protocol";
import { pinnedEdgeValue, type Edge, type LayoutPlacement } from "@xds/editor-core";
import { boxPx, slideNodes, useActiveSlide, useStudio } from "../../store";

type BoxNode = Exclude<Node, { layer: "render" }>;
const TICK = 10;

function edgeOf(r: { x: number; y: number; w: number; h: number }, edge: AlignTo["edge"]): number {
  switch (edge) {
    case "left":
      return r.x;
    case "center":
      return r.x + r.w / 2;
    case "right":
      return r.x + r.w;
    case "top":
      return r.y;
    case "middle":
      return r.y + r.h / 2;
    case "bottom":
      return r.y + r.h;
  }
}

export function RelationsOverlay({ ids, W, H, zoom }: { ids: string[]; W: number; H: number; zoom: number }) {
  const slide = useActiveSlide();
  const layout = useStudio((s) => s.layout);
  const guide = useStudio((s) => s.guide);
  const u = guide?.u ?? 8;
  const project = useStudio((s) => s.project);
  const nodes = slideNodes(project, slide).filter((n): n is BoxNode => n.layer !== "render");
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const els: JSX.Element[] = [];
  const t = TICK / zoom;
  const font = 11 / zoom;

  for (const id of ids) {
    const n = byId.get(id);
    const p: LayoutPlacement | undefined = layout[id];
    if (!n || !p) continue;
    const r = boxPx(n.box, W, H);

    for (const [edge, line] of Object.entries(p.pins ?? {}) as [Edge, number][]) {
      const vertical = edge === "left" || edge === "right" || edge === "cx";
      const at = pinnedEdgeValue(r, edge);
      // the tick sits on the format line, across the node's extent on the other axis
      if (vertical) {
        const y0 = r.y;
        const y1 = r.y + r.h;
        els.push(<line key={`pin-${id}-${edge}`} className="rel-pin" x1={line} x2={line} y1={y0 - t} y2={y1 + t} />);
        if (Math.abs(at - line) > 0.5) els.push(<line key={`pin-off-${id}-${edge}`} className="rel-offset" x1={line} x2={at} y1={(y0 + y1) / 2} y2={(y0 + y1) / 2} />);
      } else {
        const x0 = r.x;
        const x1 = r.x + r.w;
        els.push(<line key={`pin-${id}-${edge}`} className="rel-pin" x1={x0 - t} x2={x1 + t} y1={line} y2={line} />);
        if (Math.abs(at - line) > 0.5) els.push(<line key={`pin-off-${id}-${edge}`} className="rel-offset" x1={(x0 + x1) / 2} x2={(x0 + x1) / 2} y1={line} y2={at} />);
      }
    }

    for (const axis of ["x", "y"] as const) {
      const al = p.align?.[axis];
      const anchor = al && byId.get(al.anchor);
      if (!al || !anchor) continue;
      const a = boxPx(anchor.box, W, H);
      const v = edgeOf(r, al.edge);
      if (axis === "x") {
        const y0 = Math.min(r.y, a.y);
        const y1 = Math.max(r.y + r.h, a.y + a.h);
        els.push(<line key={`al-${id}-x`} className="rel-align" x1={al.at} x2={al.at} y1={y0 - t} y2={y1 + t} />);
        if (Math.abs(v - al.at) > 0.5) els.push(<line key={`al-off-${id}-x`} className="rel-offset" x1={al.at} x2={v} y1={r.y + r.h / 2} y2={r.y + r.h / 2} />);
      } else {
        const x0 = Math.min(r.x, a.x);
        const x1 = Math.max(r.x + r.w, a.x + a.w);
        els.push(<line key={`al-${id}-y`} className="rel-align" x1={x0 - t} x2={x1 + t} y1={al.at} y2={al.at} />);
        if (Math.abs(v - al.at) > 0.5) els.push(<line key={`al-off-${id}-y`} className="rel-offset" x1={r.x + r.w / 2} x2={r.x + r.w / 2} y1={al.at} y2={v} />);
      }
    }

    const st = p.stack;
    const sp = stackOf(n);
    const anchor = st && byId.get(st.anchor);
    if (st && sp && anchor) {
      const a = boxPx(anchor.box, W, H);
      const gap = sp.gap ?? 2;
      if (st.axis === "y") {
        const x = r.x + Math.min(r.w, a.w) / 2 + (r.x < a.x ? 0 : 0);
        const from = st.dir === 1 ? a.y + a.h : a.y;
        const to = st.dir === 1 ? r.y : r.y + r.h;
        els.push(<line key={`st-${id}`} className="rel-stack" x1={x} x2={x} y1={from} y2={to} />);
        els.push(
          <text key={`st-t-${id}`} className="rel-label" x={x + 4 / zoom} y={(from + to) / 2} style={{ fontSize: font }}>
            {gap}u
          </text>,
        );
      } else {
        const y = r.y + Math.min(r.h, a.h) / 2;
        const from = st.dir === 1 ? a.x + a.w : a.x;
        const to = st.dir === 1 ? r.x : r.x + r.w;
        els.push(<line key={`st-${id}`} className="rel-stack" x1={from} x2={to} y1={y} y2={y} />);
        els.push(
          <text key={`st-t-${id}`} className="rel-label" x={(from + to) / 2} y={y - 4 / zoom} style={{ fontSize: font }}>
            {gap}u
          </text>,
        );
      }
    }
  }
  if (!els.length) return null;
  return (
    <svg className="overlay relations" viewBox={`0 0 ${W} ${H}`} width={W * zoom} height={H * zoom} preserveAspectRatio="none">
      {els}
    </svg>
  );
}
