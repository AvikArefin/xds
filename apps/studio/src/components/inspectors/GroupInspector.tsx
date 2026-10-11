/**
 * The Group section (human-interaction §4 "Group a column"): the flow group the selection
 * belongs to (data-models §2.5b). Direction, gap and cross alignment, the padding inside a
 * pinned box, the box's pins, and Ungroup.
 */
import type { Group, Pin, Pins } from "@xds/protocol";
import { PIN_EDGES, type Edge } from "@xds/editor-core";
import { useStudio } from "../../store";
import { NumberField, Row, Section, Segmented, Select } from "../ui";

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

export function GroupInspector({ name, group, members }: { name: string; group: Group; members: number }) {
  const readOnly = useStudio((s) => s.readOnly);
  const { patchGroup, ungroup } = useStudio.getState();
  const pinned = !!group.pin && Object.values(group.pin).some(Boolean);
  const setPin = (e: Edge, pin: Pin | undefined) => {
    const pins: Pins = { ...(group.pin ?? {}) };
    if (pin) {
      pins[e] = pin;
      if (e === "cx") delete pins.left, delete pins.right;
      if (e === "cy") delete pins.top, delete pins.bottom;
      if (e === "left" || e === "right") delete pins.cx;
      if (e === "top" || e === "bottom") delete pins.cy;
    } else delete pins[e];
    patchGroup(name, { pin: Object.keys(pins).length ? pins : undefined });
  };
  return (
    <Section
      title={`Group · ${name}`}
      actions={
        <button type="button" className="btn small ghost" disabled={readOnly} title="Dissolve the group; its members stay where the flow left them" onClick={() => ungroup(name)}>
          Ungroup
        </button>
      }
    >
      <div className="muted small">
        {members} member{members === 1 ? "" : "s"}, laid out in order along the flow; drag one past another to reorder.
      </div>
      <Row label="Direction">
        <Segmented<"column" | "row">
          value={group.direction ?? "column"}
          options={[
            { value: "column", label: "Column" },
            { value: "row", label: "Row" },
          ]}
          disabled={readOnly}
          onChange={(v) => patchGroup(name, { direction: v })}
        />
      </Row>
      <Row label="Gap" hint="between the members' ink, in units">
        <NumberField label="Gap" unit="u" value={group.gap ?? 2} step={0.5} min={0} max={20} disabled={readOnly} onChange={(v) => v !== undefined && patchGroup(name, { gap: v })} />
      </Row>
      <Row label="Align" hint="across the flow">
        <Segmented<"start" | "center" | "end">
          value={group.align ?? "start"}
          options={[
            { value: "start", label: "Start" },
            { value: "center", label: "Center" },
            { value: "end", label: "End" },
          ]}
          disabled={readOnly}
          onChange={(v) => patchGroup(name, { align: v })}
        />
      </Row>
      <Row label="Padding" hint={pinned ? "inside the pinned box" : "applies once the box is pinned"}>
        <NumberField label="Pad" unit="u" value={group.padding ?? 0} step={0.5} min={0} max={20} disabled={readOnly} onChange={(v) => v !== undefined && patchGroup(name, { padding: v })} />
      </Row>
      <div className="muted small">Box pins: where the group sits. Unpinned, it packs where its members are.</div>
      {PIN_EDGES.map((e) => {
        const pin = group.pin?.[e];
        return (
          <Row key={e} label={EDGE_LABELS[e]}>
            <div className="field-grid">
              <Select<Line>
                value={pin?.to}
                noneLabel="Not pinned"
                options={LINES}
                disabled={readOnly}
                onChange={(v) => setPin(e, v ? { to: v, offset: pin?.offset ?? 0 } : undefined)}
              />
              {pin && <NumberField label="Offset" unit="u" value={pin.offset ?? 0} step={0.5} disabled={readOnly} onChange={(v) => setPin(e, { to: pin.to, offset: v ?? 0 })} />}
            </div>
          </Row>
        );
      })}
    </Section>
  );
}
