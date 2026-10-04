# Working in this XDS project

This folder is an XDS project: social-media slides made of four layers (background, 3D, images,
text), rendered to PNG. You edit the files; the `xds` CLI renders, audits and exports.
If the XDS editor is open, it reloads your changes immediately — the file on disk is the truth.

## Files

| Path | What it is |
| --- | --- |
| `project.json` | the whole design: format, brand, 3D objects, slides and their nodes |
| `designs/*.svg` | background designs (artwork + parameters) |
| `screens/<id>/index.html` | UI shown on device screens |
| `assets/` | images, GLB models (device models and fonts come from xds: `xds:` paths) |
| `sources/` | yours: `.blend` files, originals, references — XDS ignores it |
| `cache/`, `export/` | generated; never edit |

## The loop

```bash
uv run xds guide . --json     # margins, spacing unit, type sizes for this format — read first
# edit project.json / designs / screens
uv run xds check . --json     # fast structural check
uv run xds audit . --json     # renders, measures, runs design rules; fix every error
#   look at cache/<hash>/annotated/*.png
uv run xds export . --json
```

- Sizes inside the guide's bands; spacing on multiples of `u`; content inside the margin.
- One message and one subject per slide.
- An audit exception needs a real artistic reason: `"exceptions": [{ "rule": "...", "reason": "..." }]`.
- `uv run xds rules` explains every rule.

## 3D models

- Devices ship with xds: `uv run xds model library` (iPhone 17 Pro, MacBook Pro 14″). Use one by
  reference: `uv run xds model add . --library iphone-17-pro --slide SLIDE [--screen SCREEN]`.
  Never copy library models into the project.
- Add your own with `uv run xds model add . path/to/file.{glb,gltf,dae} --id ID --slide SLIDE`.
- Conventions: meters, Y-up, origin at bottom center, front faces +Z, Principled BSDF materials,
  textures packed. Moving parts: separate named objects with their origin on the joint.
- Lighting and framing are automatic. Place the product on the slide with the slide camera:
  `"camera": { "mode": "frame", "x": 50, "y": 55, "height": 55 }` (percent of canvas).
- Light, if needed: `"lighting": { "look": "softbox|contrast|rim|bright", "angle": 0-360 }`.
- Articulate parts on the render node (relative to rest pose):
  `"parts": { "Lid": { "rotate": [-15, 0, 0] } }`. `uv run xds model inspect FILE` lists parts.
  The editor never changes parts — that is your job.

## Device screens (phone / laptop UI)

1. `uv run xds screen add . app-home --device iphone-17-pro` (laptop: `--device macbook`) → edit
   `screens/app-home/index.html`.
2. Put it on the device: `uv run xds model add . --library iphone-17-pro --slide SLIDE --screen app-home`,
   or set `"screens": { "Screen": "app-home" }` in an existing render node's `data`.
3. Toolkit: **Tailwind CSS v4** classes, **Basecoat UI** components (shadcn-style, plain HTML),
   **Lucide** icons as `<i data-lucide="name"></i>`, the project's brand fonts. No build step.
4. Design at the logical size (e.g. 393 × 852). Respect `var(--safe-top)` / `var(--safe-bottom)`.
   Keep the status bar and home indicator from the starter.
5. Real, story-telling content — never lorem ipsum. One clear state, one primary action, brand
   colors only for accents. Large and simple: the screen is small on the slide.
6. Check flat with `uv run xds screen render . app-home`, then on the device with `xds audit`.

## Backgrounds

`uv run xds design add . sweep` (also: spotlight, aurora, grain-solid, split-tone, vignette-dark).
Designs can follow the product via `subject.cx`, `subject.cy`, `subject.floor`. Keep the area
behind text and the product quiet; let the product be the most eye-catching thing.

Full docs: the XDS repository's `docs/` (agent-guide.md, design-rules.md, data-models.md).
