import { isAsset, type Box, type DesignParam, type GroundNode, type ImageData, type ImageNode, type Node, type TypeNode } from "@xds/protocol";
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
          placeholder={(eff("size") === MIXED ? "—" : (eff("size") as number)) ?? undefined}
          range={b ? [b.min, b.max] : undefined}
          unit="px"
          min={1}
          disabled={readOnly}
          title="Empty = the role's size (or the band default)"
          onChange={(v) => set("size", v)}
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
      {nodes.length === 1 && <StackRow node={nodes[0]} />}
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

/** `data.stack`: place the block a gap (in u) below or above another block, ink to ink. */
function StackRow({ node }: { node: TypeNode }) {
  const slide = useActiveSlide();
  const readOnly = useStudio((s) => s.readOnly);
  const patchData = useStudio((s) => s.patchData);
  const project = useStudio((s) => s.project)!;
  const stack = node.data.stack;
  const others = nodesOf(slide).filter((n) => n.id !== node.id && (n.layer === "type" || n.layer === "image"));
  const value = stack ? `${stack.below ? "below" : "above"}:${stack.below ?? stack.above}` : undefined;
  return (
    <>
      <Row label="Stack" hint="place it a gap below or above another block, ink to ink; box Y then follows">
        <Select
          value={value}
          noneLabel="Free (box Y)"
          options={others.flatMap((o) => [
            { value: `below:${o.id}`, label: `Below ${nodeLabel(o, project)}` },
            { value: `above:${o.id}`, label: `Above ${nodeLabel(o, project)}` },
          ])}
          disabled={readOnly}
          onChange={(v) => {
            if (!v) return patchData([node.id], { stack: undefined });
            const [dir, id] = [v.slice(0, v.indexOf(":")), v.slice(v.indexOf(":") + 1)];
            patchData([node.id], { stack: { [dir]: id, gap: stack?.gap ?? 2 } });
          }}
        />
      </Row>
      {stack && (
        <div className="field-grid">
          <NumberField
            label="Gap (u)"
            value={stack.gap ?? 2}
            step={0.5}
            min={-20}
            max={20}
            disabled={readOnly}
            onChange={(g) => g !== undefined && patchData([node.id], { stack: { ...stack, gap: g } })}
          />
        </div>
      )}
    </>
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
