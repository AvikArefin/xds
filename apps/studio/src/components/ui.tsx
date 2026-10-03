/** Small controls shared by the panels and inspectors. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Project } from "@xds/protocol";
import { useStudio } from "../store";
import { Icon, type IconName } from "./Icon";

export const MIXED = Symbol("mixed");
export type Maybe<T> = T | undefined | typeof MIXED;

export function IconButton({
  icon,
  title,
  onClick,
  active,
  disabled,
  className,
  size,
}: {
  icon: IconName;
  title: string;
  onClick?: (e: React.MouseEvent) => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  size?: number;
}) {
  return (
    <button
      type="button"
      className={`icon-btn${active ? " active" : ""}${className ? ` ${className}` : ""}`}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

export function Section({
  title,
  children,
  actions,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="section">
      <header className="section-head">
        <button type="button" className="section-toggle" onClick={() => setOpen(!open)}>
          <Icon name={open ? "chevronDown" : "chevronRight"} size={12} />
          <span>{title}</span>
        </button>
        <div className="section-actions">{actions}</div>
      </header>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

export function Row({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="row">
      <label className="row-label">{label}</label>
      <div className="row-control">{children}</div>
      {hint !== undefined && <span className="row-hint">{hint}</span>}
    </div>
  );
}

const fmt = (v: number, step: number) => {
  const d = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)));
  return String(Number(v.toFixed(d)));
};

/**
 * A number input with a scrubbable label. Typing commits on Enter/blur (one undo step); dragging
 * the label is one gesture (one undo step). `range` shows the guide range muted and turns the field
 * amber outside it.
 */
export function NumberField({
  label,
  value,
  placeholder,
  onChange,
  step = 1,
  min,
  max,
  range,
  unit,
  disabled,
  title,
  width,
}: {
  label?: ReactNode;
  value: Maybe<number>;
  placeholder?: number | string;
  onChange: (v: number | undefined) => void;
  step?: number;
  min?: number;
  max?: number;
  range?: [number, number];
  unit?: string;
  disabled?: boolean;
  title?: string;
  width?: number;
}) {
  const shown = value === MIXED ? "" : value === undefined ? "" : fmt(value, step);
  const [text, setText] = useState(shown);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(shown);
  }, [shown, focused]);

  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const commitText = () => {
    const t = text.trim();
    if (t === "") {
      if (value !== undefined && value !== MIXED) onChange(undefined);
      return;
    }
    const v = Number(t);
    if (Number.isFinite(v)) {
      const c = clamp(v);
      if (c !== value) onChange(c);
      setText(fmt(c, step));
    } else setText(shown);
  };

  const effective =
    value === MIXED ? undefined : value ?? (typeof placeholder === "number" ? placeholder : undefined);
  const out = range && effective !== undefined && (effective < range[0] - 1e-9 || effective > range[1] + 1e-9);

  const scrub = useRef<{ x: number; v: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || e.button !== 0) return;
    const start = effective ?? 0;
    scrub.current = { x: e.clientX, v: start };
    (e.target as Element).setPointerCapture(e.pointerId);
    useStudio.getState().beginGesture();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = scrub.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) < 2) return;
    const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    const v = clamp(Number((s.v + Math.round(dx / 2) * step * mult).toFixed(6)));
    onChange(v);
  };
  const onPointerUp = () => {
    if (!scrub.current) return;
    scrub.current = null;
    useStudio.getState().endGesture();
  };

  return (
    <div className={`num${out ? " out" : ""}${disabled ? " disabled" : ""}`} title={title} style={width ? { width } : undefined}>
      {label !== undefined && (
        <span
          className="num-label"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {label}
        </span>
      )}
      <input
        type="text"
        inputMode="decimal"
        value={text}
        disabled={disabled}
        placeholder={value === MIXED ? "—" : placeholder !== undefined ? String(typeof placeholder === "number" ? fmt(placeholder, step) : placeholder) : ""}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => {
          setFocused(true);
          e.target.select();
        }}
        onBlur={() => {
          setFocused(false);
          commitText();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          else if (e.key === "Escape") {
            setText(shown);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const base = Number(text) || effective || 0;
            const v = clamp(base + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
            setText(fmt(v, step));
            onChange(v);
          }
        }}
      />
      {unit && <span className="num-unit">{unit}</span>}
      {range && (
        <span className="num-range" title="Guide range for this format">
          {fmt(range[0], step)}–{fmt(range[1], step)}
        </span>
      )}
    </div>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  multiline,
  disabled,
  mixed,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  disabled?: boolean;
  mixed?: boolean;
}) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value);
  }, [value, focused]);
  const commit = () => {
    setFocused(false);
    if (text !== value) onChange(text);
  };
  const common = {
    value: text,
    disabled,
    placeholder: mixed ? "—" : placeholder,
    onFocus: () => setFocused(true),
    onBlur: commit,
  };
  if (multiline)
    return (
      <textarea
        className="text-input"
        rows={3}
        {...common}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur();
          if (e.key === "Escape") {
            setText(value);
            setTimeout(() => (e.target as HTMLTextAreaElement).blur());
          }
        }}
      />
    );
  return (
    <input
      className="text-input"
      type="text"
      {...common}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setText(value);
          setTimeout(() => (e.target as HTMLInputElement).blur());
        }
      }}
    />
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  disabled,
  placeholder,
}: {
  value: T | undefined | typeof MIXED;
  options: (T | { value: T; label: string })[];
  onChange: (v: T | undefined) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const opts = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  const v = value === MIXED ? "__mixed" : value ?? "";
  return (
    <select
      className="select"
      value={v}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === "" ? undefined : (e.target.value as T))}
    >
      {value === MIXED && <option value="__mixed">—</option>}
      {(placeholder !== undefined || value === undefined) && <option value="">{placeholder ?? ""}</option>}
      {opts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean | typeof MIXED;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={checked === true}
        ref={(el) => {
          if (el) el.indeterminate = checked === MIXED;
        }}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label && <span>{label}</span>}
    </label>
  );
}

