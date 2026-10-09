# Lighting and backgrounds

The goal: **drop in a model and get studio product lighting without touching anything.** This
page explains how the 3D layer is lit and framed, why the approach is stable for any model,
and how the Ground layer makes the product-showcase backgrounds that sit behind it.

Code: `apps/studio/src/scene/studio/` (lighting, shadows, framing) and
`apps/studio/src/design/` (ground designs).

---

## 1. Lighting

### 1.1 Why the old rigs were unpredictable

The v1 rigs were lists of point, area and sun lights at fixed positions, plus ambient,
hemisphere and exposure knobs on top. That fails in four ways:

- **Scale.** Point and area lights fall off with distance squared. The same rig lights a 5 cm
  ring and a 2 m chair differently: one blows out and the other goes dark.
- **Stacking.** Ambient, hemisphere and several direct lights add up with no shared energy
  budget, so most combinations of six sliders are wrong.
- **Shadows.** Every shadow-casting light adds its own hard shadow, which gives multiple
  crossing shadows.
- **Tone mapping.** ACES and AgX shift hues and crush highlights. A product's real colors
  matter more than a filmic look.

### 1.2 The approach: a virtual photo studio

The rig is **image-based lighting from a procedural studio environment**, the same technique
product renderers like KeyShot use with studio HDRIs. All parts are standard drei components:

| Part | Implementation | Why |
| --- | --- | --- |
| Light | `<Environment resolution={256}>` containing `<Lightformer>` softboxes (a key, a fill, a rim strip and an overhead panel) on a mid-gray backdrop | An environment is infinitely far away, so lighting **does not depend on model size or position**. Large softboxes give soft wrap-around light and clean reflections on glossy and metallic products. The backdrop is never black, so nothing goes fully dark. |
| Shadow | `<ContactShadows>` (default) or `<AccumulativeShadows>` + `<RandomizedLight>` (`shadow: "soft"`) | One grounded shadow under the product, never a set of crossing hard shadows. The shadow is drawn on a transparent plane, so it falls **onto the 2D background** (see §3.2). |
| Tone | `THREE.NeutralToneMapping`, exposure `2^brightness` | Khronos PBR Neutral was designed for e-commerce: base colors render true, and only real highlights roll off. |
| Color | `outputColorSpace = SRGBColorSpace`, physically correct lights | Standard; matches how GLB materials were authored in Blender. |

No `directionalLight`, `pointLight`, `ambientLight` or `hemisphereLight` exists in the scene. The
environment is the only light source, so nothing else can add up.

### 1.3 Looks

A look is a fixed, tested arrangement of Lightformers. Each look is a small data table in
`scene/studio/looks.ts`, so a person can read it as a lighting diagram:

| Look | Use for | Arrangement |
| --- | --- | --- |
| `softbox` (default) | anything, especially catalog shots | large key 45° off-axis, large dim fill opposite, overhead panel, faint rim |
| `contrast` | premium or editorial products, glass, metal | narrower key, fill one stop lower, two vertical strip lights for crisp edge reflections |
| `rim` | dark products on dark backgrounds | weak front light, two strong back strips that outline the silhouette |
| `bright` | white or light products, high-key e-commerce | very large key, strong fill, bright backdrop; nearly shadowless |

Every look is normalized to the same **energy budget**: the summed Lightformer intensity times
area is equal across looks. Switching looks therefore changes the *character* of the light, not
its overall level.

### 1.4 The knobs (all optional)

| Field | Range | Default | What it does |
| --- | --- | --- | --- |
| `look` | see above | `softbox` | the arrangement |
| `angle` | 0–360° | 35 | rotates the whole rig around the subject's vertical axis; the full circle is available, not a clamped range |
| `elevation` | 0–80° | 30 | raises or lowers the key |
| `shadow` | `contact` · `soft` · `none` | `contact` | `soft` follows `angle`/`elevation`, so the shadow falls away from the key |
| `brightness` | −1…+1 stop | 0 | exposure; the only brightness control |
| `tint` | brand color token | none | tints the backdrop and fill, so reflections pick up the brand or background color |

`project.lighting` sets the default and `Slide.lighting` overrides individual fields. A
project that never mentions lighting gets `softbox`, 35°, 30°, contact shadow, which is the
"just works" path.

In the editor, **hold `L` and drag in the 3D viewport** to swing the rig: horizontal drag moves
`angle` and vertical drag moves `elevation`, like rotating the HDRI in a product renderer. The
environment re-renders while dragging and settles when you let go.

