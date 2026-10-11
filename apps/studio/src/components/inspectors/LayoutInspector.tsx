/**
 * The Layout section (human-interaction §4 "Pin and align"): a 2D node's relations, which the
 * layout resolves into its box (data-models §2.5a). Pins to the format's lines, an edge shared
 * with another node, a stack below/above/right of/left of another node, and a text box that
 * fits its text. Each relation has a Free action that detaches it and leaves the box where it is.
 */
import type { AlignTo, Layout, Node, Pin, Pins, Stack, TypeNode } from "@xds/protocol";
import { stackOf } from "@xds/protocol";
import { PIN_EDGES, type Edge } from "@xds/editor-core";
import { nodeLabel, slideNodes, useActiveSlide, useStudio } from "../../store";
import { Checkbox, MIXED, NumberField, Row, Section, Segmented, Select, shared } from "../ui";

type BoxNode = Exclude<Node, { layer: "render" }>;
type Line = Pin["to"];

const LINES: { value: Line; label: string }[] = [
  { value: "margin", label: "Margin" },
  { value: "safe", label: "Safe zone" },
  { value: "edge", label: "Canvas edge" },
  { value: "center", label: "Center" },
  { value: "third", label: "Third" },
  { value: "two-thirds", label: "Two thirds" },
];
const EDGE_LABELS: Record<Edge, string> = { left: "Left", right: "Right", top: "Top", bottom: "Bottom", cx: "Center X", cy: "Center Y" };
const X_EDGES: AlignTo["edge"][] = ["left", "center", "right"];
const Y_EDGES: AlignTo["edge"][] = ["top", "middle", "bottom"];

function FreeButton({ onClick, disabled, title }: { onClick: () => void; disabled?: boolean; title: string }) {
  return (
    <button type="button" className="btn small ghost" disabled={disabled} title={title} onClick={onClick}>
      Free
    </button>
  );
}

function PinRows({ nodes }: { nodes: BoxNode[] }) {
  const readOnly = useStudio((s) => s.readOnly);
  const { patchLayout, detachLayout } = useStudio.getState();
  const ids = nodes.map((n) => n.id);
  const pinOf = (n: BoxNode, e: Edge) => n.layout?.pin?.[e];
  const anyPin = nodes.some((n) => n.layout?.pin && Object.values(n.layout.pin).some(Boolean));
  const setPin = (e: Edge, pin: Pin | undefined) =>
    patchLayout(ids, (l) => {
      const pins: Pins = { ...(l?.pin ?? {}) };
      if (pin) {
        pins[e] = pin;
        // a center pin and an edge pin on one axis can't both hold
        if (e === "cx") delete pins.left, delete pins.right;
        if (e === "cy") delete pins.top, delete pins.bottom;
        if (e === "left" || e === "right") delete pins.cx;
        if (e === "top" || e === "bottom") delete pins.cy;
      } else delete pins[e];
      return { ...(l ?? {}), pin: Object.keys(pins).length ? pins : undefined };
    });
  return (
    <>
      {PIN_EDGES.map((e) => {
        const to = shared(nodes, (n) => pinOf(n, e)?.to);
        const off = shared(nodes, (n) => pinOf(n, e)?.offset ?? 0);
        return (
          <Row key={e} label={EDGE_LABELS[e]}>
            <div className="field-grid">
              <Select<Line>
                value={to === MIXED ? MIXED : to}
                noneLabel="Not pinned"
                options={LINES}
                disabled={readOnly}
                onChange={(v) => setPin(e, v ? { to: v, offset: off === MIXED ? 0 : off } : undefined)}
              />
              {to && to !== MIXED && (
                <NumberField
                  label="Offset"
                  unit="u"
                  value={off}
                  step={0.5}
                  disabled={readOnly}
                  onChange={(v) => setPin(e, { to, offset: v ?? 0 })}
                />
              )}
            </div>
          </Row>
        );
      })}
      {anyPin && (
        <Row label="">
          <FreeButton title="Remove every pin; the box stays where it is" disabled={readOnly} onClick={() => detachLayout(ids, "pin")} />
        </Row>
      )}
    </>
  );
}

function AlignRows({ node, others }: { node: BoxNode; others: BoxNode[] }) {
  const readOnly = useStudio((s) => s.readOnly);
  const project = useStudio((s) => s.project)!;
  const { patchLayout, detachLayout } = useStudio.getState();
  const aligns = node.layout?.align ?? [];
  const forAxis = (edges: AlignTo["edge"][]) => aligns.find((a) => edges.includes(a.edge));
  const write = (edges: AlignTo["edge"][], next: AlignTo | undefined) =>
    patchLayout([node.id], (l) => {
      const rest = (l?.align ?? []).filter((a) => !edges.includes(a.edge));
      const align = next ? [...rest, next] : rest;
      return { ...(l ?? {}), align: align.length ? (align as Layout["align"]) : undefined };
    });
  const options = others.map((o) => ({ value: o.id, label: nodeLabel(o, project) }));
  const axisRow = (label: string, edges: AlignTo["edge"][]) => {
    const cur = forAxis(edges);
    return (
      <Row label={label}>
        <div className="layout-align">
          <Select
            value={cur?.node}
            noneLabel="No node"
            options={options}
            disabled={readOnly}
            onChange={(v) => write(edges, v ? { node: v, edge: cur?.edge ?? edges[0], offset: cur?.offset ?? 0 } : undefined)}
          />
          {cur && (
            <>
              <Segmented<AlignTo["edge"]>
                value={cur.edge}
                options={edges.map((e) => ({ value: e, label: e[0].toUpperCase() + e.slice(1) }))}
                disabled={readOnly}
                onChange={(e) => write(edges, { ...cur, edge: e })}
              />
              <NumberField label="Offset" unit="u" value={cur.offset ?? 0} step={0.5} disabled={readOnly} onChange={(v) => write(edges, { ...cur, offset: v ?? 0 })} />
            </>
          )}
        </div>
      </Row>
    );
  };
  return (
    <>
      {axisRow("Align X", X_EDGES)}
      {axisRow("Align Y", Y_EDGES)}
      {aligns.length > 0 && (
        <Row label="">
          <FreeButton title="Remove the aligns; the box stays where it is" disabled={readOnly} onClick={() => detachLayout([node.id], "align")} />
        </Row>
      )}
    </>
  );
}