/** Pick a brand color token (swatches + name). `allowNone` adds an "inherit" option. */
export function ColorTokenSelect({
  project,
  value,
  onChange,
  allowNone,
  noneLabel = "Default",
  disabled,
}: {
  project: Project;
  value: string | undefined | typeof MIXED;
  onChange: (v: string | undefined) => void;
  allowNone?: boolean;
  noneLabel?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  const cur = value === MIXED ? undefined : project.brand.colors.find((c) => c.name === value);
  return (
    <div className="token-select" ref={ref}>
      <button type="button" className="token-current" disabled={disabled} onClick={() => setOpen(!open)}>
        <span className="swatch" style={{ background: cur?.hex ?? "transparent" }} data-empty={!cur || undefined} />
        <span className="token-name">{value === MIXED ? "—" : cur?.name ?? (value ? `${value} (missing)` : noneLabel)}</span>
        <Icon name="chevronDown" size={12} />
      </button>
      {open && (
        <div className="popover token-pop">
          {allowNone && (
            <button
              type="button"
              className="token-opt"
              onClick={() => {
                onChange(undefined);
                setOpen(false);
              }}
            >
              <span className="swatch" data-empty />
              <span>{noneLabel}</span>
            </button>
          )}
          {project.brand.colors.map((c) => (
            <button
              type="button"
              key={c.name}
              className={`token-opt${c.name === value ? " sel" : ""}`}
              onClick={() => {
                onChange(c.name);
                setOpen(false);
              }}
            >
              <span className="swatch" style={{ background: c.hex }} />
              <span>{c.name}</span>
              <span className="muted mono">{c.hex}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A segmented control. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T | undefined;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="segmented" role="group">
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          title={o.title}
          disabled={disabled}
          className={o.value === value ? "active" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A dropdown menu anchored to a trigger button. */
export function Menu({
  trigger,
  children,
  align = "left",
}: {
  trigger: (open: () => void) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="menu-anchor" ref={ref}>
      {trigger(() => setOpen((o) => !o))}
      {open && <div className={`popover menu ${align}`}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

export function MenuItem({ children, onClick, disabled, hint }: { children: ReactNode; onClick: () => void; disabled?: boolean; hint?: ReactNode }) {
  return (
    <button type="button" className="menu-item" disabled={disabled} onClick={onClick}>
      <span>{children}</span>
      {hint && <span className="muted">{hint}</span>}
    </button>
  );
}

/** Helper: the shared value of a field across several items, or MIXED. */
export function shared<T, V>(items: T[], get: (t: T) => V): V | typeof MIXED | undefined {
  if (!items.length) return undefined;
  const first = get(items[0]);
  for (const it of items) if (JSON.stringify(get(it)) !== JSON.stringify(first)) return MIXED;
  return first;
}