### 1.5 Scale-awareness

Anything that *does* depend on size is computed from the **subject bounds**, the `Box3` of the
slide's visible render nodes (`scene/studio/subject.ts`):

- the shadow plane sits at `bounds.min.y`, spans 4× the bounding radius, and fades over 1× the
  radius;
- the `soft` shadow's light radius and distance scale with the radius;
- the auto-camera (§2) frames the bounds.

A 3 cm earring and a 1.8 m lamp therefore get the same look.

### 1.6 The audit checks the light

Because the 3D layer is rendered to its own alpha mask, the audit can judge the lit product
([design rules §4.6](./design-rules.md#46-subject-and-lighting)): clipped highlights,
crushed shadows, and whether the product separates from the background behind it. Each
diagnostic names the knob to change (`brightness −0.3`, `look: "rim"`).

### 1.7 What the light does and doesn't do

So a change can be predicted instead of guessed:

- **No self-shadowing.** The product is lit only by the environment; there is no direct light, so
  parts don't shadow each other and recesses don't darken. `shadow` only draws on the floor.
  Detailed assemblies look flatter than in a photo: pick a look and angle that light the faces
  differently, and keep any shading the model itself carries.
- **Reflections show the studio, not the slide.** The ground design is never reflected. Each
  look's backdrop is a fixed gray (`looks.ts`): `rim` 0.24, `contrast` 0.30, `softbox` 0.42,
  `bright` 0.62. On a dark set, metal under `bright` reflects a light-gray room and looks pasted
  in; prefer `contrast` (crisp edge highlights from its strip lights) or `rim`.
- **`angle` is world space**, the same convention as the camera's `yaw`, and doesn't follow the
  camera. `angle` equal to `yaw` puts the key at the camera; with `yaw: -55` the default `angle: 35`
  lights the product from 90° to the side.
- **`brightness` is exposure** (×2^brightness on the whole image). It lifts highlights and
  shadows together and never adds shape, so it can't rescue a flat or dark product; fix the
  material, the look or the angle.

---

## 2. Framing: the auto-camera

A slide's camera has two modes (`Slide.camera`, [data models §2.9](./data-models.md#29-camera)).

**`frame` (default).** You say *where the product should appear*, and the camera works out the
3D details:

```ts
{ mode: "frame", x: 50, y: 55, height: 55, yaw: 25, pitch: 12, fov: 30 }
//            subject center at (x, y)% of the canvas, subject height = 55% of canvas height,
//            viewed from 25° to the right and 12° above
```

`scene/studio/framing.ts` computes the camera distance from the subject's bounding sphere and
the field of view, so the subject is the requested height. Then it shifts the **projection** with
`camera.setViewOffset` so the subject's center lands on `(x, y)`. Shifting the projection, not the
camera, keeps the perspective the same wherever the product sits, as a shift lens does. A
narrow default `fov` of 30° (about an 85 mm lens) avoids the wide-angle distortion that makes
products look cheap.

In the editor, orbiting changes `yaw`/`pitch`, scrolling changes `height`, and panning changes
`x`/`y`. All of these remain plain percentages and angles that an agent can write directly
("move the product to the right third and make it smaller" is `x: 67, height: 45`).

**`free`.** An explicit `position` / `target` / `fov` for shots the frame mode can't express. The
editor switches a slide to `free` only when you choose *Camera → Free* in the inspector.

---

## 3. Backgrounds (ground designs)

The ground layer is 2D. It is drawn by the browser from an SVG design and sits behind the 3D
layer. Product-showcase backgrounds rely on a small set of techniques, all of which plain SVG plus
a color library can do. No background-specific library is needed.

### 3.1 The techniques

| Technique | How, in SVG | Why it works |
| --- | --- | --- |
| **Seamless sweep (cyclorama)** | a vertical `linearGradient` from wall tone to a slightly darker floor tone, with a soft horizon band at the floor line | the classic studio paper roll: it gives the product a floor to stand on and depth without a visible edge |
| **Spotlight / hot spot** | a `radialGradient` ellipse, lighter than the wall, **centered behind the subject** (`subject.cx`, `subject.cy`) | draws the eye to the product and separates it from the background |
| **Vignette** | a large radial gradient from transparent to 8–15% darker at the corners | keeps attention inside the frame |
| **Tonal color** | wall = product or brand hue at low chroma: `tone(accent, 0.94, 0.03)` light or `tone(accent, 0.18, 0.04)` dark | monochrome tonal sets look premium; saturated backgrounds fight the product |
| **Grain** | `feTurbulence` (fractal noise) blended at 3–6% opacity | **removes gradient banding** in 8-bit PNG exports and adds a photographic texture |
| **Soft blobs / aurora** | 2–4 circles in analogous colors with a heavy `feGaussianBlur` (radius ≈ 15% of width) | modern gradient-mesh look without a mesh library |
| **Podium** | a 3D `cylinder` object (not ground), matte (`roughness: 0.9`), colored `tone(wall, -0.06)` | it catches the real contact shadow and reads as part of the set |

### 3.2 The trick that ties it together: shared context

The 3D layer renders onto a transparent canvas. Its contact shadow is semi-transparent black,
so it **lands on whatever ground design is underneath**, and the product looks like it is
standing in the 2D set.

For that to look right, the set has to know where the product is. A design's placeholders can
therefore read the 3D layer's measured layout:

| Variable | Meaning (px) |
| --- | --- |
| `width`, `height` | canvas size |
| `subject.x`, `subject.y`, `subject.w`, `subject.h` | the product's on-screen bounds |
| `subject.cx`, `subject.cy` | its center |
| `subject.floor` | the screen y of the floor plane under the product (the shadow line) |
| `brand.<token>` | a brand color |

The sweep's horizon follows `subject.floor`, and the spotlight centers on `subject.cx`/`cy`.
Moving or reframing the product moves the set with it. A slide with no 3D subject falls
back to `subject = { cx: width/2, cy: height/2, floor: height*0.7, … }`.

### 3.3 The expression language

Placeholders are small expressions: numbers, names (`subject.cx`, params), `+ - * / %`,
parentheses, comparisons, and function calls. There is no ternary; use `cond(test, a, b)`.

| Functions | |
| --- | --- |
| math | `min max clamp round floor ceil abs sin cos sqrt pow lerp cond` |
| color (via **culori**, in OKLCH) | `tone(color, lightness, chroma?)`, `shade(color, deltaL)`, `mix(a, b, t)`, `alpha(color, a)`, `hue(color, degrees)` |

Colors are worked out in OKLCH, so "10% darker" looks equally darker for every hue, unlike
HSL. `apps/studio/src/design/resolve.ts` evaluates the expressions with `expr-eval`. The Python
gate parses the same grammar with a restricted `ast` walk to catch unknown names and syntax
errors. `tests/fixtures/design-expressions.json` is run through both, so they cannot disagree.

The grammar is deliberately small: decimal numbers, `'…'`/`"…"` strings, dotted names,
`+ - * / %`, unary minus, parentheses, one (non-chained) comparison, and calls to the functions
above. `and`/`or`/`not`, `^`, `**`, `?:`, indexing, exponent and hex numbers are rejected. `%` and
`round` behave as in JavaScript.

**Color params** take a `#rrggbb` hex or a brand token name; a token is replaced by its hex
before evaluation. Color functions return lowercase `#rrggbb` (or `#rrggbbaa` when alpha < 1);
`mix` interpolates in OKLab, and out-of-gamut results are brought into sRGB by reducing chroma.

**Loops.** `data-xds-repeat="i"` with `data-xds-count="{{expr}}"` repeats an element `count`
times. Inside it, `i` runs from 0 to count − 1 and `n` is the count. The count is evaluated in the
outer scope, floored and clamped to 0–500; nested loops need distinct names, and `n` always
refers to the innermost loop. Both attributes are removed from the output. Each ground node's
SVG ids (gradients, filters) are prefixed per instance, so two grounds never share a gradient.

### 3.4 Starter designs

`xds/resources/designs/` holds tested starters: `solid`, `sweep`, `spotlight`, `aurora`,
`grain-solid`, `split-tone` and `vignette-dark`. A new project gets `solid` (its first slide's
background, since the ground layer paints the whole canvas and there is no page color); copy the
others in when you want them:

```bash
uv run xds design add ~/xd-projects/launch sweep
```

Each starter is an ordinary design file, meant to be read, changed and copied.

### 3.5 Background rules of thumb (also checked by the audit)

- Keep the background **quiet behind the product and the text**: low luminance variance there
  (`BUSY_BACKGROUND`).
- The product must **separate** from what is directly behind it: its silhouette edge needs
  luminance contrast, not just hue contrast (`SUBJECT_LOW_SEPARATION`).
- The background must not be the most eye-catching thing on the slide. The audit's
  saliency check flags `ATTENTION_ON_BACKGROUND`.
