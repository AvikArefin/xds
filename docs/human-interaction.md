# Human interaction

What is where in the Studio editor, and what a person clicks, drags and types. How each control is
built and behaves (dropdowns, number fields, list rows) is in [UI](./ui.md).

```bash
xds open                          # the project browser
xds open ~/xd-projects/launch     # API :8765, Vite :5173, opens a browser tab
```

Headless commands (`xds audit`, `xds export`) run their own process and never disturb an open
editor.

---

## 1. Screen layout

```text
┌ SlideRail ┐┌──────── Stage ────────┐┌ Side panel ┐┌ Inspector ┐
│ slides    ││ mode switch · tools   ││ list of    ││ properties│
│ audit     ││ canvas                ││ this mode  ││ of the    │
│ format    ││              − 59% +  ││            ││ selection │
│ toolbar   ││                       ││ + add …    ││           │
└───────────┘└───────────────────────┘└────────────┘└───────────┘
 status bar: notices · saved/unsaved · format
```

| Area | Contents |
| --- | --- |
| **SlideRail** (left) | slides (click, drag to reorder, double-click the name to rename, `+`, duplicate, trash); **Audit** (counts, findings with a **Fix** link where the fix is one value, **Fix all on this slide**, an eye to hide or show them on the canvas, `Shift + A`); **Format** (preset or custom size); toolbar: Open, Search, Snapshots, Undo, Redo, Save |
| **Stage** (center) | the mode switch (Present, then the layers front → back); in 3D: Move/Rotate/Scale and World/Local; in layer modes: Snap and Guides (`G`). The canvas is the export's own renderer. Zoom floats at its bottom-right (click the % to fit). After an audit, findings are outlined on the canvas. |
| **Side panel** | Present: **Layers** and **Exports**. 3D: the slide's objects, **+ Add model…** (Library or From file), **+ Add shape…**. 2D: **+ New image…** (Library logos, the project's images, or **Shape…**: a drawn ornament). Text / 2D / Background: the layer's nodes and **+ New …** |
| **Inspector** (right) | Present: the brand (colors, type roles, default lighting). 3D: the object's pose and **Place on canvas**, the slide's Camera and Lighting. Other layers: the selected node's box, its **Layout** (pins, align to, stack, fit to text) and its layer's fields (Text adds **Wrap**). |

**Layers** (Present): drag a row onto another to move that layer there (saved). The eye hides a
layer on the canvas only, so you can work on what's under it; it is never saved, and exports
always include every layer. Double-click a row to edit that layer.

**Node rows**: drag to reorder, eye to hide (saved: left out of exports), lock to stop canvas
edits (editor only). A selected row adds bring forward, send backward and delete.

## 2. Modes

| Mode | Key | Edits |
| --- | --- | --- |
| **Present** | `1` | nothing on the canvas; the brand, layer order and exports |
| **Text** | `2` | `type` nodes |
| **2D** | `3` | `image` nodes |
| **3D** | `4` | `render` nodes, camera and lighting |
| **Background** | `5` | `ground` nodes |

Every layer is visible (unless hidden with its eye in Layers); the mode decides which one you can
edit, and the store rejects edits to any other.

## 3. Keyboard and mouse

