# XDS documentation

XDS is a local design editor for social-media graphics that agents can drive. Each slide
stacks a 2D **Ground** background, a live **3D** product scene with automatic studio lighting,
2D **images** and drawn **ornaments**, and DOM **type**. A layout is written as relations (a
block pinned to the margin, stacked a gap under another, in a column that flows) that resolve to
boxes, so one source renders in every format and a change of format reflows instead of breaking.
The design rules run live in the editor and in the audit, and a finding's fix is a field write
(`xds fix`, the Fix button). Expressive type is declared as treatments the renderer draws and the
rules check for coherence. Slides start from a library of layouts, and every big save leaves a
snapshot to restore. The result is rendered to PNG by the browser.

- **[Architecture](./architecture.md)**: repository layout, the browser/Python/disk tiers,
  routes, the CLI, the single render path, and safety boundaries.
- **[Data models](./data-models.md)**: `project.json` field by field, designs, derived files,
  migration, and the in-memory state.
- **[Lighting and backgrounds](./lighting-and-backgrounds.md)**: the studio lighting rig,
  auto-framing, and how product-showcase backgrounds are built.
- **[Design rules](./design-rules.md)**: the numbers derived from a format, the audit, every rule,
  and deliberate exceptions.
- **[Layouts](./layouts.md)**: slide layouts written in relations (no coordinates), the slot
  vocabulary, how `fill` / `replace` / `new` apply one, the shipped layouts, authoring.
- **[Agent guide](./agent-guide.md)**: the file-and-CLI loop for agents, and bringing in 3D
  models (e.g. from Blender).
- **[Human interaction](./human-interaction.md)**: the editor screen, modes, shortcuts and
  walkthroughs.
- **[UI](./ui.md)**: Studio's shared building blocks (list rows, dropdowns, number fields,
  buttons), the style tokens, and the conventions new UI follows.
- **[Dataflow](./dataflow.md)**: every input, transformation and destination.

The user-facing quickstart and CLI reference is the repository's root [`README.md`](../README.md).

## Glossary

| Term | Meaning |
| --- | --- |
| `s`, `k`, `u`, `m` | the format's short edge; its display scale (screen px per canvas px); the **spacing unit** `max(4, round(s / 135))`; the **margin** `max(u-rounded 0.06 s, safe zone)` ([design rules §1](./design-rules.md#1-numbers-derived-from-the-format)) |
| relation | a rule in a node's `layout` that decides a box field: a pin, an align, a stack, a fit or a group. It resolves to numbers; the box stays plain ([data models §2.5a](./data-models.md#25a-layout-relations-that-resolve-to-a-box)) |
| pin | an edge (or center) tied to a line of the format: the canvas edge, the safe zone, the margin, the center, a third; plus an offset in `u` |
| align | an edge shared with another node on the slide, plus an offset |
| stack | a block placed a gap in `u` below, above, right of or left of another, ink to ink, so it follows that block wherever it wraps |
| fit | a text box whose height follows its laid-out text (`fit: "text"`); `fitWidth` is a treatment that sets the size from the widest line |
| group | a flow: the slide's `groups[name]` lays its members out in a column or row with a gap, inside a box its pins place ([§2.5b](./data-models.md#25b-group-flow)) |
| master | a node on every slide (`project.master.nodes`), behind the slide's own nodes of its layer ([§2.11](./data-models.md#211-master-nodes-on-every-slide)) |
| orientation class | `portrait`, `square`, `landscape` or `story`, from the format's size; it picks the variants |
| variant | a node's per-class override (`variants.landscape`), deep-merged over the node when the format is in that class ([§2.5c](./data-models.md#25c-variants-per-orientation-overrides)) |
| treatment | an expressive move declared on a text node with numbers: `skew`, `stroke` (+ `fill: "none"`), `extrude`, `repeat`, `plate`, `fitWidth` ([design rules §8](./design-rules.md#8-expression-and-coherence)) |
| ornament | a drawn shape on the 2D layer (`ShapeData`: stars, rings, lenses, lines…) with a stroke in `u` |
| expression system | `brand.expression`: the few angles, skews, stroke widths, one extrusion direction, radii and ornament family a project draws from; the coherence rules check against it |
| structured fix | a finding's `edits`: the fix as field writes (`{ nodeId, path, value }`), applied by `xds fix` or the editor's Fix button ([§6.1](./design-rules.md#61-applying-fixes)) |
| snapshot | a copy of `project.json`, `designs/` and `screens/` under `.snapshots/`, taken by hand, before a big save and before a restore (`xds snapshot`, `xds restore`) |
| target | the source reflowed to another preset under `cache/targets/<preset>/`, rendered and exported without touching the source (`--format`) |
| fluidity check | `xds reflow --check`: a target per orientation class, the text-only rules on each, a table of what breaks |
| layout | a slide written in relations with slots instead of roles, shipped in `xds/library/layouts/`, applied with `xds layout apply` ([layouts](./layouts.md)) |
| slot | what a layout node is for (`headline`, `subhead`, `cta`, `logo`, `subject`…); applying maps it to the project's role of that level |

## Changes from v1

| Area | v1 | v2 |
| --- | --- | --- |
| Source files | `project.json` + `scene-data.json` (+ optional `project-scene.py`) | one `project.json` |
| Nodes | flat array with cross-layer ordering rule | nested under each slide |
| Schema | custom rule walker in `services/schema.py` | Pydantic models in `xds/models.py` |
| Server | stdlib HTTP server | FastAPI |
| Rasterizing | html-to-image per DOM layer + WebGL capture + Python compositor (custom PNG codec) | one Playwright screenshot of the real slide |
| Blender | optional renderer with sandboxed recipe scripts | removed from the app; only an authoring tool for GLB models |
| Lighting | light lists + six knobs, stored baseline and derived rig | environment-based studio rig: `look`, `angle`, `elevation`, `shadow`, `brightness` |
| Camera | 3D transform on every render node | per slide; `frame` mode places the product by canvas percentage |
| Audit | overlap/size/legibility checks; separate `xds measure` | full rule engine on measured geometry and pixels; `xds guide` for upfront numbers |
| Process | review state, approvals, journaled multi-file save, three-way rebase | audit → export; one atomic save; the file on disk is the truth (outside changes reload the editor) |
| Migration | one-off pattern rewriter | versioned steps + automatic conform pass (aliases, defaults, drops) |
