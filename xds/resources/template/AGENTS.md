# Working in this XDS project

This folder is an XDS project: social-media slides made of four layers (a 2D background, a 3D
product scene, images and text), rendered to PNG. You edit the files; the `xds` command renders,
checks, audits and exports them.

**Everything you need is in this file and in `xds` output.** Stay inside this project folder. Run
`xds` commands (all take `--json`), but never read or edit files outside the project. Device
models, the brand logos and fonts belong to xds and are referenced with `xds:` paths. You don't
need to look at them, and you must never copy them in.

If the XDS editor is open, it reloads your edits as soon as you save. The file on disk is the
truth.

---

## Before you start: settle the brief

A question asked up front costs one message; a wrong guess costs several render rounds. Read the
brief once for these gaps and ask about all of them **in one message**, each with your default
answer so a quick "yes" is enough:

- **Where it's shown, and which way up.** That picks the format preset (`xds formats`), which sets
  the type sizes and contrast the audit expects. An aspect ratio alone is ambiguous: "4:3" may be
  1440 × 1080 landscape or 1080 × 1440 portrait (`instagram-portrait-3x4`).
- **Compositions you can't picture with certainty** ("the products looking outwards from the
  viewer", "the phone in front of the door"): ask for a 10-second sketch or a reference image.
- **The copy.** If you're asked to write lines, offer a few options per slide and ask which lines
  they love and which they hate before you lay them out.
- **Real material** (§3, §6): what the product is made of, ideally a photo, and real photos for
  anything a screen shows (a doorbell's camera view needs a real porch photo, not a stock cat).

## 1. Files

| Path | What it is |
| --- | --- |
| `project.json` | the whole design: format, brand, 3D objects, slides and their nodes |
| `designs/<id>.svg` | background designs (artwork plus their knobs), see §7 |
| `screens/<id>/index.html` | UI pages shown on device screens, see §6 |
| `assets/` | images, and 3D models you brought in yourself |
| `sources/` | yours: `.blend` files, scripts, originals. XDS ignores it |
| `cache/`, `export/`, `.migrate-backup/`, `.snapshots/` | generated; never edit (`.snapshots/` holds restorable copies: `xds snapshot . --list`) |

## 2. The loop

```bash
xds guide . --json      # the numbers for this format: margin, spacing unit, type sizes. Read first.
xds layout list --json  # slide layouts written in relations (no coordinates); `xds layout show ID` for one
xds layout apply . ID --mode new --json   # a slide after the first from it (fill: re-place your text by level)
# edit project.json / designs / screens
xds check . --json      # fast: schema, references, designs, model parts (no browser)
xds measure . --json    # seconds, no 3D: where each text block lands (lines, heights, stacks) + text checks
xds render . --json     # slide PNGs + cache/<hash>/contact-sheet.png. Look at them.
xds audit . --json      # render + measure + design rules → findings, each with a `fix`
#   look at cache/<hash>/annotated/*.png
xds fix . --json        # apply the findings' structured fixes (`edits`: positions, sizes, gaps, camera); --dry-run to look first
xds export . --json     # writes export/<stamp>/*.png (refuses while audit errors are open)
xds export . --pdf --json   # the deck as one PDF instead, a page per slide (LinkedIn carousel)
xds export . --format PRESET --json   # the same deck in another format (export/<stamp>-<preset>/; the source is untouched)
xds reflow . --check --json           # how the deck survives other orientations; fix a class with a node's variants.<class>
xds snapshot . --label "before the rewrite" --json   # a restorable copy of the sources (.snapshots/)
xds restore . ID --json     # put one back; the state before is snapshotted first
```

- Fix every audit **error**, then review the **warnings**. Ignore `info` until the slide is done.
- A clean audit is not a realistic product. Its product checks only catch clipped highlights,
  crushed shadows and a silhouette lost in the background; a flat, washed-out or plastic-looking
  product passes. Judge the 3D by eye: crop the product and compare it with a photo of the real one.
- When tuning a product's look, render one slide at a time (`xds render . --slide s2 --json`) and
  change one knob per render, so you can see what each change does.
- **Don't guess where text wraps.** Fonts differ in width (a wide display face wraps much earlier
  than you'd think). `xds measure` lays out the text alone, without the 3D or backgrounds, and
  reports each block's real lines, its ink top and bottom, the `box.h` it needs (`fitH`), widows,
  and the text-only audit findings. Get the text right with it, then render. Stack blocks
  (§4.4) instead of computing y positions.
- `xds grid . FILE` writes a copy of an image (a photo, a rendered slide) with a labeled % grid, so
  you can read positions off it: where the cat is in a camera frame, where the product's edge is.
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
- **Contrast**: text must stand out from whatever is behind it, at its weakest point. The minimum
  (APCA Lc) depends on the text's **size**, not its role: `xds guide` prints the size cutoffs in
  this format's px (on a 1440 × 1080 custom size: above 24 px Lc 45, 16–24 px Lc 60, below 16 px
  Lc 75). Exactly 24 px is still in the 16–24 band. `xds measure` shows each block's minimum.
