import {
  isAsset,
  isShape,
  type Box,
  type DesignParam,
  type GroundNode,
  type ImageData,
  type ImageNode,
  type Node,
  type ShapeData,
  type TypeNode,
} from "@xds/protocol";
import { SHAPES, SHAPE_LABELS, SHAPE_PARAMS } from "../../stage/shapes";
import { boxPx, nodeLabel, nodesOf, typeStyle, useActiveSlide, useStudio } from "../../store";
import { Icon } from "../Icon";
import {
  Checkbox,
  ColorTokenSelect,
  IconButton,
  MIXED,
  NumberField,
  Row,
  Section,
  Segmented,
  Select,
  TextField,
  shared,
} from "../ui";

type BoxNode = Exclude<Node, { layer: "render" }>;

export function AlignBar() {
  const { align, distribute } = useStudio.getState();
  const count = useStudio((s) => s.selectedIds.length);
  if (count < 2) return null;
  return (
    <div className="align-bar">
      <IconButton icon="alignLeft" title="Align left" onClick={() => align("left")} />
      <IconButton icon="alignCenter" title="Align centers horizontally" onClick={() => align("center")} />
      <IconButton icon="alignRight" title="Align right" onClick={() => align("right")} />
      <IconButton icon="alignTop" title="Align top" onClick={() => align("top")} />
      <IconButton icon="alignMiddle" title="Align middles" onClick={() => align("middle")} />
      <IconButton icon="alignBottom" title="Align bottom" onClick={() => align("bottom")} />
      <span className="sep" />
      <IconButton icon="distributeX" title="Distribute horizontally (equal gaps)" onClick={() => distribute("x", false)} disabled={count < 3} />
      <IconButton icon="distributeY" title="Distribute vertically (equal gaps)" onClick={() => distribute("y", false)} disabled={count < 3} />
      <button type="button" className="chip" title="Distribute horizontally with gaps snapped to u" onClick={() => distribute("x", true)}>
        ↔u
      </button>
      <button type="button" className="chip" title="Distribute vertically with gaps snapped to u" onClick={() => distribute("y", true)}>
        ↕u
      </button>
    </div>
  );
}

export function TransformInspector({ nodes }: { nodes: BoxNode[] }) {
  const project = useStudio((s) => s.project)!;
  const guide = useStudio((s) => s.guide);
  const readOnly = useStudio((s) => s.readOnly);
  const { setBoxes, patchBox } = useStudio.getState();
  const { width: W, height: H } = project.format;
  const ids = nodes.map((n) => n.id);
  const px = nodes.map((n) => ({ n, r: boxPx(n.box, W, H) }));
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const sx = shared(px, (p) => r1(p.r.x));
  const sy = shared(px, (p) => r1(p.r.y));
  const sw = shared(px, (p) => r1(p.r.w));
  const sh = shared(px, (p) => r1(p.r.h));
  const rot = shared(nodes, (n) => n.box.rotation ?? 0);
  const op = shared(nodes, (n) => n.box.opacity ?? 1);
  const m = guide?.margins;
  const single = px.length === 1 ? px[0].r : null;

  const setPx = (key: "x" | "y" | "w" | "h", v: number | undefined) => {
    if (v === undefined) return;
    const boxes: Record<string, Box> = {};
    for (const { n } of px) {
      const scale = key === "x" || key === "w" ? W : H;
      const val = Math.round((v / scale) * 100 * 1000) / 1000;
      boxes[n.id] = { ...n.box, [key]: key === "w" || key === "h" ? Math.max(0.01, val) : val };
    }
    setBoxes(boxes);
  };

  return (
    <Section title={nodes.length > 1 ? `Transform · ${nodes.length} selected` : "Transform"}>
      <AlignBar />
      <div className="field-grid">
        <NumberField
          label="X"
          value={sx}
          unit="px"
          disabled={readOnly}
          range={m && single ? [m.left, W - m.right - single.w] : undefined}
          onChange={(v) => setPx("x", v)}
        />
        <NumberField
          label="Y"
          value={sy}
          unit="px"
          disabled={readOnly}
          range={m && single ? [m.top, H - m.bottom - single.h] : undefined}
          onChange={(v) => setPx("y", v)}
        />
        <NumberField label="W" value={sw} unit="px" min={1} disabled={readOnly} range={m && nodes[0]?.layer !== "ground" ? [1, W - m.left - m.right] : undefined} onChange={(v) => setPx("w", v)} />
        <NumberField label="H" value={sh} unit="px" min={1} disabled={readOnly} range={m && nodes[0]?.layer !== "ground" ? [1, H - m.top - m.bottom] : undefined} onChange={(v) => setPx("h", v)} />
        <NumberField
          label="Rot"
          value={rot}
          unit="°"
          step={1}
          disabled={readOnly}
          onChange={(v) => patchBox(ids, { rotation: v ? v : undefined })}
        />
        <NumberField
          label="Opacity"
          value={op}
          step={0.05}
          min={0}
          max={1}
          disabled={readOnly}
          onChange={(v) => patchBox(ids, { opacity: v === undefined || v === 1 ? undefined : v })}
        />
      </div>
      {guide && <div className="muted small">Margin {guide.m}px · unit u = {guide.u}px</div>}
    </Section>
  );
}

