# Working in this XDS project

This folder is an XDS project: social-media slides made of four layers (a 2D background, a 3D
product scene, images and text), rendered to PNG. You edit the files; the `xds` command renders,
checks, audits and exports them.

**Everything you need is in this file and in `xds` output.** Stay inside this project folder. Run
`xds` commands (all take `--json`), but never read or edit files outside the project. Device
models and fonts belong to xds and are referenced with `xds:` paths. You don't need to look at
them, and you must never copy them in.

If the XDS editor is open, it reloads your edits as soon as you save. The file on disk is the
truth.

---

## 1. Files

| Path | What it is |
| --- | --- |
| `project.json` | the whole design: format, brand, 3D objects, slides and their nodes |
| `designs/<id>.svg` | background designs (artwork plus their knobs), see §7 |
| `screens/<id>/index.html` | UI pages shown on device screens, see §6 |
| `assets/` | images, and 3D models you brought in yourself |
| `sources/` | yours: `.blend` files, scripts, originals. XDS ignores it |
| `cache/`, `export/`, `.migrate-backup/` | generated; never edit |

## 2. The loop

```bash
xds guide . --json      # the numbers for this format: margin, spacing unit, type sizes. Read first.
# edit project.json / designs / screens
xds check . --json      # fast: schema, references, designs, model parts (no browser)
xds render . --json     # slide PNGs + cache/<hash>/contact-sheet.png. Look at them.
xds audit . --json      # render + measure + design rules → findings, each with a `fix`
#   look at cache/<hash>/annotated/*.png
xds export . --json     # writes export/<stamp>/*.png (refuses while audit errors are open)
```

- Fix every audit **error**, then review the **warnings**. Ignore `info` until the slide is done.
- `xds rules` explains every rule and its principle; `xds formats` lists the formats.
- Don't add exceptions just to pass the audit. An exception needs a real artistic reason that a
  person would agree with: `"exceptions": [{ "rule": "RULE_ID", "reason": "…" }]` on the node
  (or on the slide for composition rules).

A finding looks like this. Apply its `fix` and audit again:

```json
{ "rule": "LOW_CONTRAST", "severity": "error", "slideId": "s2", "nodes": ["price"],
  "message": "'Price' reads at Lc 38 over the gradient; headline-sized text needs Lc ≥ 45.",
  "fix": "Set data.color to 'ink' (Lc 71 here), or move the block to y ≤ 40 %." }
```

## 3. Design rules of thumb

- **One message and one subject per slide.** One top-level text block; supporting text is
  clearly smaller.
- **Type sizes come from levels.** Every role belongs to a level: `display`, `headline`,
  `subhead`, `body` or `caption`. Each level has a size range for this format, and `xds guide`
  prints them. Start at the level's default and change it only for a reason. Two sizes on one
  slide should differ by at least 1.25×.
- **Spacing on the unit scale** (`u`, `2u`, `3u`, … from `xds guide`), and **content inside the
  margin `m`** and outside the platform's safe zones (also in `xds guide`).
- **Contrast**: text must stand out from whatever is behind it, at its weakest point.
- **Keep the background quiet** behind the text and the product. The product, not the
  background, should be the most eye-catching thing.

## 4. `project.json`

Unknown fields are rejected, so spell keys exactly as below (camelCase). `xds check` reports any
mistake with its JSON path.

### 4.1 Top level

```jsonc
{
  "schemaVersion": 2,
  "id": "launch",                    // [a-z0-9-]+
  "name": "Launch", "description": "",
  "format": { "preset": "instagram-portrait", "width": 1080, "height": 1350 },  // `xds formats`
  "brand": {
    "colors": [ { "name": "ink", "hex": "#16171a" }, { "name": "paper", "hex": "#f2f1ee" } ],
    "typography": { "headline": { "level": "headline", "font": "Satoshi", "weight": 700 } }
  },
  "fonts": [ … ],                    // written by `xds fonts fetch` (§8); don't hand-edit
  "assets": [ { "id": "hero", "path": "assets/hero.jpg", "kind": "image" } ],   // image | svg | model
  "screens": [ … ],                  // written by `xds screen add` (§6)
  "materials": [ { "id": "stone", "name": "Stone", "color": "#d8d4cc", "metalness": 0, "roughness": 0.9 } ],
  "objects": [ … ],                  // the 3D catalog (§5)
  "layerOrder": ["ground", "render", "image", "type"],   // back → front
  "lighting": { "look": "softbox" }, // project default; slides override fields (§5.5)
  "rules": { "set": { "wordsPerSlide": 50 }, "off": ["RULE_ID"] },   // audit tuning; rarely needed
  "slides": [ … ]                    // array order is slide order
}
```

Colors are referenced everywhere by token **name** (`"ink"`), never by hex.

