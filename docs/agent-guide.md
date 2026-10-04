# Agent guide

This page is for an LLM agent (or a person working like one) building slides without the
editor. Everything here goes through files and the `xds` CLI. Every command takes `--json`.

---

## 1. The loop

```text
xds guide PROJECT --json      know the numbers for this format before designing
edit project.json             (and designs/*.svg, assets/)
xds check PROJECT --json      fast: schema, references, design manifests; no browser
xds audit PROJECT --json      render + measure + rules → findings with fixes
  look at cache/<hash>/annotated/*.png and contact-sheet.png
  apply each finding's `fix`, or record a deliberate exception with a reason
repeat until no errors, then review the warnings
xds export PROJECT --json     writes export/<stamp>/*.png
```

Rules of the road:

- Read [design rules](./design-rules.md) once. `xds guide` gives the numbers, and `xds rules`
  gives every rule's principle.
- Pick type sizes from the band defaults first. Change them only for a reason.
- Put spacing on the unit scale (`u`, `2u`, `3u`, …) and content inside the margin.
- One message per slide: one top-level text block, one subject.
- Don't write exceptions to make the audit pass. An exception needs a real artistic reason,
  in words a person would agree with.
- If the editor is open, it reloads your edits immediately. The file is the truth, and unsaved
  editor edits are replaced (see [dataflow §2](./dataflow.md#2-input-an-agent-editing-files)).

---

## 2. Editing `project.json`

The full schema is in [data models](./data-models.md). The most common edits:

```jsonc
// a headline, top-left inside the margin of a 1080×1350 post (m = 64 px ≈ 5.93 %)
{ "id": "h1", "name": "Headline", "layer": "type",
  "box": { "x": 5.93, "y": 4.74, "w": 60, "h": 18 },
  "data": { "text": "Light that\nfollows you", "role": "headline", "group": "intro" } }

// the product, on the right third, a bit smaller
"camera": { "mode": "frame", "x": 64, "y": 58, "height": 50 }

// darker, more dramatic light for this slide only
"lighting": { "look": "rim", "angle": 210 }
```

`box` values are percentages of the format. `xds guide --json` also gives the margin and unit
as percentages, so you don't have to convert by hand.

---

## 3. Bringing in a 3D model

The app knows nothing about Blender. At runtime it loads only **binary glTF (`.glb`)** files.
`xds model add` also accepts `.gltf` and `.dae` and converts them to `.glb` on import (§3.3).
Blender is just one convenient way to make models. This section is the contract between the
modeling tool and the app.

### 3.0 Library models: devices that ship with xds

xds ships ready-made device models. They already follow the conventions below, their screen mesh
is named `Screen`, and each declares the screen size that fits it. **A project references a
library model; it never copies it**, so every project shows the same device and the files stay
with xds.

```bash
uv run xds model library            # what ships, with each model's screen device preset
```

| Library id | Model | Screen device preset | Parts |
| --- | --- | --- | --- |
| `iphone-17-pro` | iPhone 17 Pro, upright | `iphone-17-pro` (402 × 874 @3) | `Body`, `Display`, `Screen` |
| `macbook-pro-14` | MacBook Pro 14″ (M5), lid open ~110° | `macbook` (1512 × 982 @2) | `Base`, `Lid` (`rotateX` −25…110, 110 closes it), `Screen` |

`xds model add PROJECT --library ID --slide S [--screen SCREEN]` registers
`{ "path": "xds:models/<id>/model.glb" }`: an `xds:` path resolves inside the xds install, not the
project. Everything else (poses, `parts`, `screens`, the audit) works exactly as for a project
model. To send a project somewhere without xds, `xds model vendor PROJECT ASSET_ID` copies the file
into `assets/models/` and repoints the asset. In the studio, **Add model… → Library** does the same
as `--library`.

The library models are built from their raw downloads by `scripts/build_library_models.py`
(Blender), which splits out and orients the screen, grounds and centers the model, names and pivots
moving parts, and compresses it. New library models go through the same script.

### 3.1 Conventions for the model

| Convention | Why |
| --- | --- |
| **Real-world meters** (a 33 cl can is about 0.115 m tall) | the auto-camera and shadows scale with bounds; wrong units still work but trigger a size warning |
| **Y-up** on export (Blender's glTF exporter does this by default with `export_yup=True`) | the app's floor is `y = 0` |
| **Origin at the bottom center**, resting on the floor (Blender: object sits on `z = 0`, origin at its base) | placing the object at `[0,0,0]` stands it on the floor, and the contact shadow touches it |
| **Apply all transforms** before export (rotation and scale = identity) | poses in `project.json` start from a clean state |
| **Principled BSDF materials only**: base color, metallic, roughness, normal, emission, alpha, transmission | these map 1:1 to glTF PBR; procedural node trees do not export and must be **baked** to textures |
| **Textures packed** into the GLB, ≤ 2048 px | one file, no missing textures |
| **Reasonable size**: ≤ 20 MB, ≤ 500 k triangles | quick to load in the editor and the headless render |
| **Front of the product faces +Z** (Blender −Y) | the default camera (`yaw 25`) then sees the front three-quarter |
| **Moving parts are separate, named objects, parented in a hierarchy, with each origin on its joint** (a lid's origin on its hinge line) | `parts` rotates a node about its own origin; a wrong origin swings the part around the wrong point |
| **Optional joint limits** as custom properties on the part, exported with `export_extras=True`: `xds.limits = {"rotateX": [-110, 0]}` | the gate rejects poses outside the limits (`PART_OUT_OF_RANGE`) |
| **A device screen is its own mesh named `Screen`** (or `Screen.*`), with UVs filling 0–1 the right way up and the display's aspect ratio | a [screen](#4-device-screens) is mapped onto it as a texture |

### 3.2 Exporting headlessly from Blender

```bash
blender -b sources/bottle.blend --python-expr "
import bpy
bpy.ops.export_scene.gltf(
    filepath='sources/bottle.glb', export_format='GLB',
    export_yup=True, export_apply=True, export_texcoords=True, export_normals=True,
    export_materials='EXPORT', export_extras=True, use_selection=False)
"
```

Keep `.blend` files and scripts in the project's `sources/` folder (ignored by the app) or
anywhere outside the project.

Optional compression with **glTF-Transform**, which the app's loader decodes:

```bash
npx @gltf-transform/cli optimize sources/bottle.glb sources/bottle.opt.glb --compress meshopt --texture-compress webp
```

### 3.3 Wiring it into the project

```bash
uv run xds model add ~/xd-projects/launch sources/bottle.glb --id bottle --name "Bottle" --slide s1
```

This one command:

0. **converts** the file if needed. It keeps the original in `sources/`:
   - `.gltf` (+ `.bin` + textures) is packed into one `.glb` with `@gltf-transform/cli copy`, which
     changes nothing else;
   - `.dae` (Collada) is loaded in the headless browser with three's `ColladaLoader`, which applies
     the file's up-axis and unit, and saved with `GLTFExporter`. Collada's older Phong/Lambert
     materials are approximated as PBR, and the command reports `MODEL_MATERIALS_APPROXIMATED`. If
     the result looks wrong, re-export from the source tool as glTF;
1. **inspects** the GLB (`xds/models3d.py`, standard library only: it reads the GLB header and
   JSON chunk): glTF 2.0, required extensions supported, bounds from the `POSITION` accessors'
   `min`/`max`;
2. **warns** about convention breaks: `MODEL_UNITS_SUSPECT` (bounds < 1 cm or > 10 m),
   `MODEL_NOT_GROUNDED` (min y not ≈ 0), `MODEL_OFF_CENTER` (x/z center far from the origin),
   `MODEL_HEAVY` (size or triangle count), `MODEL_UNSUPPORTED_EXTENSION`,
   `MODEL_DUPLICATE_PART_NAMES` (parts must have unique names to be addressable);
3. **copies** it to `assets/models/bottle.glb` and registers
   `{ "id": "bottle", "path": "assets/models/bottle.glb", "kind": "model" }`;
4. **adds** the catalog object `{ "id": "bottle", "kind": "model", "asset": "bottle", "pose": identity }`;
5. with `--slide`, **adds** a render node to that slide. With the default auto-camera and
   lighting, the product is already framed and lit.

`xds model inspect FILE --json` runs steps 0–2 without changing the project. It also lists the
model's **parts** (the node tree with names, pivots and limits), its **animation clips** with
durations, and any **screen meshes** with their aspect ratio and a recommended screen size.
To replace a model, re-run `add` with the same `--id` and `--replace`. Poses and render nodes are
kept.

Doing the same by hand (copy the file, add the asset, object and render node to `project.json`)
is equally valid. `xds check` will report anything missing.

### 3.4 Primitives

For simple set pieces (podium, plinth, floor disc), use primitives instead of a model:

```json
{ "id": "podium", "name": "Podium", "kind": "cylinder",
  "params": { "radiusTop": 0.18, "radiusBottom": 0.18, "height": 0.08 },
  "material": "matte-stone", "pose": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] } }
```

Stand the product on it by setting the product's pose `position[1]` to the podium height.

### 3.5 Posing a multi-part model

Only you (the agent) articulate parts. The editor moves the model only as a whole: move, rotate,
scale, and the camera. Write the parts on the render node of the slide:

```json
{ "id": "laptop-s1", "name": "Laptop", "layer": "render",
  "data": { "object": "macbook",
            "pose": { "position": [0, 0, 0], "rotation": [0, -20, 0], "scale": [1, 1, 1] },
            "parts": { "Lid": { "rotate": [-15, 0, 0] } } } }
```

`rotate` and `move` are **relative to the part's rest pose**: `[0,0,0]` is the pose as modeled.
For rigged or animated models, `"animation": { "clip": "Open", "time": 0.8 }` freezes a clip at a
moment instead. `xds check` reports unknown part names, unknown clips and limit violations.

---

## 4. Device screens

Device models (a phone, a laptop) are fixed assets. The UI on their screens is a small HTML page
that you write. XDS renders the page to an image and maps it onto the device's `Screen` mesh, unlit,
so the colors stay exact.

### 4.0 Recipe: an app UI on the iPhone (or MacBook)

```bash
P=~/xd-projects/launch
uv run xds screen add $P app-home --device iphone-17-pro        # 1. the screen page, sized for the model
#                                                                 2. write screens/app-home/index.html (§4.3–4.4)
uv run xds screen render $P app-home                             # 3. look at it flat
uv run xds model add $P --library iphone-17-pro --slide s2 --screen app-home   # 4. the phone, showing it
uv run xds render $P                                             # 5. look at the slide
```

Step 4 adds the render node `{ "object": "iphone-17-pro", "screens": { "Screen": "app-home" } }`.
The phone is added once per project; on later slides, add another render node for the same object
with a different screen. For the laptop use `--device macbook` and `--library macbook-pro-14`.
A product shot and an app shot are just different slides: one slide's render node shows the
product model, the next shows the phone.

### 4.1 Create a screen

```bash
uv run xds screen add ~/xd-projects/launch app-home --device iphone   # or: --width 393 --height 852 --scale 3
```

This creates `screens/app-home/index.html` from the starter and registers it in `project.screens`.
The `--device` presets set the logical size, scale and safe area:

| Device preset | Logical size | Scale | Safe area (top / bottom) |
| --- | --- | --- | --- |
| `iphone` (6.1″ Pro) | 393 × 852 | 3 | 59 / 34 |
| `iphone-17-pro` (library model) | 402 × 874 | 3 | 62 / 34 |
| `iphone-max` | 430 × 932 | 3 | 59 / 34 |
| `android` | 412 × 915 | 2.625 | 24 / 24 |
| `ipad` | 820 × 1180 | 2 | 24 / 20 |
| `macbook` (14″) | 1512 × 982 | 2 | 32 (menu bar) / 0 |
| `desktop` | 1440 × 900 | 2 | 0 / 0 |

Treat these as starting values and check them against the device model you were given.
`xds model inspect` prints the screen mesh's aspect ratio, and `xds check` reports
`SCREEN_ASPECT_MISMATCH` when the screen's size doesn't match it.

### 4.2 Put it on a device

```json
"data": { "object": "iphone", "screens": { "Screen": "app-home" } }
```

Different slides can show different screens on the same device.

### 4.3 Writing the UI: toolkit

Screens are plain HTML, rendered offline. No React and no build step to set up. The toolkit is
provided by the workspace and compiled by `xds` at render time:

| Library | Why |
| --- | --- |
| **Tailwind CSS v4** | utility classes; only the classes you use are compiled |
| **Basecoat UI** | shadcn/ui-style components (buttons, cards, inputs, tabs, badges, tables) as plain HTML + Tailwind, no React |
| **Lucide icons** (`lucide-static`) | write `<i data-lucide="bell"></i>`; replaced with the inline SVG at render time |
| Project `fonts/` | the brand fonts, so the UI matches the slide's type |

The page receives CSS variables `--safe-top/right/bottom/left` from the screen's `safeArea`, and
`data-device="iphone"` on `<html>`. `--font-sans` is the project's body-role font. Partials are
included with `<xds-include src="status-bar"></xds-include>`, which is replaced with
`screens/<id>/partials/status-bar.html` (falling back to the starter's copy). `/fonts/...` and
relative URLs resolve inside the project; any other network request is blocked, so a screen
renders the same offline.

A mesh counts as a screen when its name, before any `.suffix`, ends in "screen" (`Screen`,
`Screen.001`, `CoverScreen`). It needs UVs (`TEXCOORD_0`); `xds model inspect` warns
`MODEL_SCREEN_NO_UV` when they are missing.

### 4.4 Rules for convincing UI

- **Design at the logical size** (393 px wide for a phone), not the texture size. Use the device's
  real type scale: phone body 15–17 px, titles 28–34 px, tap targets ≥ 44 px.
- **Use real content.** Plausible names, numbers, dates and copy that tell the slide's story, never
  lorem ipsum. The UI is part of the message.
- **Include the system chrome**: the starter has a status bar (time, signal, battery) and a home
  indicator partial. Respect `--safe-top`/`--safe-bottom`.
- **One clear screen state**: one primary action, a visible hierarchy, and brand colors for the
  accents only.
- **Large and simple beats dense.** On the slide, the phone screen is maybe 25 % of the canvas
  width, so 13 px UI text becomes tiny. Prefer big numbers, big titles and few rows. `xds audit`
  warns with `SCREEN_DETAIL_TOO_SMALL` when the screen's body text ends up below the readable size
  on the slide.
- Check it flat first: `xds screen render PROJECT app-home` writes the PNG so you can look at it
  before checking it on the device with `xds audit`.

---

## 5. Backgrounds

Start from a starter design (`xds design add PROJECT sweep`) and set its params on the ground
node. Use the techniques in [lighting and backgrounds §3](./lighting-and-backgrounds.md#3-backgrounds-ground-designs).
Designs can follow the product through the `subject.*` variables, so after moving the product
you do not need to edit the background.

---

## 6. Reading a finding

```json
{ "rule": "LOW_CONTRAST", "severity": "error", "slideId": "s2", "nodes": ["price"],
  "message": "'Price' reads at Lc 38 over the gradient; headline-sized text needs Lc ≥ 45.",
  "measured": { "lc": 38.2, "displayedPx": 25 }, "expected": { "lcMin": 45 },
  "fix": "Set data.color to 'ink' (Lc 71 here), or move the block to y ≤ 40 % where the wall is lighter.",
  "principle": "Text must stand out from the pixels behind it, at its weakest point." }
```

Apply the fix and re-run `xds audit`. Don't chase `info` findings unless the slide is otherwise
done.