export function TypeInspector({ nodes }: { nodes: TypeNode[] }) {
  const project = useStudio((s) => s.project)!;
  const guide = useStudio((s) => s.guide);
  const readOnly = useStudio((s) => s.readOnly);
  const patchData = useStudio((s) => s.patchData);
  const fitted = useStudio((s) => s.fitted);
  const ids = nodes.map((n) => n.id);
  const roles = Object.entries(project.brand.typography ?? {});
  const styles = nodes.map((n) => typeStyle(project, n, guide));
  const d = <K extends keyof TypeNode["data"]>(k: K) => shared(nodes, (n) => n.data[k]);
  const eff = <K extends keyof ReturnType<typeof typeStyle>>(k: K) => shared(styles, (s) => s[k]);
  const band = shared(styles, (s) => s.band);
  const b = band && band !== MIXED ? band : undefined;
  const set = (k: string, v: unknown) => patchData(ids, { [k]: v });
  const text = d("text");
  const level = eff("level");

  return (
    <Section title="Text">
      <TextField
        multiline
        value={text === MIXED ? "" : (text as string) ?? ""}
        mixed={text === MIXED}
        disabled={readOnly}
        onChange={(v) => set("text", v)}
      />
      <Row label="Role" hint={level && level !== MIXED ? level : undefined}>
        <Select
          value={d("role") as string | typeof MIXED}
          options={roles.map(([name, r]) => ({ value: name, label: `${name} · ${r.level}` }))}
          disabled={readOnly}
          onChange={(v) => v && set("role", v)}
        />
      </Row>
      <Row label="Align">
        <Segmented
          value={(d("align") === MIXED ? undefined : (d("align") as string | undefined) ?? "left") as "left" | "center" | "right" | undefined}
          disabled={readOnly}
          options={[
            { value: "left", label: "Left" },
            { value: "center", label: "Center" },
            { value: "right", label: "Right" },
          ]}
          onChange={(v) => set("align", v === "left" ? undefined : v)}
        />
      </Row>
      <Row label="V-align">
        <Segmented
          value={(d("valign") === MIXED ? undefined : (d("valign") as string | undefined) ?? "top") as "top" | "middle" | "bottom" | undefined}
          disabled={readOnly}
          options={[
            { value: "top", label: "Top" },
            { value: "middle", label: "Middle" },
            { value: "bottom", label: "Bottom" },
          ]}
          onChange={(v) => set("valign", v === "top" ? undefined : v)}
        />
      </Row>
      <div className="field-grid">
        <NumberField
          label="Size"
          value={d("size") as number | undefined | typeof MIXED}
          placeholder={nodes.length === 1 && fitted[nodes[0].id] !== undefined ? `fit ${fitted[nodes[0].id]}` : (eff("size") === MIXED ? "—" : (eff("size") as number)) ?? undefined}
          range={b ? [b.min, b.max] : undefined}
          unit="px"
          min={1}
          disabled={readOnly}
          title="Empty = Scale × the role's size (or the band default); with Fit width, the fitted size"
          onChange={(v) => (v === undefined ? set("size", undefined) : patchData(ids, { size: v }, ["scale"]))}
        />
        <NumberField
          label="Scale"
          value={d("scale") as number | undefined | typeof MIXED}
          placeholder={1}
          step={0.05}
          min={0.1}
          max={10}
          track={false}
          range={[0.5, 2]}
          rangeLabel={false}
          disabled={readOnly}
          title="× the role's size; it holds in every format (a Size in px wins)"
          onChange={(v) => (v === undefined ? set("scale", undefined) : patchData(ids, { scale: v }, ["size"]))}
        />
        <NumberField
          label="Weight"
          value={d("weight") as number | undefined | typeof MIXED}
          placeholder={eff("weight") === MIXED ? "—" : (eff("weight") as number)}
          step={100}
          min={100}
          max={900}
          disabled={readOnly}
          onChange={(v) => set("weight", v)}
        />
        <NumberField
          label="Line h."
          value={d("lineHeight") as number | undefined | typeof MIXED}
          placeholder={eff("lineHeight") === MIXED ? "—" : Math.round((eff("lineHeight") as number) * 100) / 100}
          step={0.05}
          min={0.5}
          max={3}
          range={b ? b.line_height : undefined}
          disabled={readOnly}
          onChange={(v) => set("lineHeight", v)}
        />
        <NumberField
          label="Tracking"
          value={d("letterSpacing") as number | undefined | typeof MIXED}
          placeholder={eff("letterSpacing") === MIXED ? "—" : (eff("letterSpacing") as number)}
          step={0.01}
          unit="em"
          disabled={readOnly}
          onChange={(v) => set("letterSpacing", v)}
        />
      </div>
      <Row label="Color">
        <ColorTokenSelect
          project={project}
          value={d("color") as string | undefined | typeof MIXED}
          allowNone
          noneLabel="Role color"
          disabled={readOnly}
          onChange={(v) => set("color", v)}
        />
      </Row>
      <div className="check-row">
        <Checkbox
          label="Uppercase"
          checked={eff("uppercase") as boolean | typeof MIXED}
          disabled={readOnly}
          onChange={(v) => set("uppercase", v)}
        />
        <Checkbox label="Italic" checked={eff("italic") as boolean | typeof MIXED} disabled={readOnly} onChange={(v) => set("italic", v)} />
        <Checkbox
          label="Decorative"
          checked={(d("decorative") as boolean | undefined | typeof MIXED) ?? false}
          disabled={readOnly}
          onChange={(v) => set("decorative", v || undefined)}
        />
      </div>
      <Row label="Wrap" hint="balance: even lines (headlines) · pretty: no lone last word">
        <Segmented
          value={(() => {
            const v = eff("wrap");
            return v === MIXED ? undefined : (v as "normal" | "balance" | "pretty");
          })()}
          disabled={readOnly}
          options={[
            { value: "normal", label: "Normal" },
            { value: "balance", label: "Balance" },
            { value: "pretty", label: "Pretty" },
          ]}
          onChange={(v) => set("wrap", v)}
        />
      </Row>
      <Row label="Group" hint="blocks that belong together">
        <TextField
          value={d("group") === MIXED ? "" : ((d("group") as string | undefined) ?? "")}
          mixed={d("group") === MIXED}
          disabled={readOnly}
          onChange={(v) => set("group", v.trim() || undefined)}
        />
      </Row>
      {b && (
        <div className="muted small">
          {b.level}: {b.min}–{b.max}px (default {b.default}), line height {b.line_height[0]}–{b.line_height[1]}, ≤ {b.max_lines} lines
        </div>
      )}
    </Section>
  );
}