- **Keep the background quiet** behind the text and the product. The product, not the
  background, should be the most eye-catching thing.
- **Ask what the product is made of** before you set its materials: which parts are metal,
  plastic, 3D-printed, rubber, glass, and their colors. Better, ask for a photo of the real thing.
  Don't infer materials from a marketing render, which may show a similar product, not this one.

## 4. `project.json`

Unknown fields are rejected, so spell keys exactly as below (camelCase). `xds check` reports any
mistake with its JSON path.

### 4.1 Top level

```jsonc
{
  "schemaVersion": 3,
  "id": "launch",                    // [a-z0-9-]+
  "name": "Launch", "description": "",
  "format": { "preset": "instagram-portrait", "width": 1080, "height": 1350 },  // `xds formats`;
                                     // no preset: a custom size shown 1:1 (`xds init --size 1440x1080`)
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
  "lineHeight": 1.2, "letterSpacing": 0.08, "uppercase": true, "italic": false,  // all optional
  "wrap": "pretty"          // normal | balance (even line lengths: headlines) | pretty (no lone last word)
}
```

`"wrap": "balance"` on headline roles and `"pretty"` on body roles prevent most `WIDOW` findings
without hand-placed `\n`.

### 4.3 Slides

```jsonc
{ "id": "s1", "name": "Hero",
  "lighting": { "angle": 210 },   // optional, overrides project.lighting field by field
  "camera": { "mode": "frame", "x": 50, "y": 58, "height": 50 },   // optional (§5.4)
  "nodes": [ … ],
  "exceptions": [] }
```

There is **no page color**. Every slide's first ground node is a full-canvas background
(`box` 0/0/100/100, unrotated, opaque) that paints every pixel; for a plain color that's the
`solid` design: `"data": { "design": "solid", "values": { "color": "paper" } }`. The audit reports
`UNCOVERED_CANVAS` for a slide without one.

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
            "lineHeight": 1.05, "letterSpacing": 0, "uppercase": false, "wrap": "balance",
            "decorative": false } }               // true: graphic lettering, exempt from legibility rules

// text stacked under another block: no y to calculate
{ "id": "sub", "name": "Subhead", "layer": "type",
  "box": { "x": 5.93, "y": 0, "w": 60, "h": 12 },  // y is ignored while stacked
  "data": { "text": "…", "role": "subhead", "group": "intro",
            "stack": { "below": "h1", "gap": 3 } } }  // 3u under h1's ink; or "above": "h1"

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

**Stacking.** `"stack": { "below": "h1", "gap": 3 }` puts the block's first line `gap` units (u)
under the last line of `h1`, measured ink to ink, the same way the audit measures spacing. The
renderer places it after laying out the text, so when `h1` wraps to another line or its font
changes, everything stacked under it moves with it. Chain them (kicker → headline → body), anchor
to an image node (its box) or stack `"above"` a block (a kicker over a bottom-aligned headline).
While stacked, `box.y` is ignored (the editor keeps it in step); `box.x`, `w` and `h` still apply.
Keep stacked blocks unrotated, and `h` at least `fitH` from `xds measure`.

### 4.5 The logo (cortextech)

These slides are cortextech's. **Every slide shows the full cortextech logo**: the mark and the
wordmark together, as **one image**, small, in a corner, inside the margin, in the same place on
every slide. The logo is always one of these files that ship with xds, never an image you make,
trace, redraw or recolor:

| Logo id | Size (w × h) | Use |
| --- | --- | --- |
| `cortextech/full-logomark` | 4419 × 983 | for **dark** backgrounds: white wordmark, transparent |
| `cortextech/full-logomark-white-bg` | 4419 × 983 | for **white or light** backgrounds: black wordmark, transparent |

Never show the mark and the name separately: no mark-only logo, and no "cortextech" typed as a
text node next to (or instead of) the logo. The full logo already contains the name.

```bash
xds logo library                                  # the same list, plus the brand color
xds logo add . cortextech/full-logomark           # registers asset "cortextech-full-logomark"
```

`xds logo add` registers the logo **by reference** (`"kind": "svg", "path":
"xds:brands/cortextech/full-logomark.svg"`). Place it on every slide with an image node, a box
with the logo's aspect (4.5 : 1) and `"fit": "contain"`:

