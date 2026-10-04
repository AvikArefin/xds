# XDS

A local design editor for social-media graphics that people and LLM agents both drive. Each slide
stacks a 2D **background**, a live **3D** product scene with automatic studio lighting, 2D
**images** and **type**. Headless Chromium renders it to PNG, and a design-rule audit checks the
result.

Everything runs on your machine. A project is an ordinary folder (`project.json` plus designs,
assets and fonts), and the editor is a view over those files. See [docs/](./docs/README.md) for
the architecture, data models and rules.

## Setup

Requirements: [uv](https://docs.astral.sh/uv/), Node.js ≥ 20 with npm, macOS or Linux.

```bash
uv sync                                  # Python 3.12 + the xds package
npm install                              # the studio and the screen toolkit
uv run playwright install chromium       # the renderer
npm run build                            # the studio, served by `xds` for headless renders
```

## Quickstart

```bash
uv run xds init ~/xd-projects/launch --name "Launch" --format instagram-portrait
uv run xds open ~/xd-projects/launch     # the editor (API :8765, Vite :5173)
```

Or work like an agent, through files and the CLI (the project's `AGENTS.md` explains the loop):

```bash
uv run xds guide ~/xd-projects/launch    # margins, spacing unit, type sizes for this format
# edit project.json, designs/, screens/
uv run xds check ~/xd-projects/launch    # schema + references, no browser
uv run xds audit ~/xd-projects/launch    # render + measure + design rules
uv run xds export ~/xd-projects/launch   # audit gate → export/<stamp>/*.png
```

## CLI reference

Every command accepts `--json` (one JSON document on stdout; progress goes to stderr). Exit
status is 0 on success, 1 on failure or open audit errors.

| Command | What it does |
| --- | --- |
| `xds init PROJECT [--name NAME] [--format PRESET]` | create a project from the blank template |
| `xds open [PROJECT] [--port N] [--no-open] [--no-vite]` | start the editor; without a project it opens the project browser |
| `xds check PROJECT` | schema, references and design manifests (no browser) |
| `xds guide PROJECT [--slide ID]` | the design numbers for the format; `--slide` adds measured values |
| `xds rules [--project PROJECT]` | every audit rule with its principle and thresholds |
| `xds render PROJECT [--slide ID]` | slide PNGs + contact sheet into `cache/<hash>/` |
| `xds audit PROJECT [--slide ID]` | render + measure + rules → `audit.json` + annotated PNGs |
| `xds export PROJECT [--out DIR] [--force]` | audit gate → `export/<stamp>/` (`--force` is recorded) |
| `xds migrate [PROJECT \| --all] [--dry-run] [--conform]` | upgrade project files to the current schema |
| `xds model add PROJECT FILE --id ID [--name NAME] [--slide ID] [--replace]` | check, convert (`.gltf`, `.dae`) and register a model |
| `xds model inspect FILE` | parts, clips, screen meshes, convention warnings |
| `xds model library` | the device models that ship with xds (iPhone 17 Pro, MacBook Pro 14″) |
| `xds model add PROJECT --library ID [--slide ID] [--screen ID]` | use a library model by reference (not copied) |
| `xds model vendor PROJECT ASSET_ID` | copy a library model into the project so it travels without xds |
| `xds screen add PROJECT ID [--device PRESET \| --width W --height H --scale S]` | create a device-screen page |
| `xds screen render PROJECT ID` | render a screen page to PNG to check it flat |
| `xds design add PROJECT STARTER` | copy a starter background (`sweep`, `spotlight`, `aurora`, `grain-solid`, `split-tone`, `vignette-dark`) |
| `xds fonts fetch PROJECT FAMILY` | use a Fontshare family: downloaded once into the xds font library, referenced by the project |
| `xds fonts library` · `xds fonts vendor PROJECT [FAMILY]` | the downloaded families · copy a project's fonts into its own `fonts/` |
| `xds formats` | the format catalog |
| `xds schema --emit-types \| --check` | regenerate or check `packages/protocol/src/generated/project.ts` |
| `xds clean PROJECT` | delete `cache/` |

The projects directory (for the editor's project browser and `migrate --all`) is
`~/xd-projects/`, or `$XDS_PROJECTS_DIR`.

## Development

```bash
uv run pytest                 # Python tests (the render smoke test needs a built studio + Chromium)
npm test                      # vitest: editor-core and the studio
npm run typecheck
uv run xds schema --emit-types   # after changing xds/models.py
```

Repository layout: `xds/` is the Python package (schema, gate, API, CLI, renderer, audit),
`apps/studio/` the React editor and render page, `packages/protocol/` the generated TypeScript
types, and `packages/editor-core/` pure editing math. Details are in
[docs/architecture.md](./docs/architecture.md).