export function ImageInspector({ nodes: all }: { nodes: ImageNode[] }) {
  const project = useStudio((s) => s.project)!;
  const readOnly = useStudio((s) => s.readOnly);
  const patchData = useStudio((s) => s.patchData);
  const nodes = all.filter((n): n is ImageNode & { data: ImageData } => isAsset(n.data));
  const ids = nodes.map((n) => n.id);
  if (!nodes.length) return null;
  const assets = (project.assets ?? []).filter((a) => a.kind === "image" || a.kind === "svg");
  return (
    <Section title="Image">
      <Row label="Asset">
        <Select
          value={shared(nodes, (n) => n.data.asset) as string | typeof MIXED}
          options={assets.map((a) => ({ value: a.id, label: `${a.id} · ${a.path}` }))}
          disabled={readOnly}
          onChange={(v) => v && patchData(ids, { asset: v })}
        />
      </Row>
      <Row label="Fit">
        <Segmented
          value={(() => {
            const v = shared(nodes, (n) => n.data.fit ?? "cover");
            return v === MIXED ? undefined : v;
          })()}
          disabled={readOnly}
          options={[
            { value: "cover", label: "Cover" },
            { value: "contain", label: "Contain" },
            { value: "fill", label: "Fill" },
          ]}
          onChange={(v) => patchData(ids, { fit: v })}
        />
      </Row>
    </Section>
  );
}