Shortcuts are ignored while typing in a field.

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl + S` · `Z` · `Shift + Z` | save · undo · redo |
| `Cmd/Ctrl + K` · `O` | command palette · open project |
| `1`–`5` | switch mode |
| `A` · `Shift + A` · `G` | run audit · toggle audit regions · toggle guides |
| `Delete` / `Backspace` | delete the selection (respects locks) |
| `Shift + click` · marquee · `Cmd/Ctrl + A` | add to the selection · select by area · select all in the layer |
| `Cmd/Ctrl + D` | duplicate the selection; with nothing selected, the slide |
| `Cmd/Ctrl + C` · `V` | copy the selection (or, with nothing selected, the slide) · paste |
| arrows | nudge: 2D 1 px (`Shift`: `u`); 3D 1 cm (`Shift`: 10 cm) |
| `Escape` | close the palette or a list; clear the selection |
| drag a related block | edits its relation instead of its box: a stack's gap, a pin's or align's offset (whole units while Snap is on); a side the layout sizes snaps back |

3D viewport: **left-drag** orbits (`yaw`/`pitch`), **right-drag** moves the product on the canvas
(`x`/`y`), **scroll** resizes it (`height`), **`L` + drag** swings the light (`angle`/`elevation`),
the **gizmo** moves, rotates or scales the selected object on this slide. Clicking any part of a
model selects the whole model: parts, animation and device screens are set in the file by an
agent, and the editor keeps them as they are.

**Copy and paste** is the editor's own clipboard (not the system one; it empties when another
project opens). Pasted nodes land on the active slide **in the same place** as the originals, in
front, selected, and the editor switches to their layer. A stacked text block keeps its anchor when
the anchor was copied with it or is on that slide; otherwise it is released where it is. A 3D node
pasted onto a slide that already shows its object gets a copy of the object (one object appears at
most once per slide). A copied slide is pasted right after the active one, and **duplicate** (the
rail's copy icon, or `Cmd/Ctrl + D` with nothing selected) inserts a copy right after the
original. Copies never carry audit exceptions: audit them again.

With several 2D nodes selected, the inspector shows their shared values (`—` where they differ)
and the toolbar adds **Align** and **Distribute**. Selection survives edits, undo, save and
reloads from disk. Undo has one step per drag or field change.

## 4. Walkthroughs

- **New project**: `Cmd/Ctrl + O` → **New project** → name, folder, format → **Create**. (Terminal:
  `xds init ~/xd-projects/launch --name "Launch"`.) It starts with one slide on a `solid`
  background, a one-color brand, and an `AGENTS.md` for AI agents.
- **Restore**: the rail's clock icon (or `Cmd/Ctrl + O` → **Restore**) lists the project's
  snapshots, newest first: the ones you took (**Snapshot now…**, with a label), the ones taken
  automatically before a big save (a format change, a slide added or removed, more than a quarter
  of the nodes changed), the safety copy taken before every restore, and migrate backups.
  **Restore** replaces project.json, designs and screens on disk and reloads the editor; the state
  before is itself a snapshot, so a restore can be undone from the same list. Snapshots live in
  `.snapshots/`; the twenty newest automatic ones are kept, labelled ones until deleted.
  (Terminal: `xds snapshot . --label "…"`, `xds snapshot . --list`, `xds restore . ID`.)
- **Open a project**: `Cmd/Ctrl + O`, then a project or **Browse…**. One marked *needs migrate*
  opens on a **This project needs migrating** screen; **Migrate project** upgrades it and keeps a
  backup in `.migrate-backup/`.
- **Text**: declare a role in Present → Typography first (Font, Size range, Weight, Size, Color),
  then `2` → **+ New text…** → a role. Drag it, or type in the inspector; edges snap to the margin,
  the grid and other blocks. **Wrap**: Balance evens out a headline's lines, Pretty avoids a lone
  last word.
- **Pin and align**: the inspector's **Layout** section ties a block's box to something that
  survives a format change. **Pins** put an edge (or the center) on a line of the format: the
  margin, the safe zone, the canvas edge, the center or a third, plus an offset in units; pin
  both edges of an axis and the box is sized by them. **Align X / Y** shares an edge with another
  block (its left, center or right; top, middle or bottom), with an offset. **Stack** places the
  block a **Gap** in units *Below*, *Above*, *Right of* or *Left of* another block, ink to ink,
  so it follows that block's last line wherever it wraps. **Fit to text** (Text only) makes the
  box as tall as its lines. The canvas shows the selection's relations: a tick on the pinned
  line, a dotted line to the aligned edge, a line to the stack anchor with the gap. Dragging,
  nudging or typing a coordinate of a related block edits its gap or offset instead (whole units
  while Snap is on); a side the layout sizes snaps back. **Free** drops a relation and leaves the
  box where it is.
- **Background**: there is no page color. Each slide's back Background node covers the canvas, and
  new slides copy the previous slide's. To change it: `5`, select it, change its design or knobs.
  **+ New background…** adds a project design or a starter on top. The audit reports
  `UNCOVERED_CANVAS` if nothing covers the canvas.
- **Logo**: `3` → **+ New image…** → **Library** → a cortextech logo (`full-logomark` on dark
  backgrounds, `-white-bg` on white; always the full logo, on every slide). It's referenced, never copied, and
  arrives at its own aspect with Contain fit.
- **Ornaments**: `3` → **+ New image…** → **Shape…** → a star, sparkle, ring, rings, lens,
  ellipse, rectangle, line, plus, arc or grid (also **Add shape…** in the palette). It arrives as a
  6u square inside the margin with a 0.5u stroke in the slide's text color, drawn by the renderer
  (no file), and is placed, rotated, pinned and stacked like any 2D block. The **Shape** inspector
  sets the shape, the stroke width (in u) and color, the fill (Default, None or a brand color) and
  the shape's own knobs (points, count, spread, radius, angle, sweep). The audit's expression rules
  keep ornaments to one family and one stroke width per slide.
- **3D model**: `4` → **+ Add model…** → **Library** (iPhone 17 Pro, MacBook Pro 14″, referenced,
  never copied) or **From file…** (`.glb`, `.gltf`, `.dae`, or drop on the canvas). It arrives
  framed and lit. Right-drag and scroll to place it; the gizmo or pose fields tilt it on this
  slide only.
- **Two products in their own spots**: select each and tick **Place on canvas**, then set its X, Y
  and Height in % of the canvas. The camera keeps the view direction; rotation still applies.
- **Lighting**: usually nothing to do. 3D inspector → **Lighting**: Look (four thumbnails), Angle
  (dial), Elevation, Shadow, Brightness, Tint. **Use for all slides** makes it the project default.
- **Fonts**: Present → Typography header → download button → a Fontshare family. It's fetched once
  into the xds font library and shared by every project.
- **Format**: the rail's **Format** selector. Picking another preset (or typing a custom size)
  asks to **Reflow**: every box is laid out again relative to the new margins (images keep their
  aspect), px type sizes are rescaled to the new size bands, and scales, stack gaps, pins and the
  camera are kept. One undo step. Audit afterwards. (Terminal: `xds reflow . --format PRESET`,
  `--dry-run` to see what would move.)
- **Text size that holds in every format**: give a role (Present → Typography) or a text block a
  **Scale** instead of a px **Size**: 1.2 means 1.2 × the level's band default for whatever format
  the project is in. A px size wins over a scale on the same role or block.
- **Audit**: `A` or **Run audit** (saves first). Click a finding to select its node. A finding
  whose fix is one value (a position, a size, a gap, the camera height) shows **Fix**: one click
  applies it as one undo step, switches to the node's layer and selects it. **Fix all on this
  slide** applies every error's and warning's fix on the active slide (it asks first past five)
  and audits again; `info` findings are left to you. **Mark as intentional…** records an
  exception with your reason. (Terminal: `xds fix .`, see
  [design rules §6.1](./design-rules.md#61-applying-fixes).)
- **Export**: in the Present panel (`1`), **PNG** writes a PNG per slide and **PDF** the deck as
  one PDF, ready to upload as a LinkedIn carousel (a document post). Save first. Both are also
  in the command palette. It stops on open audit errors;
  **Export anyway** forces it and records that. Finished exports are listed in the Present panel.
- **Outside changes**: when an agent edits the files, the editor reloads at once. The file on disk
  is the truth, and unsaved editor edits are replaced (a notice says so).

## 5. Feedback

| Where | Shows |
| --- | --- |
| status bar | notices; Saved / Unsaved changes; the format and its unit `u` and margin `m` |
| rail | audit counts and findings; per-slide error/warning badges |
| canvas | audit regions, with the message and fix on hover |
| inspectors | amber fields outside their guide range, fill bars on bounded fields |
| whole window | the migrate screen for an older project |
| Present panel | export progress and finished files |

Closing the tab with unsaved edits asks first.