```jsonc
{ "id": "logo-s1", "name": "Logo", "layer": "image",
  "box": { "x": 5.93, "y": 91.3, "w": 22, "h": 3.9 },  // 1080 × 1350: 22% = 238 px wide; 238 / 4.5 = 53 px = 3.9% tall
  "data": { "asset": "cortextech-full-logomark", "fit": "contain" } }
```

Pick the variant by what is behind it: `full-logomark` on dark or saturated backgrounds,
`full-logomark-white-bg` on white or light ones. Both are transparent. The logo's blue is `#4266AF`;
add it to `brand.colors` only if the design uses it.

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
keep the poses.

**Check the size it prints against the real product.** A model exported in the wrong units (a
6.6 m doorbell), with its origin in the middle, or facing backwards makes every pose and framing
a calculation. Fix the file once instead of compensating on every slide:

```bash
xds model add . sources/doorbell.glb --id doorbell --height 0.16 --front back   # also --replace
```

`--height` scales it to that real height in meters (or `--scale F`), `--front` names where its
front faces now (`back`, `left`, `right`, `up`, `down`) and turns it to face +Z, and either one
also puts the origin at the bottom center, on the floor (`--ground` does only that). Ask for the
real dimensions if you don't know them. Make models to these conventions (the inspect warnings
name any break):

- real-world **meters**; **Y-up** on export; **origin at the bottom center**, resting on the floor;
- **transforms applied** (rotation and scale identity); **front faces +Z** (Blender −Y);
- **Principled BSDF** materials only (bake procedural ones); **textures packed** in the GLB, ≤ 2048 px;
- ≤ 20 MB and ≤ 500 k triangles;
- **moving parts** are separate, uniquely named objects, with each origin on its joint (a lid's
  origin on its hinge). Optional limits as a custom property exported with `export_extras=True`:
  `xds.limits = {"rotateX": [-110, 0]}`;
- a **device screen** is its own mesh named `Screen`, with UVs filling 0–1 the right way up.

**Materials render exactly as exported.** xds only strips lights and cameras from the GLB, so all
the realism has to be in the file:

- `metallic` is **1 for metal, 0 for everything else** (plastic, 3D prints, rubber, silicone).
  In-between values look like neither.
- **Metal shows only what it reflects** (§5.5): its base color is the color of its reflections.
  Very dark metal reflecting a dark-gray studio reads as a flat hole. Give black anodized metal a
  charcoal base color (around linear 0.2) with roughness around 0.5.
- **Black plastic** stays near black (linear around 0.02). A gray base color reads as gray, not
  black. Its shape comes from a low-ish roughness (around 0.3), so faces facing the light pick up
  a sheen.

**CAD exports** (STEP/URDF/STL turned into GLB) are built for manufacturing, not rendering, and
need preparing in Blender before they look real:

- **Merge by distance first.** CAD meshes often come unwelded, every face a separate island, and
  nothing else (bevels, smooth shading, finding parts) works until they're welded.
- **Split parts that need different materials.** A CAD link often fuses a servo into its bracket,
  or discs into a base plate, in one mesh with one material. Separate them, or assign
  materials per face.
- **Round the hard edges** (a Bevel modifier of about 0.5 mm at real scale, limited by angle,
  with harden normals) and add **surface detail** (UVs plus a fine normal or roughness texture).
  Razor-sharp, perfectly smooth surfaces are what make a part look "rendered", and dark parts
  suffer most. Export with `export_apply=True` so the bevel is baked in.

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

**Two or more products, each in its own spot** (a phone bottom left, the doorbell top right):
give each render node a `place`, in canvas percent like the frame camera:

```jsonc
"camera": { "mode": "frame", "yaw": -20, "pitch": 5 },          // only the view direction and lens
"nodes": [
  { "id": "phone-s1", "layer": "render", "data": { "object": "iphone-17-pro",
    "place": { "x": 30, "y": 60, "height": 70 } } },             // center (x, y) %, 70 % tall
  { "id": "bell-s1", "layer": "render", "data": { "object": "doorbell",
    "place": { "x": 74, "y": 38, "height": 45 } } } ]
```

Each placed object is scaled and moved so its silhouette's bounding box lands there, in one shared
perspective. `pose.rotation` still turns it; `pose.position` and `pose.scale` are replaced by the
place. Nodes without `place` are framed by `camera.x/y/height` as usual. No free camera and no
hand-worked field of view, scale or positions.

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

**How the light works**, so you can predict a change instead of guessing:

