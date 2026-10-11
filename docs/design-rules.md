# Design rules

XDS includes a set of layout and typography rules as code. They work in two directions:

- **Before designing** (prescriptive): `xds guide PROJECT` prints the numbers for this project's
  format: margins, spacing unit, type size per level, line lengths, safe zones. An agent or a
  person starts from correct values instead of guessing.
- **After designing** (corrective): `xds audit PROJECT` renders every slide in the real browser,
  measures what was drawn, and runs every rule. Each finding says what was measured, what was
  expected, and the concrete fix.

Rules are not a substitute for taste. They catch the mistakes that are almost always mistakes,
such as overlapping text, unreadable contrast, text under the platform's UI, or two sizes that are
nearly but not quite the same. They also flag *ambiguity*: things that look accidental rather than
deliberate. When breaking a rule *is* the design, record that in the source (§7) and the audit
respects it.

Code: `xds/audit/` (one module per rule family, `rules/*.py`), `xds/formats.py` (format
profiles), `xds/audit/thresholds.py` (every number on this page, each with a comment saying why).

---

## 1. Numbers derived from the format

Everything scales from the format, so the same rules work for a 1080 px post and a
3508 px A3 poster.

| Symbol | Definition | 1080 × 1350 post |
| --- | --- | --- |
| `s` | short edge, px | 1080 |
| `k` | display scale: how many screen px one canvas px becomes on the typical device (`viewWidth / width` for screen formats) | 390 / 1080 = 0.361 |
| `u` | **spacing unit** = `max(4, round(s / 135))` | 8 |
| `m` | **outer margin** = `max(roundTo(u, 0.06 · s), safe zone)` | 64 |
| `readable(px)` | smallest canvas size that displays at `px` screen px = `px / k` (print: `pt · dpi / 72`) | 12 px → 33 |

### 1.1 Format profiles (`xds/formats.py`)

| Preset | Size | View width | Safe zones (UI covers these) |
| --- | --- | --- | --- |
| `instagram-square` | 1080 × 1080 | 390 | none |
| `instagram-portrait` | 1080 × 1350 | 390 | none |
| `instagram-portrait-3x4` | 1080 × 1440 | 390 | none |
| `instagram-story` | 1080 × 1920 | 390 | top 250, bottom 340 |
| `instagram-reel-cover` | 1080 × 1920 | 390 | top 250, bottom 420, right 120 |
| `linkedin-landscape` | 1200 × 627 | 552 | none |
| `linkedin-document-4x3` | 1440 × 1080 | 552 | none (a PDF carousel page) |
| `x-landscape` | 1600 × 900 | 390 | none |
| `freelancer-portfolio-4x3` | 1600 × 1200 | 800 (the portfolio showcase lightbox) | none |
| `youtube-thumbnail` | 1280 × 720 | 360 | bottom-right 220 × 90 (duration badge) |
| `presentation-4x3` / `presentation-16x9` | 1440 × 1080 / 1920 × 1080 | 1440 (a laptop screen) | none |
| `print-a3` / `print-a4` | 300 dpi | n/a: print uses minimum point sizes | 3 mm bleed, 5 mm trim-safe |
| `generic-screen` | any | = width (shown 1:1) | none |

Platform UI dimensions change over time. This table is data, and updating it is a one-line change.
`xds formats` lists the presets with their aspect ("4:3 landscape", "3:4 portrait"); a brief that
gives only an aspect needs the orientation and the platform before a preset can be picked.

### 1.2 Type size bands

