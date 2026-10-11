/**
 * The Text inspector's Treatments section (data-models §2.5d, design-rules §8): skew, fill and
 * stroke, extrusion, repeats, a plate and fit-to-width, each written as the treatment object on
 * the node's data. Guide ranges come from `brand.expression` when the project declares one.
 */
import type { Extrude, Plate, Repeat, Stroke, TypeNode } from "@xds/protocol";
import { useStudio } from "../../store";
import { Checkbox, ColorTokenSelect, MIXED, NumberField, Row, Section, Segmented, shared } from "../ui";

type Treat = "stroke" | "extrude" | "repeat" | "plate";

export function TreatmentsInspector({ nodes }: { nodes: TypeNode[] }) {
  const project = useStudio((s) => s.project)!;
  const readOnly = useStudio((s) => s.readOnly);
  const patchData = useStudio((s) => s.patchData);
  const fitted = useStudio((s) => s.fitted);
  const ids = nodes.map((n) => n.id);
  const ex = project.brand.expression;
  const d = <K extends keyof TypeNode["data"]>(k: K) => shared(nodes, (n) => n.data[k]);
  const set = (k: string, v: unknown) => patchData(ids, { [k]: v });
  /** Write one field of a treatment object (creating it with defaults when absent). */
  const sub = (k: Treat, defaults: Record<string, unknown>) => (field: string, v: unknown) =>
    useStudio.getState().editNodes(ids, (n) => {
      if (n.layer !== "type") return n;
      const cur = (n.data[k] as Record<string, unknown> | undefined) ?? defaults;
      const next = { ...cur, [field]: v };
      if (v === undefined) delete next[field];
      return { ...n, data: { ...n.data, [k]: next } };
    });
  const on = (k: Treat) => d(k) !== undefined && d(k) !== MIXED;
  const mixedOn = (k: Treat) => d(k) === MIXED;
  const num = (k: Treat, field: string) =>
    shared(nodes, (n) => (n.data[k] as Record<string, unknown> | undefined)?.[field]) as number | undefined | typeof MIXED;
  const str = (k: Treat, field: string) =>
    shared(nodes, (n) => (n.data[k] as Record<string, unknown> | undefined)?.[field]) as string | undefined | typeof MIXED;
  const bool = (k: Treat, field: string) =>
    (shared(nodes, (n) => (n.data[k] as Record<string, unknown> | undefined)?.[field]) as boolean | undefined | typeof MIXED) ?? false;
  const range = (xs: number[] | undefined | null): [number, number] | undefined =>
    xs && xs.length ? [Math.min(...xs), Math.max(...xs)] : undefined;
  const fittedSize = nodes.length === 1 ? fitted[nodes[0].id] : undefined;

  const stroke = sub("stroke", { width: 0.5 } satisfies Stroke);
  const extrude = sub("extrude", { depth: 1, angle: ex?.extrudeAngle ?? 135 } satisfies Extrude);
  const repeat = sub("repeat", { count: 3, dx: 1, dy: 1 } satisfies Repeat);
  const plate = sub("plate", { padding: 2, radius: ex?.radii?.[0] ?? 0 } satisfies Plate);

  return (
    <Section title="Treatments" defaultOpen={nodes.some((n) => n.data.skew || n.data.stroke || n.data.extrude || n.data.repeat || n.data.plate || n.data.fitWidth)}>
      <div className="field-grid">
        <NumberField
          label="Skew"
          value={d("skew") as number | undefined | typeof MIXED}
          placeholder={0}
          unit="°"
          min={-45}
          max={45}
          track={false}
          range={range(ex?.skews)}
          rangeLabel={false}
          disabled={readOnly}
          title="A slant of the glyphs, degrees (brand.expression.skews is the system)"
          onChange={(v) => set("skew", v || undefined)}
        />
        <Row label="Fill">
          <Segmented
            value={(d("fill") === MIXED ? undefined : ((d("fill") as string | undefined) ?? "solid")) as "solid" | "none" | undefined}
            disabled={readOnly}
            options={[
              { value: "solid", label: "Solid" },
              { value: "none", label: "None" },
            ]}
            onChange={(v) => set("fill", v === "solid" ? undefined : v)}
          />
        </Row>
      </div>

      <div className="check-row">
        <Checkbox
          label="Stroke"
          checked={mixedOn("stroke") ? MIXED : on("stroke")}
          disabled={readOnly}
          onChange={(v) => set("stroke", v ? { width: ex?.strokeWidths?.[0] ?? 0.5 } : undefined)}
        />
      </div>
      {on("stroke") && (
        <div className="field-grid">
          <NumberField
            label="Width"
            value={num("stroke", "width")}
            step={0.25}
            min={0.25}
            max={20}
            unit="u"
            track={false}
            range={range(ex?.strokeWidths)}
            rangeLabel={false}
            disabled={readOnly}
            onChange={(v) => v !== undefined && stroke("width", v)}
          />
          <ColorTokenSelect
            project={project}
            value={str("stroke", "color")}
            allowNone
            noneLabel="Text color"
            disabled={readOnly}
            onChange={(v) => stroke("color", v)}
          />
        </div>
      )}

      <div className="check-row">
        <Checkbox
          label="Extrude"
          checked={mixedOn("extrude") ? MIXED : on("extrude")}
          disabled={readOnly}
          onChange={(v) => set("extrude", v ? { depth: 1, angle: ex?.extrudeAngle ?? 135 } : undefined)}
        />
      </div>
      {on("extrude") && (
        <>
          <div className="field-grid">
            <NumberField label="Depth" value={num("extrude", "depth")} step={0.25} min={0.25} max={40} unit="u" track={false} disabled={readOnly} onChange={(v) => v !== undefined && extrude("depth", v)} />
            <NumberField
              label="Angle"
              value={num("extrude", "angle")}
              placeholder={135}
              min={0}
              max={359}
              unit="°"
              track={false}
              range={ex?.extrudeAngle !== undefined && ex?.extrudeAngle !== null ? [ex.extrudeAngle, ex.extrudeAngle] : undefined}
              rangeLabel={false}
              disabled={readOnly}
              title="Clockwise from right: 90 is down, 135 down-left"
              onChange={(v) => extrude("angle", v)}
            />
            <NumberField label="Steps" value={num("extrude", "steps")} placeholder="auto" min={1} max={64} track={false} disabled={readOnly} onChange={(v) => extrude("steps", v)} />
          </div>
          <Row label="Color">
            <ColorTokenSelect project={project} value={str("extrude", "color")} allowNone noneLabel="Text color at 40 %" disabled={readOnly} onChange={(v) => extrude("color", v)} />
          </Row>
        </>
      )}

      <div className="check-row">
        <Checkbox
          label="Repeat"
          checked={mixedOn("repeat") ? MIXED : on("repeat")}
          disabled={readOnly}
          onChange={(v) => set("repeat", v ? { count: 3, dx: 1, dy: 1 } : undefined)}
        />
      </div>
      {on("repeat") && (
        <>
          <div className="field-grid">
            <NumberField label="Count" value={num("repeat", "count")} min={2} max={12} track={false} disabled={readOnly} onChange={(v) => v !== undefined && repeat("count", v)} />
            <NumberField label="dX" value={num("repeat", "dx")} placeholder={0} step={0.25} unit="u" disabled={readOnly} onChange={(v) => repeat("dx", v)} />
            <NumberField label="dY" value={num("repeat", "dy")} placeholder={0} step={0.25} unit="u" disabled={readOnly} onChange={(v) => repeat("dy", v)} />
          </div>
          <div className="check-row">
            <Checkbox label="Alternate outlines" checked={bool("repeat", "outline")} disabled={readOnly} onChange={(v) => repeat("outline", v || undefined)} />
            <Checkbox label="Fade" checked={bool("repeat", "fade")} disabled={readOnly} onChange={(v) => repeat("fade", v || undefined)} />
          </div>
        </>
      )}

      <div className="check-row">
        <Checkbox
          label="Plate"
          checked={mixedOn("plate") ? MIXED : on("plate")}
          disabled={readOnly}
          onChange={(v) => set("plate", v ? { padding: 2, radius: ex?.radii?.[0] ?? 0 } : undefined)}
        />
      </div>
      {on("plate") && (
        <>
          <div className="field-grid">
            <NumberField label="Padding" value={num("plate", "padding")} placeholder={2} step={0.25} min={0} max={40} unit="u" track={false} disabled={readOnly} onChange={(v) => plate("padding", v)} />
            <NumberField
              label="Radius"
              value={num("plate", "radius")}
              placeholder={0}
              step={0.25}
              min={0}
              max={40}
              unit="u"
              track={false}
              range={range(ex?.radii)}
              rangeLabel={false}
              disabled={readOnly}
              onChange={(v) => plate("radius", v)}
            />
            <NumberField
              label="Stroke"
              value={shared(nodes, (n) => n.data.plate?.stroke?.width) as number | undefined | typeof MIXED}
              placeholder="none"
              step={0.25}
              min={0.25}
              max={20}
              unit="u"
              track={false}
              range={range(ex?.strokeWidths)}
              rangeLabel={false}
              disabled={readOnly}
              onChange={(v) => plate("stroke", v === undefined ? undefined : { ...(nodes[0].data.plate?.stroke ?? {}), width: v })}
            />
          </div>
          <Row label="Fill">
            <ColorTokenSelect project={project} value={str("plate", "fill")} allowNone noneLabel="Text color at 12 %" disabled={readOnly} onChange={(v) => plate("fill", v)} />
          </Row>
        </>
      )}

      <div className="check-row">
        <Checkbox
          label="Fit width"
          checked={(d("fitWidth") as boolean | undefined | typeof MIXED) ?? false}
          disabled={readOnly}
          onChange={(v) => set("fitWidth", v || undefined)}
        />
        {fittedSize !== undefined && <span className="muted small">fitted: {fittedSize}px</span>}
      </div>
    </Section>
  );
}