### 4.2 Type roles (`brand.typography`)

A role is a named text style. Name roles for what they do (`kicker`, `headline`, `price`, `cta`).

```jsonc
"kicker": {
  "level": "caption",       // display | headline | subhead | body | caption: which size range applies
  "font": "Satoshi",        // a family in `fonts` (fetch it first, §8)
  "weight": 600,            // 100..900, default 400
  "size": 30,               // px; omit to use the level's default for this format
  "color": "accent",        // brand color token
  "lineHeight": 1.2, "letterSpacing": 0.08, "uppercase": true, "italic": false   // all optional
}
```

### 4.3 Slides

```jsonc
{ "id": "s1", "name": "Hero",
  "background": "paper",          // brand color token: the flat fill under every layer
  "lighting": { "angle": 210 },   // optional, overrides project.lighting field by field
  "camera": { "mode": "frame", "x": 50, "y": 58, "height": 50 },   // optional (§5.4)
  "nodes": [ … ],
  "exceptions": [] }
```

### 4.4 Nodes

Every node has `id` (unique in the project), `name`, `layer`, and optionally `hidden: true` and
`exceptions`. Within one layer, later nodes are in front. Layers stack by `layerOrder`.

The 2D layers have a **box**, in **percent of the format**, origin top-left, y down:
`{ "x": 5.93, "y": 4.74, "w": 60, "h": 18, "rotation": 0, "opacity": 1 }`. `xds guide --json`
gives the margin and unit as percentages too, so you don't need to convert.

```jsonc
// text
{ "id": "h1", "name": "Headline", "layer": "type",
  "box": { "x": 5.93, "y": 4.74, "w": 60, "h": 18 },
  "data": { "text": "Light that\nfollows you",   // "\n" forces a line break
            "role": "headline",
            "align": "left", "valign": "top",     // left|center|right, top|middle|bottom
            "group": "intro",                      // blocks that belong together (headline + subhead)
            // optional per-node overrides of the role:
            "color": "accent", "size": 64, "weight": 800, "italic": false,
            "lineHeight": 1.05, "letterSpacing": 0, "uppercase": false,
            "decorative": false } }               // true: graphic lettering, exempt from legibility rules

// image
{ "id": "photo", "name": "Photo", "layer": "image",
  "box": { "x": 0, "y": 50, "w": 100, "h": 50 },
  "data": { "asset": "hero", "fit": "cover" } }  // cover | contain | fill

// background (§7)
{ "id": "bg", "name": "Background", "layer": "ground",
  "box": { "x": 0, "y": 0, "w": 100, "h": 100 },
  "data": { "design": "sweep", "variant": "warm", "values": { "wall": "paper" } } }

// 3D: no box; the 3D layer covers the whole slide (§5)
{ "id": "laptop-s1", "name": "Laptop", "layer": "render",
  "data": { "object": "macbook-pro-14",
            "pose": { "position": [0, 0, 0], "rotation": [0, -20, 0], "scale": [1, 1, 1] },
            "parts": { "Lid": { "rotate": [40, 0, 0] } },
            "animation": { "clip": "Open", "time": 0.8 },      // only for animated models
            "screens": { "Screen": "dashboard" } } }
```

Text style is resolved as: node override → its role → the level's default for this format.

## 5. 3D

The 3D world is in **meters**, **Y up**, the floor is `y = 0`, and **+Z faces the camera** by
default. A pose is `{ "position": [x,y,z], "rotation": [x,y,z] (degrees), "scale": [x,y,z] }`.

### 5.1 Device models that ship with xds

```bash
xds model library        # each model, its screen size and its parts
```

| Library id | Model | Screen device preset | Parts |
| --- | --- | --- | --- |
| `iphone-17-pro` | iPhone 17 Pro, upright | `iphone-17-pro` (402 × 874 @3) | `Body`, `Display`, `Screen` |
| `macbook-pro-14` | MacBook Pro 14″, lid open ~110° | `macbook` (1512 × 982 @2) | `Base`, `Lid` (`rotateX` −25…110; 110 closes it), `Screen` |

```bash
xds model add . --library iphone-17-pro --slide s2 [--screen app-home]
```

This registers the model **by reference** (`"path": "xds:models/iphone-17-pro/model.glb"`),
adds the object and, with `--slide`, a render node. Never copy a library model into `assets/`.
Add a model once per project. On other slides, add a render node for the same object. Only if the
project has to be sent somewhere without xds, `xds model vendor . <asset-id>` copies it in.

### 5.2 Your own models

```bash
xds model inspect path/to/thing.glb --json   # parts, clips, screen meshes, convention warnings
xds model add . path/to/thing.glb --id bottle --name "Bottle" --slide s1   # also .gltf and .dae
```

