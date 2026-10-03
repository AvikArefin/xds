# XDS documentation

XDS is a standalone, local, agent-assisted design editor that stacks procedural 2D
**Ground**, a live **3D** React Three Fiber scene, and DOM **Type** into social-media
graphics, then renders them to PNG.

- **[Architecture](./architecture.md)** — the repository layout, the browser/service/disk
  tiers, how the modules connect, the HTTP routes, and the safety boundaries.
- **[Data models](./data-models.md)** — every schema in `project.json`, `scene-data.json`,
  `review-state.json`, the derived artifacts, and the in-memory models, plus a diagram of
  where each one lives.
- **[Human interaction](./human-interaction.md)** — the screen layout, the four editor
  modes, keyboard shortcuts, and step-by-step walkthroughs of where to click.
- **[Dataflow](./dataflow.md)** — where every input comes from and goes to: edit → pending →
  guarded save; gestures → semantic transforms; capture → manifest; audit; review; export;
  and the source-hash freshness model.

The user-facing quickstart and CLI reference is [`../README.md`](../README.md).
