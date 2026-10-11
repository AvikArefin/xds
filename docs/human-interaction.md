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
| **SlideRail** (left) | slides (click, drag to reorder, double-click the name to rename, `+`, duplicate, trash); **Audit** (counts, findings, an eye to hide or show them on the canvas, `Shift + A`); **Format** (preset or custom size); toolbar: Open, Search, Undo, Redo, Save |
| **Stage** (center) | the mode switch (Present, then the layers front → back); in 3D: Move/Rotate/Scale and World/Local; in layer modes: Snap and Guides (`G`). The canvas is the export's own renderer. Zoom floats at its bottom-right (click the % to fit). After an audit, findings are outlined on the canvas. |
| **Side panel** | Present: **Layers** and **Exports**. 3D: the slide's objects, **+ Add model…** (Library or From file), **+ Add shape…**. 2D: **+ New image…** (Library logos or the project's images). Text / 2D / Background: the layer's nodes and **+ New …** |
| **Inspector** (right) | Present: the brand (colors, type roles, default lighting). 3D: the object's pose and **Place on canvas**, the slide's Camera and Lighting. Other layers: the selected node's box and its layer's fields (Text adds **Wrap** and **Stack**). |

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
- **Open a project**: `Cmd/Ctrl + O`, then a project or **Browse…**. One marked *needs migrate*
  opens on a **This project needs migrating** screen; **Migrate project** upgrades it and keeps a
  backup in `.migrate-backup/`.
- **Text**: declare a role in Present → Typography first (Font, Size range, Weight, Size, Color),
  then `2` → **+ New text…** → a role. Drag it, or type in the inspector; edges snap to the margin,
  the grid and other blocks. **Wrap**: Balance evens out a headline's lines, Pretty avoids a lone
  last word.
- **Stack text**: Text inspector → **Stack** → *Below …* (or *Above …*) another block, and a
  **Gap** in units. The block then follows that block's last line wherever it wraps. Dragging it
  up or down, nudging it or typing its Y changes the gap instead (whole units while Snap is on).
  **Free (box Y)** releases it where it is.
- **Background**: there is no page color. Each slide's back Background node covers the canvas, and
  new slides copy the previous slide's. To change it: `5`, select it, change its design or knobs.
  **+ New background…** adds a project design or a starter on top. The audit reports
  `UNCOVERED_CANVAS` if nothing covers the canvas.
- **Logo**: `3` → **+ New image…** → **Library** → a cortextech logo (`full-logomark` on dark
  backgrounds, `-white-bg` on white; always the full logo, on every slide). It's referenced, never copied, and
  arrives at its own aspect with Contain fit.
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
- **Format**: the rail's **Format** selector. Boxes are percentages, so the layout reflows; audit
  afterwards.
- **Audit**: `A` or **Run audit** (saves first). Click a finding to select its node. **Mark as
  intentional…** records an exception with your reason.
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