`add` converts `.gltf`/`.dae` to `.glb`, checks it, copies it to `assets/models/<id>.glb`, adds
the object, and with `--slide` a render node. Re-run it with `--replace` to swap the file and
keep the poses. Make models to these conventions (the inspect warnings name any break):

- real-world **meters**; **Y-up** on export; **origin at the bottom center**, resting on the floor;
- **transforms applied** (rotation and scale identity); **front faces +Z** (Blender −Y);
- **Principled BSDF** materials only (bake procedural ones); **textures packed** in the GLB, ≤ 2048 px;
- ≤ 20 MB and ≤ 500 k triangles;
- **moving parts** are separate, uniquely named objects, with each origin on its joint (a lid's
  origin on its hinge). Optional limits as a custom property exported with `export_extras=True`:
  `xds.limits = {"rotateX": [-110, 0]}`;
- a **device screen** is its own mesh named `Screen`, with UVs filling 0–1 the right way up.

Blender export, run from this folder (keep `.blend` files and scripts in `sources/`):

```bash
blender -b sources/bottle.blend --python-expr "
import bpy
bpy.ops.export_scene.gltf(filepath='sources/bottle.glb', export_format='GLB', export_yup=True,
    export_apply=True, export_texcoords=True, export_normals=True, export_materials='EXPORT',
    export_extras=True, use_selection=False)"
```

### 5.3 Objects, primitives and posing

`objects` is the project's 3D catalog. A render node shows one object on one slide.

```jsonc
{ "id": "bottle", "name": "Bottle", "kind": "model", "asset": "bottle", "pose": { … } }
// primitives (no asset; optional `material` from `materials`), standing on their origin:
{ "id": "podium", "name": "Podium", "kind": "cylinder",
  "params": { "radius": 0.18, "height": 0.08 }, "material": "stone", "pose": { … } }
```

Primitive params: `box` width/height/depth · `sphere` radius · `cylinder` radius (or
radiusTop/radiusBottom), height · `torus` radius, tube · `plane` width/height. To stand a product
on a podium, set the product's `position[1]` to the podium's height.

On a render node, `pose` overrides the object's pose for that slide only. `parts` articulates a
multi-part model **relative to its rest pose** (`[0,0,0]` is as modeled): `rotate` in degrees
about the part's own pivot, `move` in meters, `hidden`. `animation` freezes a glTF clip at `time`
seconds. `xds model inspect` lists the parts, limits and clips, and `xds check` rejects unknown
parts and out-of-limit poses. The editor never changes parts; that is your job.

### 5.4 Camera

Framing is automatic. Usually you only say where the product sits on the slide:

```jsonc
"camera": { "mode": "frame", "x": 64, "y": 58, "height": 50, "yaw": 25, "pitch": 12, "fov": 30 }
// product center at (x, y) % of the canvas, product height = 50 % of the canvas height,
// seen from 25° to the right and 12° above, 30° lens (all but `mode` optional)
```

"Move it to the right third and make it smaller" is `x: 67, height: 45`. For a shot that frame
mode can't express, use `{ "mode": "free", "position": [x,y,z], "target": [x,y,z], "fov": 30 }`.

### 5.5 Lighting

Lighting is automatic, studio-style, and works at any model size. You only choose a character:

| Field | Values | Default |
| --- | --- | --- |
| `look` | `softbox` (anything) · `contrast` (premium, glass, metal) · `rim` (dark product on a dark background) · `bright` (white products, high-key) | `softbox` |
| `angle` | 0–360°, swings the key light around the product | 35 |
| `elevation` | 0–80° | 30 |
| `shadow` | `contact` · `soft` · `none` | `contact` |
| `brightness` | −1…+1 stops | 0 |
| `tint` | brand color token, tints the reflections | none |

The audit checks the lit product (clipped highlights, crushed shadows, separation from the
background), and its fixes name the knob to change.

## 6. Device screens: an app UI on the phone or laptop

```bash
xds screen add . app-home --device iphone-17-pro    # 1. creates screens/app-home/index.html
# 2. write the UI in screens/app-home/index.html
xds screen render . app-home                         # 3. look at the PNG it prints
xds model add . --library iphone-17-pro --slide s2 --screen app-home   # 4. the phone, showing it
xds render .                                         # 5. look at the slide
```

On a later slide, show another screen on the same phone with a new render node:
`"data": { "object": "iphone-17-pro", "screens": { "Screen": "settings" } }`. For the laptop, use
`--device macbook` and `--library macbook-pro-14`. Other presets: `iphone` (393 × 852),
`iphone-max` (430 × 932), `android` (412 × 915), `ipad` (820 × 1180), `desktop` (1440 × 900), or
`--width W --height H --scale S`. Use the preset the model names (`xds model library`); otherwise
`xds check` reports `SCREEN_ASPECT_MISMATCH`.