- **The product is lit only by a studio environment**: the look's softboxes around a gray sphere.
  There is no direct light, so **the product never shadows itself**. Parts don't cast shadows on
  each other and recesses don't get darker. `shadow` only draws on the floor. Detailed
  assemblies look flatter than in a photo; choose a look and angle that light the faces
  differently, and keep any shading the model can carry (§5.2).
- **Reflections show that studio, not your slide.** The background design is never reflected.
  Each look's environment is a fixed gray: `rim` 0.24, `contrast` 0.30, `softbox` 0.42,
  `bright` 0.62. On a dark set, metal under `bright` reflects a light-gray room, so it looks
  washed out and pasted in. Prefer `contrast` (its two vertical strip lights draw crisp edge
  highlights) or `rim`.
- **`angle` is in world space, with the same convention as the camera's `yaw`.** `angle` equal to
  the camera's `yaw` puts the key at the camera. It does not follow the camera: with `yaw: -55`,
  the default `angle: 35` lights the product from 90° to the side. Work out the key relative to
  `yaw`.
- **`brightness` is exposure** (×2^brightness on the whole image). It brightens highlights and
  shadows together and never adds shape. Don't raise it to rescue a flat or dark product; fix
  the material, the look or the angle.

## 6. Device screens: an app UI on the phone or laptop

```bash
xds screen add . app-home --device iphone-17-pro    # 1. creates screens/app-home/index.html
# 2. write the UI in screens/app-home/index.html
xds screen render . app-home                         # 3. look at the PNG it prints
xds model add . --library iphone-17-pro --slide s2 --screen app-home   # 4. the phone, showing it
xds render .                                         # 5. look at the slide
```

**A phone on its side** (a camera view, a video): make a landscape page instead of rotating the
HTML inside a portrait one.

```bash
xds screen add . porch-cam --device iphone-17-pro --landscape   # 874 × 402, its top on the left
```

Design the page upright at 874 × 402, then turn the phone with `"pose": { "rotation": [0, 0, 90] }`
(`--landscape right` for the other way round, with rotation z = −90). The safe area moves to the
sides (the Dynamic Island) and the bottom; iOS shows no status bar in landscape.

**Pictures inside a screen** (a camera frame with detection boxes around the visitors): put the
photo next to `index.html`, run `xds grid . screens/<id>/photo.jpg` to read where each subject is
in % of the photo, and position the boxes in % over an element with the photo's aspect ratio.
Ask for a real photo of the place the product is used; stock photos rarely fit the story.

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

**Rules for convincing UI**: the screen is the product in use, not a second slide.

- **Two voices.** The slide's text is the brand talking to the viewer: it makes the claim
  ("Footage stays on the door."). The screen is the app talking to its owner: labels, values,
  states and actions about *their* things ("On this doorbell · 41 of 64 GB", "Keep clips for
  14 days"). It shows the evidence, and the viewer connects the two. Never put the slide's
  message, or a paraphrase of it, on the screen.
- **Would the product team ship this string?** Every word on the screen must be one the app would
  really show if marketing didn't exist. So no "we", "us" or "our" from the company; no taglines
  or explainer cards; no rows about what the product doesn't do or doesn't charge ("Monthly fee:
  None", "Account required: No"); no company entry in the owner's own data ("GateMan · That's
  us").
- **Show the point through state.** Pick the moment in the app where the claim is visibly true:
  the clips stored on the doorbell, the people who can watch, the door that just locked. What
  isn't there can carry it too: no cloud plan, no upgrade banner.
- **Real content**: plausible names, numbers, dates and times for this product and this person.
  Never lorem ipsum.
- Design at the **logical size** (402 px wide for the iPhone 17 Pro), with the real type scale:
  body 15–17 px, titles 28–34 px, tap targets ≥ 44 px.
- Keep the **status bar and home indicator** from the starter, and respect the safe area.
- **One clear state**: one screen of the app, one primary action, a visible hierarchy, brand colors
  for accents only.
- **Large and simple**: the screen is small on the slide, so pick a screen whose own content is
  big (a number the app really leads with, a title, few rows) rather than shrinking a dense one.
  Big type is not a license for statement cards. The audit warns `SCREEN_DETAIL_TOO_SMALL`.

## 7. Backgrounds (ground designs)

The back ground node paints the whole canvas (§4.3). To change a slide's background, change that
node's `design` and `values` rather than adding a second full-canvas node on top. Start from a
starter and set its knobs on the ground node:

```bash
xds design add . sweep      # also: solid, spotlight, aurora, grain-solid, split-tone, vignette-dark
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
- Don't copy device models, logos or fonts into the project, and don't leave this folder.
- Don't move the product by editing the background, or the other way round: designs follow
  `subject.*`.
- Don't use lorem ipsum, and don't add exceptions just to pass the audit.