type ShapeNode = ImageNode & { data: ShapeData };

/** An ornament (data-models §2.5d): its shape, stroke, fill and the shape's own knobs. */
export function ShapeInspector({ nodes: all }: { nodes: ImageNode[] }) {
  const project = useStudio((s) => s.project)!;
  const readOnly = useStudio((s) => s.readOnly);
  const patchData = useStudio((s) => s.patchData);
  const nodes = all.filter((n): n is ShapeNode => isShape(n.data));
  const ids = nodes.map((n) => n.id);
  if (!nodes.length) return null;
  const shape = shared(nodes, (n) => n.data.shape);
  const strokeWidth = shared(nodes, (n) => n.data.stroke?.width);
  const strokeColor = shared(nodes, (n) => n.data.stroke?.color);
  const fill = shared(nodes, (n) => n.data.fill ?? "__default");
  const setStroke = (patch: { width?: number; color?: string | undefined }) =>
    useStudio.getState().editNodes(ids, (n) => {
      if (n.layer !== "image" || !isShape(n.data)) return n;
      const stroke = { ...(n.data.stroke ?? { width: 0.5 }), ...patch };
      if (patch.color === undefined && "color" in patch) delete (stroke as { color?: string }).color;
      return { ...n, data: { ...n.data, stroke } } as Node;
    });
  const fillOptions = [
    { value: "__default", label: "Default", hint: "none when stroked, else the stroke color" },
    { value: "none", label: "None" },
    ...project.brand.colors.map((c) => ({ value: c.name, label: c.name, hint: c.hex, swatch: c.hex, group: "Brand colors" })),
  ];
  const params = typeof shape === "string" ? SHAPE_PARAMS[shape] : [];
  return (
    <Section title="Shape">
      <Row label="Shape">
        <Select
          value={shape}
          options={SHAPES.map((s) => ({ value: s, label: SHAPE_LABELS[s], hint: s }))}
          disabled={readOnly}
          onChange={(v) => v && patchData(ids, { shape: v }, ["params"])}
        />
      </Row>
      <Row label="Stroke" hint="width in u; empty: no stroke">
        <div className="field-grid">
          <NumberField
            label="W"
            value={strokeWidth}
            placeholder="none"
            step={0.25}
            min={0}
            max={20}
            unit="u"
            disabled={readOnly}
            onChange={(v) => (v === undefined || v <= 0 ? patchData(ids, {}, ["stroke"]) : setStroke({ width: v }))}
          />
          <ColorTokenSelect
            project={project}
            value={strokeColor}
            allowNone
            noneLabel="Default"
            disabled={readOnly || strokeWidth === undefined}
            onChange={(v) => setStroke({ color: v })}
          />
        </div>
      </Row>
      <Row label="Fill">
        <Select
          value={fill}
          options={fillOptions}
          disabled={readOnly}
          onChange={(v) => (!v || v === "__default" ? patchData(ids, {}, ["fill"]) : patchData(ids, { fill: v }))}
        />
      </Row>
      {params.map((p) => (
        <Row key={p.key} label={p.label}>
          <NumberField
            value={shared(nodes, (n) => n.data.params?.[p.key])}
            placeholder={p.default}
            step={p.step}
            min={p.min}
            max={p.max}
            unit={p.unit}
            track={false}
            disabled={readOnly}
            onChange={(v) =>
              useStudio.getState().editNodes(ids, (n) => {
                if (n.layer !== "image" || !isShape(n.data)) return n;
                const next = { ...(n.data.params ?? {}) };
                if (v === undefined) delete next[p.key];
                else next[p.key] = v;
                const data = { ...n.data, params: next };
                if (!Object.keys(next).length) delete (data as { params?: unknown }).params;
                return { ...n, data } as Node;
              })
            }
          />
        </Row>
      ))}
    </Section>
  );
}

