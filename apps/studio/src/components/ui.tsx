/** Small controls shared by the panels and inspectors. */
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
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

/** Below this much pointer travel a press is a click (focus and type), not a scrub. */
const DRAG_THRESHOLD_PX = 3;

/**
 * A number input. Typing commits on Enter/blur (one undo step). Dragging the field scrubs it as one
 * gesture (one undo step); a press that doesn't move focuses it for typing. With both `min` and
 * `max` it draws a fill track and a drag across the field's width sweeps the whole range (Alt for
 * fine); without, every 2px is one step (Shift ×10, Alt ×0.1). While focused, the arrow keys and
 * the wheel step by `step`. `range` shows the guide range muted and turns the field amber outside it.
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
  rangeLabel = true,
  track,
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
  /** Set false to keep the amber out-of-range warning but drop the "min–max" text under the field. */
  rangeLabel?: boolean;
  /** Set false to hide the fill track on a bounded field whose bounds are only sanity limits. */
  track?: boolean;
  unit?: string;
  disabled?: boolean;
  title?: string;
  width?: number;
}) {
  const shown = value === MIXED ? "" : value === undefined ? "" : fmt(value, step);
  const [text, setText] = useState(shown);
  const [focused, setFocused] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focused) setText(shown);
  }, [shown, focused]);

  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const tracked = track !== false && min !== undefined && max !== undefined && max > min;
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

  const stepBy = (n: number) => {
    const t = Number(text);
    const base = text.trim() !== "" && Number.isFinite(t) ? t : effective ?? 0;
    const v = clamp(Number((base + n * step).toFixed(6)));
    setText(fmt(v, step));
    onChange(v);
  };
  // The native wheel listener is attached once, so it reads the latest stepBy.
  const stepRef = useRef(stepBy);
  stepRef.current = stepBy;
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Only a focused field takes the wheel; otherwise it scrolls the panel as usual.
      if (document.activeElement !== el) return;
      const d = e.deltaY || e.deltaX;
      if (Math.abs(d) < 1) return;
      e.preventDefault();
      stepRef.current((d < 0 ? 1 : -1) * (e.shiftKey ? 10 : 1));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const scrub = useRef<{ x: number; v: number; w: number; active: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || focused || e.button !== 0) return;
    // Focus waits for the release, so a drag never drops a caret where it ended.
    e.preventDefault();
    scrub.current = { x: e.clientX, v: effective ?? 0, w: rootRef.current?.getBoundingClientRect().width ?? 0, active: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = scrub.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (!s.active) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
      s.active = true;
      setScrubbing(true);
      (document.activeElement as HTMLElement | null)?.blur?.();
      useStudio.getState().beginGesture();
    }
    let v: number;
    if (tracked && s.w > 0) {
      // The fill follows the pointer 1:1; values land on the step grid.
      const raw = s.v + ((dx * (e.altKey ? 0.1 : 1)) / s.w) * (max! - min!);
      v = clamp(Number((Math.round(raw / step) * step).toFixed(6)));
    } else {
      const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
      v = clamp(Number((s.v + Math.round(dx / 2) * step * mult).toFixed(6)));
    }
    if (v !== value) onChange(v);
  };
  const endScrub = (e: React.PointerEvent, cancelled: boolean) => {
    const s = scrub.current;
    scrub.current = null;
    if (!s) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (s.active) {
      setScrubbing(false);
      useStudio.getState().endGesture();
    } else if (!cancelled) inputRef.current?.focus();
  };

  const ratio = tracked && effective !== undefined ? Math.min(1, Math.max(0, (effective - min!) / (max! - min!))) : 0;

  return (
    <div
      ref={rootRef}
      className={`num${out ? " out" : ""}${disabled ? " disabled" : ""}${focused ? " focused" : ""}${scrubbing ? " scrubbing" : ""}`}
      title={title ?? (disabled ? undefined : "Drag to scrub, click to type")}
      style={width ? { width } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endScrub(e, false)}
      onPointerCancel={(e) => endScrub(e, true)}
    >
      {label !== undefined && <span className="num-label">{label}</span>}
      <input
        ref={inputRef}
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
            stepBy((e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1));
          }
        }}
      />
      {unit && <span className="num-unit">{unit}</span>}
      {tracked && (
        <span className="num-track" aria-hidden="true">
          <span className={`num-fill${value === undefined ? " inherited" : ""}`} style={{ width: `${(ratio * 100).toFixed(2)}%` }} />
        </span>
      )}
      {range && rangeLabel && (
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

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  /** Options sharing a group are listed under its heading, in the order given. */
  group?: string;
  /** Muted text after the label; also matched by search. */
  hint?: string;
  swatch?: string;
};

/** Past this many rows (entries plus group headings) the popover scrolls, so the list gets a search field. */
export const SEARCH_THRESHOLD = 11;

type Entry<T> = { value: T | undefined; label: string; group?: string; hint?: string; swatch?: string };

/**
 * A dropdown. Short lists open as a plain list; past SEARCH_THRESHOLD rows the trigger turns into
 * a search field while open (`searchable` forces either). `noneLabel` adds a first entry that
 * clears the value.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  disabled,
  placeholder,
  noneLabel,
  searchable,
}: {
  value: T | undefined | typeof MIXED;
  options: (T | SelectOption<T>)[];
  onChange: (v: T | undefined) => void;
  disabled?: boolean;
  placeholder?: string;
  noneLabel?: string;
  searchable?: boolean;
}) {
  const opts: Entry<T>[] = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  const swatches = opts.some((o) => o.swatch !== undefined);
  const entries: Entry<T>[] = noneLabel !== undefined ? [{ value: undefined, label: noneLabel }, ...opts] : opts;
  const rows = entries.length + new Set(entries.map((e) => e.group).filter(Boolean)).size;
  const search = searchable ?? rows > SEARCH_THRESHOLD;

  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [end, setEnd] = useState(false);
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Only the keyboard moves the list; hovering while wheel-scrolling must not yank it around.
  const scrollToHi = useRef(false);
  const refocus = useRef(false);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? entries.filter((e) => [e.label, e.hint, e.group].some((s) => s?.toLowerCase().includes(q)))
    : entries;
  const current = value === MIXED ? undefined : entries.find((e) => e.value === value);
  const display =
    value === MIXED ? "—" : current ? current.label : value !== undefined ? `${value} (missing)` : placeholder ?? "";

  const openList = () => {
    if (disabled) return;
    const r = rootRef.current?.getBoundingClientRect();
    setUp(!!r && window.innerHeight - r.bottom < 240 && r.top > window.innerHeight - r.bottom);
    // The popover can grow past the trigger; near the right edge it grows leftward instead.
    setEnd(!!r && r.left + 360 > window.innerWidth);
    setQuery("");
    setHi(Math.max(0, current ? entries.indexOf(current) : 0));
    scrollToHi.current = true;
    setOpen(true);
  };
  const close = (focusTrigger: boolean) => {
    refocus.current = focusTrigger;
    setOpen(false);
    setQuery("");
  };
  const choose = (e: Entry<T>) => {
    close(true);
    if (e.value !== value) onChange(e.value);
  };

  useEffect(() => {
    if (!open && refocus.current) {
      refocus.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open]);
  useEffect(() => {
    if (!scrollToHi.current) return;
    scrollToHi.current = false;
    listRef.current?.querySelector(`[data-i="${hi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hi, open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        openList();
      }
      return;
    }
    const n = filtered.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      scrollToHi.current = true;
      if (n) setHi((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[hi]) choose(filtered[hi]);
    } else if (e.key === "Escape") {
      // Closing the list must not also clear the canvas selection.
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") close(false);
  };

  const swatch = (e: Entry<T> | undefined) =>
    swatches && <span className="swatch" style={e?.swatch ? { background: e.swatch } : undefined} data-empty={!e?.swatch || undefined} />;

  return (
    <div className={`sel${open ? " open" : ""}${disabled ? " disabled" : ""}`} ref={rootRef}>
      {open && search ? (
        <div className="sel-trigger">
          <Icon name="search" size={12} />
          <input
            autoFocus
            className="sel-search"
            role="combobox"
            aria-expanded
            aria-autocomplete="list"
            value={query}
            placeholder={display || "Search…"}
            onChange={(e) => {
              setQuery(e.target.value);
              setHi(0);
              scrollToHi.current = true;
            }}
            onKeyDown={onKeyDown}
          />
        </div>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          className="sel-trigger"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => (open ? close(true) : openList())}
          onKeyDown={onKeyDown}
        >
          {swatch(current)}
          <span className={`sel-value${current || value === MIXED ? "" : " muted"}`}>{display}</span>
          <Icon name="chevronDown" size={12} />
        </button>
      )}
      {open && (
        <div className={`popover sel-pop${up ? " up" : ""}${end ? " end" : ""}`} role="listbox" ref={listRef}>
          {filtered.map((e, i) => (
            <Fragment key={e.value ?? ""}>
              {e.group && e.group !== filtered[i - 1]?.group && <div className="menu-label">{e.group}</div>}
              <button
                type="button"
                role="option"
                aria-selected={e === current}
                data-i={i}
                className={`sel-opt${e === current ? " sel" : ""}${i === hi ? " hi" : ""}`}
                // Keep focus in the search field until the click lands.
                onMouseDown={(ev) => ev.preventDefault()}
                onMouseMove={() => i !== hi && setHi(i)}
                onClick={() => choose(e)}
              >
                {swatch(e)}
                <span className="sel-opt-label">{e.label}</span>
                {e.hint && <span className="muted mono">{e.hint}</span>}
                {e === current && <Icon name="check" size={12} />}
              </button>
            </Fragment>
          ))}
          {!filtered.length && <div className="menu-note">No matches</div>}
        </div>
      )}
    </div>
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
  return (
    <Select
      value={value}
      options={project.brand.colors.map((c) => ({ value: c.name, label: c.name, hint: c.hex, swatch: c.hex }))}
      noneLabel={allowNone ? noneLabel : undefined}
      disabled={disabled}
      onChange={onChange}
    />
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
