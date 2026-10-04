import { useRef } from "react";
import type { Lighting, Project } from "@xds/protocol";
import { LIGHTING_DEFAULTS, useStudio } from "../../store";
import { ColorTokenSelect, NumberField, Row, Segmented } from "../ui";

const LOOKS: { value: NonNullable<Lighting["look"]>; label: string; hint: string }[] = [
  { value: "softbox", label: "Softbox", hint: "anything; catalog shots" },
  { value: "contrast", label: "Contrast", hint: "premium, glass, metal" },
  { value: "rim", label: "Rim", hint: "dark product on dark ground" },
  { value: "bright", label: "Bright", hint: "white products, high key" },
];

/** A small schematic per look (key/fill/rim positions), drawn instead of a live render. */
function LookGlyph({ look }: { look: string }) {
  const lights: Record<string, [number, number, number, number][]> = {
    softbox: [
      [10, 8, 14, 0.95],
      [40, 14, 10, 0.4],
      [24, 2, 16, 0.6],
    ],
    contrast: [
      [12, 8, 8, 1],
      [4, 10, 3, 0.8],
      [44, 10, 3, 0.8],
    ],
    rim: [
      [6, 16, 4, 1],
      [42, 16, 4, 1],
      [24, 26, 8, 0.25],
    ],
    bright: [
      [24, 4, 22, 1],
      [8, 14, 10, 0.8],
      [40, 14, 10, 0.8],
    ],
  };
  return (
    <svg viewBox="0 0 48 32" className="look-glyph" aria-hidden>
      <rect x="0" y="0" width="48" height="32" rx="3" className="look-bg" />
      {lights[look].map(([x, y, w, a], i) => (
        <rect key={i} x={x - w / 2} y={y} width={w} height="4" rx="1" fill="#fff" opacity={a} />
      ))}
      <ellipse cx="24" cy="27" rx="9" ry="2" fill="#000" opacity="0.35" />
      <rect x="20" y="13" width="8" height="13" rx="3" className="look-subject" />
    </svg>
  );
}

/** Drag-to-set dial for the light's angle (0–360). One gesture = one undo step. */
function AngleDial({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const set = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    let a = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (a < 0) a += 360;
    onChange(Math.round(e.shiftKey ? Math.round(a / 15) * 15 : a));
  };
  const rad = (value * Math.PI) / 180;
  return (
    <svg
      ref={ref}
      viewBox="-20 -20 40 40"
      className={`dial${disabled ? " disabled" : ""}`}
      onPointerDown={(e) => {
        if (disabled) return;
        (e.target as Element).setPointerCapture(e.pointerId);
        useStudio.getState().beginGesture();
        set(e);
      }}
      onPointerMove={(e) => e.buttons & 1 && !disabled && set(e)}
      onPointerUp={() => useStudio.getState().endGesture()}
      onPointerCancel={() => useStudio.getState().endGesture()}
    >
      <circle r="17" className="dial-ring" />
      <circle r="3" className="dial-subject" />
      <line x1="0" y1="0" x2={Math.sin(rad) * 15} y2={-Math.cos(rad) * 15} className="dial-hand" />
      <circle cx={Math.sin(rad) * 15} cy={-Math.cos(rad) * 15} r="3" className="dial-knob" />
    </svg>
  );
}

export function LightingControls({
  project,
  value,
  onPatch,
  overridden,
  disabled,
}: {
  project: Project;
  /** The effective lighting. */
  value: typeof LIGHTING_DEFAULTS;
  onPatch: (patch: Partial<Lighting>, remove?: (keyof Lighting)[]) => void;
  /** Fields set on this level (shown bold); others are inherited. */
  overridden?: Partial<Lighting>;
  disabled?: boolean;
}) {
  const mark = (k: keyof Lighting) => (overridden && k in overridden ? " set" : "");
  return (
    <div className="lighting">
      <div className="looks">
        {LOOKS.map((l) => (
          <button
            type="button"
            key={l.value}
            title={l.hint}
            disabled={disabled}
            className={`look${value.look === l.value ? " active" : ""}`}
            onClick={() => onPatch({ look: l.value })}
          >
            <LookGlyph look={l.value} />
            <span>{l.label}</span>
          </button>
        ))}
      </div>
      <Row label={<span className={`lbl${mark("angle")}`}>Angle</span>}>
        <div className="dial-row">
          <AngleDial value={value.angle} onChange={(angle) => onPatch({ angle })} disabled={disabled} />
          <span className="mono">{Math.round(value.angle)}°</span>
        </div>
      </Row>
      <Row label={<span className={`lbl${mark("elevation")}`}>Elevation</span>}>
        <NumberField value={value.elevation} min={0} max={80} unit="°" disabled={disabled} onChange={(elevation) => elevation !== undefined && onPatch({ elevation })} />
      </Row>
      <Row label={<span className={`lbl${mark("shadow")}`}>Shadow</span>}>
        <Segmented
          value={value.shadow}
          disabled={disabled}
          options={[
            { value: "contact", label: "Contact" },
            { value: "soft", label: "Soft" },
            { value: "none", label: "None" },
          ]}
          onChange={(shadow) => onPatch({ shadow })}
        />
      </Row>
      <Row label={<span className={`lbl${mark("brightness")}`}>Brightness</span>}>
        <NumberField
          value={value.brightness}
          min={-1}
          max={1}
          step={0.05}
          unit="EV"
          disabled={disabled}
          onChange={(brightness) => brightness !== undefined && onPatch({ brightness })}
        />
      </Row>
      <Row label={<span className={`lbl${mark("tint")}`}>Tint</span>}>
        <ColorTokenSelect
          project={project}
          value={value.tint}
          allowNone
          noneLabel="Neutral"
          disabled={disabled}
          onChange={(tint) => (tint ? onPatch({ tint }) : onPatch({}, ["tint"]))}
        />
      </Row>
    </div>
  );
}