function ParamControl({
  param,
  value,
  isSet,
  onChange,
  disabled,
}: {
  param: DesignParam;
  value: unknown;
  isSet: boolean;
  onChange: (v: string | number | boolean | undefined) => void;
  disabled?: boolean;
}) {
  const project = useStudio((s) => s.project)!;
  const label = (
    <span className={`lbl${isSet ? " set" : ""}`} title={param.name}>
      {param.label ?? param.name}
    </span>
  );
  switch (param.type) {
    case "number":
      return (
        <NumberField
          label={label}
          value={isSet ? (value as number) : undefined}
          placeholder={value as number}
          min={param.min}
          max={param.max}
          step={param.step ?? (param.max !== undefined && param.min !== undefined && param.max - param.min <= 2 ? 0.01 : 1)}
          disabled={disabled}
          onChange={onChange}
        />
      );
    case "color": {
      const isToken = typeof value === "string" && project.brand.colors.some((c) => c.name === value);
      return (
        <Row label={label}>
          {isToken || !value ? (
            <ColorTokenSelect project={project} value={value as string | undefined} allowNone noneLabel="Default" disabled={disabled} onChange={onChange} />
          ) : (
            <div className="inline">
              <span className="swatch" style={{ background: String(value) }} />
              <TextField value={String(value)} disabled={disabled} onChange={(v) => onChange(v || undefined)} />
              <ColorTokenSelect project={project} value={undefined} allowNone noneLabel="Token…" disabled={disabled} onChange={onChange} />
            </div>
          )}
        </Row>
      );
    }
    case "select":
      return (
        <Row label={label}>
          <Select value={value as string} options={param.options ?? []} disabled={disabled} onChange={onChange} />
        </Row>
      );
    case "boolean":
      return (
        <Row label={label}>
          <Checkbox checked={!!value} disabled={disabled} onChange={onChange} />
        </Row>
      );
    default:
      return (
        <Row label={label}>
          <TextField value={String(value ?? "")} disabled={disabled} onChange={(v) => onChange(v)} />
        </Row>
      );
  }
}

export function GroundInspector({ nodes }: { nodes: GroundNode[] }) {
  const designs = useStudio((s) => s.designs);
  const readOnly = useStudio((s) => s.readOnly);
  const editNodes = useStudio((s) => s.editNodes);
  const patchData = useStudio((s) => s.patchData);
  const ids = nodes.map((n) => n.id);
  const design = shared(nodes, (n) => n.data.design);
  const info = typeof design === "string" ? designs[design] : undefined;
  const manifest = info?.manifest;
  const single = nodes.length === 1 ? nodes[0] : null;
  const variant = single?.data.variant;
  const variantValues = manifest?.variants?.find((v) => v.name === variant)?.values ?? {};

  const setValue = (name: string, v: string | number | boolean | undefined) =>
    editNodes(ids, (n) => {
      if (n.layer !== "ground") return n;
      const values = { ...(n.data.values ?? {}) };
      if (v === undefined) delete values[name];
      else values[name] = v;
      const data: GroundNode["data"] = { ...n.data, values };
      if (!Object.keys(values).length) delete data.values;
      return { ...n, data };
    });

  return (
    <Section title="Background">
      <Row label="Design">
        <Select
          value={design as string | typeof MIXED}
          options={Object.keys(designs)}
          disabled={readOnly}
          onChange={(v) => v && patchData(ids, { design: v, variant: undefined, values: undefined })}
        />
      </Row>
      {info?.error && (
        <div className="callout sev-error">
          <Icon name="error" size={12} /> {info.error}
        </div>
      )}
      {single && manifest?.variants?.length ? (
        <div className="variants">
          {manifest.variants.map((v) => (
            <button
              type="button"
              key={v.name}
              className={`chip${variant === v.name ? " active" : ""}`}
              disabled={readOnly}
              onClick={() => patchData(ids, { variant: variant === v.name ? undefined : v.name })}
            >
              {v.name}
            </button>
          ))}
        </div>
      ) : null}
      {single && manifest?.params?.length ? (
        <div className="params">
          {manifest.params.map((p) => {
            const own = single.data.values?.[p.name];
            const value = own ?? variantValues[p.name] ?? p.default;
            return (
              <ParamControl key={p.name} param={p} value={value} isSet={own !== undefined} disabled={readOnly} onChange={(v) => setValue(p.name, v)} />
            );
          })}
        </div>
      ) : null}
      {nodes.length > 1 && <div className="muted small">Select one background to edit its parameters.</div>}
    </Section>
  );
}