function StackRows({ node, others }: { node: BoxNode; others: BoxNode[] }) {
  const readOnly = useStudio((s) => s.readOnly);
  const project = useStudio((s) => s.project)!;
  const { patchLayout, patchData, detachLayout } = useStudio.getState();
  const stack = stackOf(node);
  const legacy = node.layer === "type" && !!(node as TypeNode).data.stack && !node.layout?.stack;
  const dir = stack?.below ? "below" : stack?.above ? "above" : stack?.rightOf ? "rightOf" : stack?.leftOf ? "leftOf" : null;
  const anchor = stack?.below ?? stack?.above ?? stack?.rightOf ?? stack?.leftOf;
  const write = (next: Stack | undefined) => {
    if (legacy) patchData([node.id], { stack: next });
    else patchLayout([node.id], (l) => ({ ...(l ?? {}), stack: next }));
  };
  const value = dir && anchor ? `${dir}:${anchor}` : undefined;
  const words = { below: "Below", above: "Above", rightOf: "Right of", leftOf: "Left of" } as const;
  return (
    <>
      <Row label="Stack" hint="a gap from another block, ink to ink; the box then follows">
        <Select
          value={value}
          noneLabel="Free"
          options={others.flatMap((o) =>
            (Object.keys(words) as (keyof typeof words)[]).map((d) => ({
              value: `${d}:${o.id}`,
              label: `${words[d]} ${nodeLabel(o, project)}`,
              group: nodeLabel(o, project),
            })),
          )}
          disabled={readOnly}
          onChange={(v) => {
            if (!v) return write(undefined);
            const i = v.indexOf(":");
            const d = v.slice(0, i) as keyof typeof words;
            write({ [d]: v.slice(i + 1), gap: stack?.gap ?? 2 } as Stack);
          }}
        />
      </Row>
      {stack && (
        <Row label="">
          <div className="field-grid">
            <NumberField
              label="Gap"
              unit="u"
              value={stack.gap ?? 2}
              step={0.5}
              min={-20}
              max={20}
              disabled={readOnly}
              onChange={(g) => g !== undefined && write({ ...stack, gap: g })}
            />
            <FreeButton title="Unstack; the box stays where it is" disabled={readOnly} onClick={() => detachLayout([node.id], "stack")} />
          </div>
        </Row>
      )}
    </>
  );
}

function GroupRow({ nodes }: { nodes: BoxNode[] }) {
  const slide = useActiveSlide();
  const readOnly = useStudio((s) => s.readOnly);
  const { patchLayout, groupSelection } = useStudio.getState();
  const names = Object.keys(slide?.groups ?? {});
  const cur = shared(nodes, (n) => n.layout?.group);
  return (
    <Row label="Group" hint="a flow group lays its members out in a column or row (Cmd/Ctrl + G)">
      <div className="field-grid">
        <Select
          value={cur === MIXED ? MIXED : cur}
          noneLabel="None"
          options={names.map((g) => ({ value: g, label: `${g} · ${slide!.groups![g].direction ?? "column"}` }))}
          disabled={readOnly}
          onChange={(v) =>
            patchLayout(
              nodes.map((n) => n.id),
              (l) => ({ ...(l ?? {}), group: v ?? undefined }),
            )
          }
        />
        {nodes.length > 1 && !cur && (
          <button type="button" className="btn small" disabled={readOnly} onClick={() => groupSelection("column")}>
            Group
          </button>
        )}
      </div>
    </Row>
  );
}

export function LayoutInspector({ nodes }: { nodes: BoxNode[] }) {
  const slide = useActiveSlide();
  const project = useStudio((s) => s.project);
  const readOnly = useStudio((s) => s.readOnly);
  const { patchLayout } = useStudio.getState();
  const single = nodes.length === 1 ? nodes[0] : null;
  const others = slideNodes(project, slide).filter((n): n is BoxNode => n.layer !== "render" && !nodes.some((s) => s.id === n.id));
  const fit = shared(nodes, (n) => (n.layer === "type" ? n.layout?.fit === "text" : false));
  const allText = nodes.every((n) => n.layer === "type");
  return (
    <Section title="Layout" defaultOpen={nodes.some((n) => n.layout || (n.layer === "type" && n.data.stack))}>
      <div className="muted small">Relations resolve into the box; dragging a related block edits its offset or gap.</div>
      <GroupRow nodes={nodes} />
      <PinRows nodes={nodes} />
      {single && <AlignRows node={single} others={others} />}
      {single && <StackRows node={single} others={others} />}
      {allText && (
        <Row label="Height" hint="the box follows the laid-out text">
          <Checkbox
            checked={fit === MIXED ? MIXED : !!fit}
            disabled={readOnly}
            label="Fit to text"
            onChange={(v) => patchLayout(nodes.map((n) => n.id), (l) => ({ ...(l ?? {}), fit: v ? "text" : undefined }))}
          />
        </Row>
      )}
    </Section>
  );
}