Every type role belongs to a **level** ([data models §2.2](./data-models.md#22-brand)). Each
level has a band, expressed as a fraction of `s`. The minimum is never below the readable size
on the target device.

| Level | Default | Min | Max | Line height | At 1080 × 1350 (default / min / max) |
| --- | --- | --- | --- | --- | --- |
| `display` | 0.110 s | 0.075 s | 0.20 s | 0.90–1.10 | 119 / 81 / 216 px |
| `headline` | 0.065 s | 0.050 s | 0.09 s | 1.00–1.20 | 70 / 54 / 97 px |
| `subhead` | 0.042 s | 0.032 s | 0.05 s | 1.10–1.35 | 45 / 35 / 54 px |
| `body` | 0.034 s | `readable(12)` | 0.04 s | 1.30–1.60 | 37 / 33 / 43 px |
| `caption` | 0.029 s | `readable(10)` | 0.032 s | 1.30–1.60 | 31 / 28 / 35 px |

The band defaults form a scale with a ratio of about 1.25–1.7 between neighbors, so the
default hierarchy is always clear.

### 1.3 `xds guide`

```text
$ uv run xds guide ~/xd-projects/launch
format       instagram-portrait 1080×1350, 4:5 portrait (viewed ≈390 px wide, so 1 px here shows as 0.3611 px)
unit u       8 px      spacing scale: 8 16 24 32 48 64 96 128
margin m     64 px     content area: x 64–1016, y 64–1286
safe zones   none
type         level     default  min  max   line-height  max lines  chars/line
             display   119      81   216   0.90–1.10    2          —
             headline  70       54   97    1.00–1.20    3          ≤ 24
             subhead   45       35   54    1.10–1.35    3          ≤ 40
             body      37       33   43    1.30–1.60    6          25–55
             caption   31       28   35    1.30–1.60    3          ≤ 60
budget       ≤ 35 words per slide · ≤ 2 font families · ≤ 4 distinct sizes · ≤ 7 blocks
contrast     text size > 66.5 px: Lc ≥ 45 · 44.3–66.5 px: Lc ≥ 60 · < 44.3 px: Lc ≥ 75 (60 at weight ≥ 600) (= 16 and 24 px on screen)
subject      height 30–75% of canvas · keep 1u clear of text
```

`--json` gives the same data in machine-readable form (plus `aspect` and `contrast`, the Lc
minimums with their size cutoffs). `--slide ID` adds that slide's current measured values next to
the targets. The contrast line is in this format's own px, the unit `data.size` is written in: the
cutoffs are displayed sizes (16 and 24 px on the phone) divided by the format's view scale `k`.

### 1.4 `xds measure`

Text layout without a render: headless Chromium mounts only the type layer of each slide
(no 3D, backgrounds or images), which takes a few seconds for a whole deck. For each text block it
reports the real lines, the ink extent, the height its box needs (`fitH`), widows, stacked
positions and the Lc minimum for its size, then runs the rules that need only text geometry: the
`type` family, `TEXT_OVERLAP`, `TEXT_CROWDED`, `TEXT_CLIPPED`, `IN_SAFE_ZONE`, `OUTSIDE_MARGIN`,
`ALIGN_NEAR_MISS`, `MARGIN_NEAR_MISS`, `SPACING_INCONSISTENT` and `SPACING_OFF_SCALE` (between text
blocks only). Contrast, images, the product and composition need `xds audit`.

---

## 2. How the audit works

```text
xds audit PROJECT
  1. check     Pydantic gate + references + design manifests            (no browser)
  2. render    Playwright opens /render?slide=… per slide                (the one rasterizer)
  3. measure   the page reports SlideMeasure: text line rects, boxes,
               the subject silhouette, per-layer alpha masks, a
               background-only composite                                 (data-models §5.1)
  4. rules     xds/audit/rules/*.py run on measurements + pixels (numpy)
  5. report    cache/<hash>/audit.json + annotated PNG per slide
```

Rules read **only what the browser drew**: real line boxes, real font sizes, real pixels.
Nothing is estimated, so a rule can't disagree with the image.

Every rule is a small function with a docstring stating the design principle behind it:

```python
@rule("TEXT_OVERLAP", family="collision", severity="error")
def text_overlap(slide: MeasuredSlide, t: Thresholds) -> Iterator[Finding]:
    """Text that overlaps other text can't be read. Compares ink line
    rectangles, not node boxes, so generous boxes don't false-alarm."""
    for a, b in pairs(slide.text_nodes):
        hit = intersect_lines(a.lines, b.lines)
        if hit:
            yield Finding(nodes=[a.id, b.id], region=hit,
                          measured={"overlapPx": hit.area},
                          fix=f"Separate '{a.name}' and '{b.name}' by ≥ {t.gap_related}px")
```

`xds rules` lists every rule with its family, severity, principle and current thresholds.
That list is generated from these decorators and docstrings, so it can't drift from the code.

---

## 3. Severity

| Severity | Meaning | Effect |
| --- | --- | --- |
| `error` | objectively broken: unreadable, clipped, covered by platform UI | blocks `xds export` (unless `--force`, which is recorded in `export.json`) |
| `warn` | almost always a mistake, or below a craft standard | reported; does not block |
| `info` | a taste observation or a near-miss worth a second look | reported |

---

## 4. Rule catalog

All thresholds below are the defaults for a 1080 px short edge (`u = 8`). The real values come
from `thresholds.py` and scale with the format.

### 4.1 Collision and masking (`collision`)

| Rule | Severity | Fires when | Principle |
| --- | --- | --- | --- |
| `TEXT_OVERLAP` | error | ink line rects of two text nodes intersect | overlapping text can't be read |
| `TEXT_CROWDED` | warn | two text blocks are closer than `max(u, 0.5 × smaller font size)` without overlapping | a tangent gap reads as a mistake, not a choice |
| `TEXT_OVER_SUBJECT` | warn > 2 % of text ink area · error > 15 % | text ink lies over the 3D subject's silhouette (from the render layer's alpha) | text on the product hides the product and is hard to read |
| `TEXT_OVER_IMAGE` | warn / error, same thresholds | text ink over an image node's opaque pixels | same; use a scrim or move the text |
| `SUBJECT_MASKED` | warn > 10 % · error > 30 % | layers above `render` in `layerOrder` cover the subject's silhouette | the hero shouldn't be hidden by accident |
| `SUBJECT_CROPPED` | warn when the crop is < 25 % of the subject · info when larger | the silhouette touches the canvas edge | a small crop looks like an accident; a big crop looks deliberate |
| `TEXT_CLIPPED` | error | text overflows its box or the canvas | cut-off text is broken text |
| `IN_SAFE_ZONE` | error | text or the subject overlaps a platform safe zone | the app's UI will cover it |
| `OUTSIDE_MARGIN` | warn | text or image ink outside the margin `m` (ground is exempt) | edge tension; content feels about to fall off |
| `EDGES_KISSING` | warn | two element edges within `u/2` of each other but not aligned or overlapping | tangency creates visual tension and looks unintended |

### 4.2 Spacing and alignment (`spacing`)

| Rule | Severity | Fires when | Principle |
| --- | --- | --- | --- |
| `ALIGN_NEAR_MISS` | warn | two blocks' left, center or right edges differ by 1 to `u/2` px | align exactly, or separate clearly |
| `MARGIN_NEAR_MISS` | info | a block edge sits within `u/2` of the margin but not on it | snap to the margin |
| `GROUPING_AMBIGUOUS` | warn | the gap *inside* a group is not ≤ ⅔ of the gap to its nearest outside neighbor | Gestalt proximity: related things sit closer than unrelated ones. Groups come from `TypeData.group`; ungrouped blocks are clustered by gap |
| `SPACING_INCONSISTENT` | warn | in a stack of ≥ 3 blocks of the same group, gaps differ by > 20 % | rhythm |
| `SPACING_OFF_SCALE` | info | a vertical gap is not within 2 px of a multiple of `u` | a consistent spacing scale |
| `MARGINS_UNEVEN` | info | left/right (or top/bottom) content margins differ by 5–25 % | intentional asymmetry is bigger than that |

### 4.3 Typography (`type`)

| Rule | Severity | Fires when | Principle |
| --- | --- | --- | --- |
| `TEXT_TOO_SMALL` | error | measured size < the level's min (never below `readable`) | legibility on the device |
| `TEXT_TOO_LARGE` | warn | > the level's max | the level is wrong, or the role is |
| `HIERARCHY_WEAK` | warn | two *adjacent* used sizes on a slide have a ratio < 1.25 | levels must be clearly different to read as levels |
| `SIZE_NEAR_MISS` | warn | two sizes within 8 % of each other but not equal | make them the same, or clearly different |
| `TOO_MANY_SIZES` | warn | > 4 distinct sizes on a slide | |
| `TOO_MANY_FAMILIES` | warn | > 2 font families on a slide | |
| `LINE_LENGTH` | warn | chars per line outside the level's range (§1.3) | comfortable measure |
| `TOO_MANY_LINES` | warn | lines > the level's max | a headline that needs 5 lines is body text |
| `LINE_HEIGHT` | warn | measured line height outside the level's range | display text set tight, body text set open |
| `WIDOW` | warn | the last line of a multi-line block is one word, or < 15 % of the longest line | ragged and unfinished |
| `BAD_RAG` | info | in a left/right-aligned block, a non-final line is < 50 % of the longest | uneven edge; rebreak or use `\n` |
| `CENTERED_LONG_TEXT` | warn | centered block with > 3 lines of body/caption | centered paragraphs are hard to read |
| `CAPS_UNTRACKED` | warn | uppercase body/caption/subhead with letter spacing < 0.03 em | capitals need air |
| `TOO_MANY_WORDS` | warn | > 35 words on a slide (decorative excluded) | social images are glanced at for about a second |

### 4.4 Contrast and legibility (`contrast`)

Contrast is measured against the **actual pixels behind each line** (the background-only
composite), not against a declared color. For each line, the audit takes the text color and the
background pixels under the line's ink rect, and scores the worst 10 % of them, so a gradient is
judged at its weakest point.

The score is **APCA Lc** (perceptual, size-aware, the basis of WCAG 3), implemented in
`xds/audit/contrast.py`. The WCAG 2 ratio is reported alongside it for reference.

| Rule | Severity | Fires when |
| --- | --- | --- |
| `LOW_CONTRAST` | error | Lc below the minimum for the line's **displayed** size: < 16 px displayed: 75 (60 if weight ≥ 600); 16–24 px (24 included): 60; > 24 px: 45. The message names the band in the format's px, and the fix offers the smallest `data.size` (within the level's band) at which the line's current Lc passes with a 10 Lc margin |
| `LOW_CONTRAST_MARGINAL` | warn | within 10 Lc above the minimum |
| `BUSY_BACKGROUND` | warn | under a text block, luminance std-dev > 0.12 or edge density (Sobel) > 0.15 |
| `DECORATIVE_INVISIBLE` | info | decorative text with Lc < 30 (probably meant to be seen) |

### 4.5 Composition and attention (`composition`)

| Rule | Severity | Fires when | Principle |
| --- | --- | --- | --- |
| `ATTENTION_ON_BACKGROUND` | warn | < 50 % of the top-5 % most salient pixels fall on the subject or the top-level text | the eye should land on what matters. Saliency is computed with OpenCV's spectral-residual model. |
| `ATTENTION_SPLIT` | info | two separate regions of near-equal saliency | one focal point per slide |
| `COMPETING_HEADLINES` | warn | ≥ 2 blocks at the slide's top level that are not in the same group | one message per slide |
| `HIERARCHY_ORDER` | warn | a lower-level block comes before the top-level block in reading order (top → bottom, left → right), unless it sits directly above within 1.5 × its line height (a kicker) | read the most important thing first |
| `POSITION_NEAR_MISS` | info | an element's center is 2–5 % of `s` away from the canvas center or a third line | commit to center or to a third |
| `LOPSIDED` | info | the visual-mass centroid (alpha × contrast) is > 0.2 s from center and no element counterweights it | balance |
| `CROWDED` | warn | content (text ink ∪ subject ∪ images) covers > 65 % of the content area | negative space is what makes a layout breathe |
| `TOO_MANY_ELEMENTS` | warn | > 7 visible blocks | |

### 4.6 Subject and lighting (`subject`)

| Rule | Severity | Fires when | Fix it suggests |
| --- | --- | --- | --- |
| `SUBJECT_TOO_SMALL` / `SUBJECT_TOO_LARGE` | warn | subject height outside 30–75 % of canvas height | `camera.height` |
| `SUBJECT_OVEREXPOSED` | warn | > 2 % of silhouette pixels have OKLab L > 0.98 | `brightness −0.3`, or look `contrast` |
| `SUBJECT_UNDEREXPOSED` | warn | median L < 0.18 and > 25 % of pixels below 0.05 | `brightness +0.3`, or look `rim` on dark backgrounds |
| `SUBJECT_LOW_SEPARATION` | warn | Lc between the silhouette's inner edge ring and the background just outside it < 15 | change the ground's tone, use look `rim`, or a spotlight design |
| `SUBJECT_CLOSE_TO_TEXT` | warn | silhouette within `u` of text ink | breathing room |
| `SCREEN_DETAIL_TOO_SMALL` | warn | a device screen's body text appears on the slide below `readable(9)` | enlarge the device (`camera.height`) or simplify the UI: bigger type, fewer rows |
| `SCREEN_LOW_RES` | warn | the screen texture has < 1.5 texture px per displayed slide px | raise the screen's `scale` |
| `SCREEN_ASPECT_MISMATCH` | error (structural) | the screen page's aspect ratio differs from the screen mesh's by > 2 % | fix `width`/`height` to the device's |

### 4.7 Structural (`check`)

Schema errors, unknown references (`UNKNOWN_ROLE`, `UNKNOWN_ASSET`, `UNKNOWN_DESIGN`,
`UNKNOWN_OBJECT`, `UNKNOWN_COLOR`), stack anchors (`STACK_ANCHOR`, `STACK_CYCLE`), missing files,
path escapes, and the design checks from [data models §4](./data-models.md#4-designs-designsidsvg).
These are always errors and can't be waived.

Two design checks are warnings, which `xds check` lists without blocking anything:
`DESIGN_STRETCHED` (artwork in a fixed viewBox with `preserveAspectRatio="none"`, so it distorts on a
canvas of another shape) and `DESIGN_UNUSED_PARAM` (a declared knob that no expression reads).

---

## 5. Project-level tuning

`project.rules` changes thresholds or switches rules off for a whole project:

```json
"rules": {
  "set": { "margin": 0.045, "wordsPerSlide": 50, "subject.height": [25, 85] },
  "off": ["SPACING_OFF_SCALE", "POSITION_NEAR_MISS"]
}
```

Keys are the names `xds rules --json` reports (`thresholdKeys`). Ranges are `[lo, hi]` and
warn/error tiers are `[warn, error]`; per-level keys look like `body.size` or `headline.maxLines`. Unknown keys are a structural error, so a
typo can't silently do nothing.

---

## 6. The report

`cache/<hash>/audit.json`:

```ts
AuditReport = {
  sourceHash: string; format: string; createdAt: string;
  summary: { errors: number; warnings: number; infos: number; waived: number };
  findings: {
    rule: string; family: string; severity: "error" | "warn" | "info";
    status: "open" | "waived";
    slideId: string; nodes: string[];          // node ids involved
    region?: Rect;                             // px, drawn on the annotated PNG
    message: string;                           // one sentence, human-readable
    measured: Record<string, unknown>;         // e.g. { lc: 38.2, sizePx: 30 }
    expected: Record<string, unknown>;         // e.g. { lcMin: 45 }
    fix: string;                               // a concrete edit: field and value
    principle: string;                         // why the rule exists
    waiver?: { reason: string };
  }[];
}
```

`cache/<hash>/annotated/<n>-<slide>.png` draws every finding's region in its severity color, with
its number, together with the margin, the safe zones and the third lines. A multimodal agent can
look at the annotated image and the JSON together. The Studio draws the same overlay on the
canvas (see [human interaction §4](./human-interaction.md#4-walkthroughs)).

---

## 7. Deliberate exceptions

Art breaks rules on purpose. An exception is written **in the source**, next to the thing it
excuses, with a reason:

```json
{ "id": "big-word", "layer": "type", "...": "...",
  "exceptions": [{ "rule": "TEXT_OVER_SUBJECT",
                   "reason": "Oversized word deliberately runs behind the bottle" }] }
```

Composition rules belong to the slide rather than a node, so `Slide.exceptions` accepts them
too. A waived finding stays in the report with `status: "waived"` and the reason, so the choice
is visible to the next person or agent. It does not block export. Structural rules can't be
waived.
