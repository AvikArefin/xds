# UI: Studio's building blocks

The editor is built from a small set of shared components and one set of style tokens. **New UI
reuses them.** A panel row, a dropdown or a number field that is hand-built for one place
drifts from the others, in looks and in behavior. [Human interaction](./human-interaction.md)
says where things are on screen. This page says how each control is built and how it behaves.

Code: `apps/studio/src/components/ui.tsx` (the components) and `apps/studio/src/styles/`
(`app.css` tokens and shell, `controls.css`, `panels.css`, `canvas.css`).

---

## 1. Style tokens

All colors, radii and sizes are CSS variables on `:root` in `styles/app.css`. Use the variables,
never raw values.

| Token | Use |
| --- | --- |
| `--bg`, `--bg-panel`, `--bg-elev` | app, side panels, popovers and dialogs |
| `--bg-input`, `--bg-hover`, `--bg-active` | fields; hovered rows and buttons; the active segment |
| `--canvas-bg` | behind the slide |
| `--border`, `--border-strong` | dividers and fields; buttons and popovers |
| `--text`, `--text-dim`, `--text-muted` | primary, labels, hints and placeholders |
| `--accent`, `--accent-strong`, `--accent-soft` | focus and selection; primary buttons; selected rows |
| `--error`, `--warn`, `--info`, `--ok`, `--amber` | severities; `--amber` marks values outside a guide range |
| `--radius`, `--radius-sm` | buttons and popovers; fields and rows |
| `--font`, `--mono` | UI text (12 px base); ids, hex codes, paths |
| `--rail-w`, `--side-w`, `--insp-w` | the three sidebars' widths |

The UI is dense and dark on purpose: the slide is the only bright thing on screen.

---

## 2. Layout pieces

| Component | What it is |
| --- | --- |
| `Section` | a collapsible block with an uppercase title and optional header actions (e.g. **+**) |
| `Row` | a label column (72 px) and a control, with an optional muted `hint` under it |
| `.field-grid` | two controls side by side (e.g. Weight and Size) |
| `.panel-head` | a side panel's title row: uppercase title left, a muted count or action right |
| `.panel-foot` | the side panel's bottom actions (e.g. **+ Add model…**) |

## 3. List rows: `ListRow`

Every side-panel list (Layers, the Text / 2D / Background node lists, the 3D objects) is made of
`ListRow`s, so they all look and behave the same:

```text
⠿  Name                                  👁 🔓
│   │                                     └ actions: dim (25 %) until the row is hovered or selected
│   └ the label; struck through and muted when the thing is hidden
└ drag handle, when the list can be reordered
```

- **Drag to reorder.** `dragType` turns on the handle, and rows only accept drops of the same
  type, so a layer can't be dropped into a node list. Dropping onto a row moves the dragged item
  to that row's position.
- **Click** selects (`Shift + click` adds to the selection); a selected row has the
  `--accent-soft` background. `onDoubleClick` is free for "open this".
- **Actions** are `IconButton`s, `size={12}`. An action that is switched on (hidden, locked)
  uses `active`. Every action calls `stopPropagation()` so it doesn't also select the row.
- `NodeRow` is `ListRow` for a slide node, with the standard **hide** (saved, `hidden` in the
  file) and **lock** (editor only) actions.

## 4. Buttons

| Component / class | Use |
| --- | --- |
| `.btn` (`.small`, `.primary`, `.danger`, `.ghost`, `.block`) | text buttons; one `.primary` per area at most |
| `IconButton` | a 24 px square icon button with a `title` (also its accessible name); `active` for a toggled-on state |
| `Segmented` | a few mutually exclusive options shown at once (Fit, Align, Shadow) |
| `Menu` + `MenuItem` | an action menu from a trigger button (**+ Add model…**); `.menu-label` and `.menu-sep` group items |
| `.link-btn` | an inline text action in a header (rare) |

Icons come from `components/Icon.tsx` (Lucide). Add a name there; don't inline SVGs.

## 5. Fields

### 5.1 `Select`: every dropdown

One component for every pick-one-of-many, including brand colors (`ColorTokenSelect` is a
`Select` with swatches and hex codes) and the format picker.

- **Search past 11 rows.** A list that would scroll inside its popover (more than 11 rows,
  counting group headings) turns its box into a search field while open. Search matches the
  label, the hint and the group. Shorter lists open as plain lists. `searchable` forces either.
- Options can carry a `group` (shown as headings, in the order given), a muted `hint` and a
  `swatch`. `noneLabel` adds a first option that clears the value.
- The current value has a check mark. A value that isn't among the options shows as
  *value (missing)*. Mixed selections show `—`.
- Keyboard: `↑`/`↓` to open and move, `Enter` to pick, `Escape` to close (without clearing the
  canvas selection), `Tab` to leave.
- The popover opens upward near the bottom of the window, and grows to fit its labels (up to
  360 px), leftward near the right edge.

### 5.2 `NumberField`: every number

- **Drag** anywhere on the field to scrub (one undo step per drag). A **click** without dragging
  focuses it for typing. `Enter` or blur commits, `Escape` reverts, empty clears the override.
- **Bounded fields** (`min` and `max` both set) draw a **fill bar** along the bottom edge, and a
  drag across the field's width sweeps the whole range, so the fill follows the pointer (`Alt`
  for fine). Values snap to `step`. The bar is grey when the value is inherited (a placeholder).
  `track={false}` hides it where the bounds are only sanity limits (a format's width/height).
- **Unbounded fields** move one step per 2 px of drag (`Shift` ×10, `Alt` ×0.1).
- While focused, `↑`/`↓` and the **wheel** step by `step` (`Shift` ×10). The wheel only acts on a
  focused field, so scrolling a panel never changes a value.
- `range` is a **guide range**: the field turns `--amber` outside it, and the range shows in
  muted text below (`rangeLabel={false}` keeps the amber but drops the text).
- `label` (e.g. "W", "Weight") sits inside the field on the left. `unit` sits on the right.

### 5.3 Others

| Component | Use |
| --- | --- |
| `TextField` | text, single line or `multiline`; commits on blur (`Cmd/Ctrl + Enter` in multiline) |
| `Checkbox` | booleans; shows an indeterminate state for mixed selections |
| `MIXED` + `shared()` | a field shown for several selected items: `shared(items, get)` returns the common value or `MIXED` |

---

## 6. Conventions

- **Edits are undoable, one step per gesture.** A drag (scrub, gizmo, canvas move) is one undo
  step: wrap it in `beginGesture()` / `endGesture()`. A typed value is one step on commit.
- **View settings are not saved.** Zoom, guides, audit regions, snap, hidden layers and locks live in the store,
  outside undo, and never reach `project.json`. Say so in the control's `title`.
- **Read-only** (a project with structural errors) disables every editing control: pass
  `disabled={readOnly}`.
- **Every UI change updates [human interaction](./human-interaction.md)** (where it is on screen) and,
  for a new or changed building block, this page (how it is built).
