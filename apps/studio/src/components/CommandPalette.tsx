import { useEffect, useMemo, useRef, useState } from "react";
import type { Lighting } from "@xds/protocol";
import { api } from "../api";
import { SHAPES, SHAPE_LABELS } from "../stage/shapes";
import { useStudio } from "../store";
import { addStarterBackground, applyLayout } from "./commands";

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void | Promise<void>;
  /** Opens a second list instead of running. */
  sub?: () => Promise<Command[]> | Command[];
}

function baseCommands(): Command[] {
  const st = useStudio.getState();
  const p = st.project;
  const cmds: Command[] = [
    { id: "open", label: "Open project…", hint: "⌘O", run: () => st.setProjectBrowser("open") },
    { id: "new", label: "New project…", run: () => st.setProjectBrowser("new") },
    { id: "restore", label: "Restore a snapshot…", hint: "snapshots of big saves", run: () => st.setProjectBrowser("restore") },
    { id: "snapshot", label: "Snapshot now…", run: () => st.setProjectBrowser("restore") },
    { id: "add-slide", label: "Add slide", run: () => st.addSlide() },
    { id: "duplicate-slide", label: "Duplicate slide", hint: "⌘D with nothing selected", run: () => st.duplicateSlide(st.activeSlideId) },
    { id: "copy", label: "Copy", hint: "⌘C · the selection, or the slide", run: () => st.copy() },
    { id: "paste", label: "Paste", hint: "⌘V · in the same place", run: () => st.paste() },
    { id: "group-column", label: "Group as column", hint: "⌘G", run: () => st.groupSelection("column") },
    { id: "group-row", label: "Group as row", run: () => st.groupSelection("row") },
    {
      id: "ungroup",
      label: "Ungroup",
      hint: "⇧⌘G",
      run: () => st.ungroupSelection(),
    },
    { id: "make-master", label: "Show the selected block on every slide (master)", run: () => st.selectedIds[0] && void st.makeMaster(st.selectedIds[0]) },
    { id: "save", label: "Save", hint: "⌘S", run: () => void st.save() },
    { id: "audit", label: "Run audit", hint: "A", run: () => void st.runAudit() },
    { id: "export", label: "Export PNG", run: () => void st.exportSlides("png") },
    { id: "export-pdf", label: "Export PDF", run: () => void st.exportSlides("pdf") },
    { id: "guides", label: "Toggle guides", hint: "G", run: () => st.toggleGuides() },
    { id: "audit-regions", label: "Toggle audit regions", hint: "⇧A", run: () => st.toggleAudit() },
    { id: "mode-present", label: "Switch to Present", hint: "1", run: () => st.setMode("present") },
    { id: "mode-type", label: "Switch to Text", hint: "2", run: () => st.setMode("type") },
    { id: "mode-image", label: "Switch to 2D", hint: "3", run: () => st.setMode("image") },
    { id: "mode-render", label: "Switch to 3D", hint: "4", run: () => st.setMode("render") },
    { id: "mode-ground", label: "Switch to Background", hint: "5", run: () => st.setMode("ground") },
    {
      id: "look",
      label: "Apply lighting look…",
      run: () => {},
      sub: () =>
        (["softbox", "contrast", "rim", "bright"] as NonNullable<Lighting["look"]>[]).map((look) => ({
          id: `look-${look}`,
          label: look[0].toUpperCase() + look.slice(1),
          hint: "this slide",
          run: () => useStudio.getState().patchLighting({ look }),
        })),
    },
    {
      id: "shape",
      label: "Add shape…",
      hint: "an ornament on the 2D layer",
      run: () => {},
      sub: () =>
        SHAPES.map((shape) => ({
          id: `shape-${shape}`,
          label: SHAPE_LABELS[shape],
          hint: shape,
          run: () => {
            useStudio.getState().setMode("image");
            useStudio.getState().addShapeNode(shape);
          },
        })),
    },
    {
      id: "layout",
      label: "Apply layout…",
      hint: "a slide layout from the library",
      run: () => {},
      sub: async () => {
        let layouts: { id: string; name: string; intent: string }[] = [];
        try {
          layouts = (await api.layouts()).layouts;
        } catch {
          /* offline */
        }
        return layouts.map((l) => ({
          id: `layout-${l.id}`,
          label: l.name,
          hint: l.intent,
          run: () => {},
          sub: () => [
            { id: `layout-${l.id}-fill`, label: "Fill this slide", hint: "re-place its text by level, keep the words", run: () => applyLayout(l.id, "fill") },
            { id: `layout-${l.id}-replace`, label: "Replace this slide's text and 2D", hint: "the background and 3D stay", run: () => applyLayout(l.id, "replace") },
            { id: `layout-${l.id}-new`, label: "New slide after this one", run: () => applyLayout(l.id, "new") },
          ],
        }));
      },
    },
    {
      id: "design",
      label: "Add background design…",
      run: () => {},
      sub: async () => {
        const s = useStudio.getState();
        const own = Object.keys(s.designs).map((id) => ({
          id: `design-${id}`,
          label: id,
          hint: "project design",
          run: () => {
            useStudio.getState().setMode("ground");
            useStudio.getState().addBackground(id);
          },
        }));
        let starters: string[] = [];
        try {
          starters = (await api.starters()).designs;
        } catch {
          /* offline */
        }
        return [
          ...own,
          ...starters.map((name) => ({ id: `starter-${name}`, label: name, hint: "starter", run: () => void addStarterBackground(name) })),
        ];
      },
    },
  ];
  p?.slides.forEach((s, i) =>
    cmds.push({ id: `slide-${s.id}`, label: `Go to slide ${i + 1}`, hint: s.name ?? s.id, run: () => st.setActiveSlide(s.id) }),
  );
  return cmds;
}

export function CommandPalette() {
  const open = useStudio((s) => s.commandPaletteOpen);
  const setPalette = useStudio((s) => s.setPalette);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [sub, setSub] = useState<{ title: string; items: Command[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setSub(null);
      setTimeout(() => inputRef.current?.focus());
    }
  }, [open]);

  const items = useMemo(() => {
    if (!open) return [];
    const all = sub ? sub.items : baseCommands();
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((c) => terms.every((t) => `${c.label} ${c.hint ?? ""}`.toLowerCase().includes(t)));
  }, [open, q, sub]);

  if (!open) return null;

  const run = async (c: Command | undefined) => {
    if (!c) return;
    if (c.sub) {
      const list = await c.sub();
      setSub({ title: c.label, items: list });
      setQ("");
      setSel(0);
      inputRef.current?.focus();
      return;
    }
    setPalette(false);
    await c.run();
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setPalette(false)}>
      <div className="palette" role="dialog" aria-label="Command palette">
        {sub && <div className="palette-crumb">{sub.title}</div>}
        <input
          ref={inputRef}
          autoFocus
          className="palette-input"
          placeholder={sub ? "Filter…" : "Type a command…"}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(items.length - 1, s + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              void run(items[sel]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              if (sub) setSub(null);
              else setPalette(false);
            } else if (e.key === "Backspace" && !q && sub) setSub(null);
          }}
        />
        <ul className="palette-list">
          {items.map((c, i) => (
            <li
              key={c.id}
              className={i === sel ? "sel" : ""}
              onMouseEnter={() => setSel(i)}
              onClick={() => void run(c)}
            >
              <span>
                {c.label}
                {c.sub ? " ›" : ""}
              </span>
              {c.hint && <span className="muted">{c.hint}</span>}
            </li>
          ))}
          {!items.length && <li className="muted">No matching command.</li>}
        </ul>
      </div>
    </div>
  );
}