**Toolkit** (no build step, works offline):

- **Tailwind CSS v4** utility classes;
- **Basecoat UI** components: shadcn-style buttons, cards, inputs, tabs, badges and tables as
  plain HTML + Tailwind (`class="btn"`, `class="btn-icon-outline"`, `class="card"`, …);
- **Lucide** icons as `<i data-lucide="bell"></i>`;
- the project's fonts, with `font-sans` / `--font-sans` set to the body role's font.

The page gets the CSS variables `--safe-top/right/bottom/left` and `data-device` on `<html>`.
`<xds-include src="status-bar"></xds-include>` (and `home-indicator`) includes
`screens/<id>/partials/<name>.html`. Network requests are blocked, so use only local files.

**Rules for convincing UI**:

- Design at the **logical size** (402 px wide for the iPhone 17 Pro), with the real type scale:
  body 15–17 px, titles 28–34 px, tap targets ≥ 44 px.
- **Real content**: plausible names, numbers, dates and copy that tell the slide's story. Never
  lorem ipsum.
- Keep the **status bar and home indicator** from the starter, and respect the safe area.
- **One clear state**: one primary action, a visible hierarchy, brand colors for accents only.
- **Large and simple**: on the slide the screen is small, so prefer big numbers, big titles and
  few rows. The audit warns `SCREEN_DETAIL_TOO_SMALL`.

## 7. Backgrounds (ground designs)

Start from a starter and set its knobs on the ground node:

```bash
xds design add . sweep      # also: spotlight, aurora, grain-solid, split-tone, vignette-dark
```

A design is one SVG file. Its knobs are JSON in `<metadata id="xds-design">`, and the artwork
uses `{{ … }}` placeholders:

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="{{width}}" height="{{height}}" viewBox="0 0 {{width}} {{height}}">
  <metadata id="xds-design">{
    "name": "Glow",
    "params": [
      { "name": "wall", "type": "color", "label": "Wall", "default": "paper" },
      { "name": "glow", "type": "number", "default": 0.2, "min": 0, "max": 0.5, "step": 0.01 }
    ],
    "variants": [ { "name": "dark", "values": { "wall": "ink" } } ]
  }</metadata>
  <rect width="{{width}}" height="{{height}}" fill="{{wall}}"/>
  <ellipse cx="{{subject.cx}}" cy="{{subject.cy}}" rx="{{width * 0.4}}" ry="{{height * 0.3}}"
           fill="{{alpha(tone(wall, 0.98), glow)}}"/>
</svg>
```

- **Param types**: `number` (min/max/step), `color` (a hex or a brand token), `select`
  (`options`), `boolean`, `text`. Param names must not be a variable
  (`width`, `height`, `subject`, `brand`, `n`) or a function name below.
- **Variables**: `width`, `height` (canvas px); `subject.x/y/w/h/cx/cy` (the product's on-screen
  bounds) and `subject.floor` (the y of the floor under it), so the set follows the product;
  `brand.<token>`.
- **Expressions**: numbers, names, `+ - * / %`, parentheses, one comparison, and functions. Math:
  `min max clamp round floor ceil abs sin cos sqrt pow lerp cond(test, a, b)` (no `?:`, no `^`).
  Color, in OKLCH: `tone(color, lightness, chroma?)`, `shade(color, deltaL)`, `mix(a, b, t)`,
  `alpha(color, a)`, `hue(color, degrees)`.
- **Loops**: `data-xds-repeat="i" data-xds-count="{{expr}}"` repeats an element (i = 0…n−1).
- Techniques that work:
  - a vertical gradient **sweep** with its horizon at `subject.floor`;
  - a soft **spotlight** centered on `subject.cx/cy`;
  - a light **vignette**;
  - **tonal** walls (`tone(accent, 0.94, 0.03)`);
  - `feTurbulence` **grain** at 3–6 % to stop banding.

  The product's shadow falls onto the background.

`xds check` reports bad manifests, unknown names and wrong values.

## 8. Fonts

```bash
xds fonts fetch . "General Sans"    # any Fontshare family
```

This downloads the family once into xds's shared font library and registers its styles in
`fonts` with `xds:fonts/…` paths. Roles can then use it. Don't put font files in the project
yourself. `xds fonts library` lists the families already available offline.

## 9. Don'ts

- Don't edit `cache/`, `export/` or `.migrate-backup/`, and don't hand-edit the `fonts` or
  `screens` entries. Use the commands.
- Don't copy device models or fonts into the project, and don't leave this folder.
- Don't move the product by editing the background, or the other way round: designs follow
  `subject.*`.
- Don't use lorem ipsum, and don't add exceptions just to pass the audit.
