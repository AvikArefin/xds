# Layouts

A layout is a slide written in the relations vocabulary of [data models §2.5a](./data-models.md#25a-layout-relations-that-resolve-to-a-box):
pins to the format's lines, stacks, aligns, fit to text, flow groups, sizes as a `scale` of the
type bands. It holds no coordinates, so the same layout is right in a portrait post, a square, a
landscape banner and a story, and a slide started from one survives a format change. A person
applies a layout from the command palette (**Apply layout…**), an agent with `xds layout apply`.

Code: `xds/layouts.py` (list, show, apply), `xds/library/layouts/<id>.json` (the shipped
layouts, written by `scripts/build_library_layouts.py`), `GET /api/layouts`,
`POST /api/layouts/apply`.

---

## 1. A layout file

```jsonc
{
  "id": "hero-left", "name": "Hero, left",
  "intent": "A launch post: one message top-left, the product on the right, a call to action at the foot.",
  "description": "…how it is built, in a sentence or two…",
  "slots": ["kicker", "headline", "subhead", "cta", "subject"],
  "expression": { "skews": [-12], "extrudeAngle": 135 },          // optional: installed into brand.expression when the brand has none
  "groups": { "intro": { "direction": "column", "gap": 3, "align": "start",
                         "pin": { "left": { "to": "margin" }, "top": { "to": "margin" } },
                         "variants": { "landscape": { "direction": "row" } } } },
  "subject": { "place": { "x": 72, "y": 58, "height": 55 },        // a hint for the slide's first 3D object
               "variants": { "landscape": { "place": { "x": 74, "y": 55, "height": 72 } } } },
  "nodes": [
    { "id": "headline", "slot": "headline", "level": "headline", "layer": "type",
      "box": { "x": 0, "y": 0, "w": 58, "h": 18 },
      "layout": { "group": "intro", "fit": "text" },
      "data": { "wrap": "balance" },
      "variants": { "landscape": { "box": { "w": 44 } } } }
  ]
}
```

`nodes` are ordinary 2D nodes ([data models §2.5](./data-models.md#25-node-the-editable-unit))
with two extra keys: `slot`, what the node is for, and, on text, `level`, the type level it needs.
They carry no `role` and no px `size`; `data.text` is optional (the slot's placeholder is used).
`box.x`/`box.y` are placeholders the relations overwrite; `box.w` (or `h`) stays only where no
relation decides it (a column's width, a logo's size). Nodes' `variants` are kept as they are
(the renderer resolves them by the format's orientation class); a group's `variants` and the
subject hint's are resolved when the layout is applied, since groups and `place` have no
variants of their own.

### 1.1 Slots

| Slot | Level it maps to | Placeholder |
| --- | --- | --- |
| `kicker` | `caption` (uppercase, tracked) | New |
| `headline` | `headline` (or `expressive`, when the layout says so) | Headline goes here |
| `subhead` | `subhead` | A subhead that says why it matters |
| `body` | `body` | Body copy goes here… |
| `cta` | `body` (weight 700) | Learn more → |
| `caption` | `caption` | Caption |
| `logo` | an image node whose `asset` is `@logo` | the project's logo asset (one with "logo" in its id or path) |
| `ornament` | a shape node ([data models §2.5d](./data-models.md#25d-expressive-treatments-typedata-and-shapes-shapedata)) | — |
| `subject` | not a node: the `subject` hint, written to the slide's first 3D node's `data.place` | — |

A text slot maps to the project's **first declared role of its level**. A level the brand has
no role for is reported with the exact role to add (`MISSING_ROLES`, with `suggested`), or
added by `--add-roles` with the project's first font (`NO_FONTS` when it has none: run
`xds fonts fetch` first).

---

## 2. Applying

```text
xds layout list                                   # id, name, intent
xds layout show ID                                # slots, relations, variants, groups, subject
xds layout apply PROJECT ID [--slide ID] [--mode fill|replace|new] [--add-roles] [--dry-run]
xds init PROJECT --layout ID                      # seed the first slide (roles added; a library font registered when there is one)
```

| Mode | What happens on the slide |
| --- | --- |
| `fill` (default) | Every existing text node whose role's level matches a slot keeps its words, role and color and **takes the slot's layout** (box, relations, scale, treatments), keeping its id so other relations still reach it. Slots nobody fills are created with placeholder text. Text nodes with no slot for their level stay where they are and are listed as `kept`. An existing logo image is re-placed; ornaments are added. |
| `replace` | The slide's text, image and shape nodes are removed (the background and the 3D nodes stay, groups nobody uses are dropped) and the layout's nodes added. |
| `new` | A new slide after the given one, with the previous slide's full-canvas background (none when a master background covers the canvas), the layout's nodes and groups. |

In every mode: ids are made project-unique the way the editor does it (`headline`,
`headline-2`), relations between the layout's nodes are remapped to the ids they got, groups
are added to the slide (renamed on collision), the `subject` hint lands on the slide's first 3D
node (a note says to add a model when there is none), and a layout's `expression` is installed
into `brand.expression` only when the brand declares none. The write goes through the validated
save path, so a big change (a new slide, most of the nodes replaced) is snapshotted first
(`xds restore`). The report lists `filled`, `added`, `replaced`, `kept`, `addedRoles`, `notes`
and the gate's findings on the result; `--dry-run` prints it without writing.

In the editor, **Apply layout…** (`Cmd/Ctrl + K`) lists the layouts with their intent, then the
three modes; the editor saves, applies on the server and reloads, selecting the new slide in
`new` mode. Missing roles are added (the notice names them).

---

## 3. The shipped layouts

| Id | Intent | Sketch |
| --- | --- | --- |
| `hero-left` | a launch post: one message top-left, the product right, a call to action at the foot | kicker/headline/subhead column on the top-left margin · subject right half · cta bottom-left |
| `hero-centered` | one statement over the product, everything on the center line | centered column on the top margin · subject below · cta bottom center |
| `split-left` | text left, product right: a feature or comparison slide | column pinned left margin, vertically centered · subject right half |
| `split-right` | text right, product left | the mirror: column on the right margin, right-aligned · subject left half |
| `stacked-centered` | headline above, product in the middle, action below | headline top center · subject center · cta bottom center |
| `caption-bottom` | a full-bleed product shot with the message at the foot, clear of the platform's UI | subject fills the slide · headline on a plate + body, pinned to the bottom safe zone |
| `quote` | one big quote, an attribution, a mark | expressive quote margin to margin, vertically centered · attribution 4u below, left edges shared · a plus mark top-left |
| `product-spotlight` | the product as big as it goes | subject 70 % · small headline top-left · logo bottom-right |
| `carousel-page` | one page of a LinkedIn document carousel | page number top-right · headline top-left · body 3u below · "Swipe →" bottom-left |
| `poster-expressive` | three words as a graphic, declared so the audit keeps it coherent | three expressive, fit-to-width words stacked tight (skew −12°, extrude 135°, the third on a plate) · star, rings and lens on the margins · a plate label bottom-right · installs an expression system |
| `thumbnail` | a YouTube thumbnail | kicker top-left · headline from the left margin to the two-thirds line, vertically centered, scale 1.4 · subject on the right third · the duration badge's corner clear |

Every layout has a `landscape` variant (and `story` where the subject must move), and the
thumbnail has `portrait`, `square` and `story` ones since its native format is landscape. The
gate accepts every shipped layout in every mode and orientation (`tests/test_layouts.py`).

---

## 4. Authoring one

1. Write it in `scripts/build_library_layouts.py` with the helpers there (`text`, `shape`,
   `logo`, `pin`), then run the script: it writes `xds/library/layouts/<id>.json`.
2. Only relations and unit numbers: pins for position, both edges pinned for width, `scale`
   for size, stacks and aligns between nodes, groups for columns and rows. No `data.size`, no
   `box.x`/`box.y` that matter.
3. Give every text node a `slot` and a `level`, every ornament a stroke in `u`, and the subject
   a `place` hint. Add `variants` where a portrait layout would break in landscape (a narrower
   column, a bigger subject) and a `story` variant where the subject must leave the safe zones.
4. Name no colors: layouts work on any brand. A plate or an ornament gets its color from the
   slide's text color by default.
5. `uv run pytest tests/test_layouts.py` applies it in every mode and orientation through the
   gate; then `xds layout apply` it onto a real project, `xds measure` and `xds audit` the
   result, and look at the render in each orientation.
