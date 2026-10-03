# XDS documentation

XDS is a local design editor for social-media graphics that agents can drive. Each slide
stacks a 2D **Ground** background, a live **3D** product scene with automatic studio lighting,
2D **images** and DOM **type**. The result is rendered to PNG by the browser and checked by a
design-rule audit.

- **[Architecture](./architecture.md)**: repository layout, the browser/Python/disk tiers,
  routes, the CLI, the single render path, and safety boundaries.
- **[Data models](./data-models.md)**: `project.json` field by field, designs, derived files,
  migration, and the in-memory state.
- **[Lighting and backgrounds](./lighting-and-backgrounds.md)**: the studio lighting rig,
  auto-framing, and how product-showcase backgrounds are built.
- **[Design rules](./design-rules.md)**: the numbers derived from a format, the audit, every rule,
  and deliberate exceptions.
- **[Agent guide](./agent-guide.md)**: the file-and-CLI loop for agents, and bringing in 3D
  models (e.g. from Blender).
- **[Human interaction](./human-interaction.md)**: the editor screen, modes, shortcuts and
  walkthroughs.
- **[Dataflow](./dataflow.md)**: every input, transformation and destination.

The user-facing quickstart and CLI reference is the repository's root `README.md` (still to be written).

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
