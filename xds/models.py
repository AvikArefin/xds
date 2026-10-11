"""The schema of an XDS project: the single description of `project.json`.

Three consumers read these models: the gate (`project.py`), the TypeScript type generator
(`xds schema --emit-types`) and the migrator's conform pass (`migrate/conform.py`), which uses each
field's `default` and `validation_alias` choices to bring old files up to date.

Field names are snake_case in Python and camelCase in JSON (`alias_generator=to_camel`).
The second half of the file describes the derived files (measurements, audit report) and the
design manifest, so the browser and Python share those shapes too.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Any, Literal, Union

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    PlainSerializer,
    TypeAdapter,
    ValidationError,
    field_validator,
    model_validator,
)
from pydantic.alias_generators import to_camel

SCHEMA_VERSION = 3

Layer = Literal["ground", "render", "image", "type"]
LAYERS: tuple[Layer, ...] = ("ground", "render", "image", "type")
Level = Literal["expressive", "display", "headline", "subhead", "body", "caption"]
LEVELS: tuple[Level, ...] = ("expressive", "display", "headline", "subhead", "body", "caption")
# The orientation classes a format falls in (variants and layouts are keyed by them).
Orientation = Literal["portrait", "square", "landscape", "story"]
ORIENTATIONS: tuple[Orientation, ...] = ("portrait", "square", "landscape", "story")


def orientation_of(width: float, height: float) -> Orientation:
    """story: taller than 1.7:1; portrait: taller than 1.05:1; square: within 1.05 either way;
    landscape otherwise. The same thresholds as `orientationOf` in @xds/editor-core."""
    r = height / max(1.0, width)
    if r >= 1.7:
        return "story"
    if r > 1.05:
        return "portrait"
    if r >= 1 / 1.05:
        return "square"
    return "landscape"


# The keys a variant may override; `id`, `layer` and `variants` itself never change.
VARIANT_KEYS = ("box", "layout", "data", "hidden", "name", "exceptions")


def merge_variant(base: Any, patch: Any) -> Any:
    """Deep-merge a variant over a node's JSON: `None` deletes the key, dicts merge key by key,
    anything else replaces (the same rule as `mergeVariant` in @xds/editor-core)."""
    if not isinstance(patch, dict) or not isinstance(base, dict):
        return patch
    out = dict(base)
    for k, v in patch.items():
        if v is None:
            out.pop(k, None)
        elif isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = merge_variant(out[k], v)
        else:
            out[k] = v
    return out

Hex = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]
Id = Annotated[str, Field(min_length=1, pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")]
Vec3 = tuple[float, float, float]
Timestamp = Annotated[
    datetime,
    PlainSerializer(
        lambda d: d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), return_type=str
    ),
]


class Model(BaseModel):
    """Base for every file model: camelCase JSON, unknown fields rejected."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        validate_assignment=False,
    )


def now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


# ---------------------------------------------------------------------------------------------
# project.json
# ---------------------------------------------------------------------------------------------


class Format(Model):
    """The deliverable size. `preset` names a profile in `formats.py` (safe zones, view width)."""

    preset: str | None = None
    width: int = Field(gt=0, le=20000)
    height: int = Field(gt=0, le=20000)


class ColorToken(Model):
    name: str = Field(min_length=1)
    hex: Hex


Wrap = Literal["normal", "balance", "pretty"]


class TypeRole(Model):
    level: Level
    font: str = Field(min_length=1)
    weight: int = Field(default=400, ge=100, le=900)
    italic: bool | None = None
    size: float | None = Field(default=None, gt=0)
    # A factor of the level's band default at this format (1 = the default), used when `size` is
    # absent: the role keeps its place in the hierarchy in every format.
    scale: float | None = Field(default=None, gt=0, le=10)
    color: str | None = None
    line_height: float | None = Field(default=None, gt=0)
    letter_spacing: float | None = None
    uppercase: bool | None = None
    wrap: Wrap | None = None


class Stroke(Model):
    """An outline: width in spacing units (u), color a brand token (default: the text color)."""

    width: float = Field(gt=0, le=20)
    color: str | None = None


class Expression(Model):
    """The project's expression system (design-rules §8): the few values its expressive
    treatments and ornaments draw from. Declared, the coherence rules check against it; absent,
    they infer it from each slide and flag a second angle, stroke or extrusion direction."""

    angles: list[float] | None = Field(default=None, max_length=6)       # degrees (and their negatives)
    skews: list[float] | None = Field(default=None, max_length=4)        # degrees
    stroke_widths: list[float] | None = Field(default=None, max_length=4)  # u
    extrude_angle: float | None = Field(default=None, ge=0, lt=360)      # the one extrusion direction
    radii: list[float] | None = Field(default=None, max_length=4)        # plate corner radii, u
    ornaments: list[str] | None = Field(default=None, max_length=8)      # shape names allowed
    max_treatments: int | None = Field(default=None, ge=1, le=6)         # per slide


class Brand(Model):
    colors: list[ColorToken] = Field(min_length=1)
    typography: dict[str, TypeRole] = Field(default_factory=dict)
    expression: Expression | None = None

    @field_validator("colors")
    @classmethod
    def _unique_colors(cls, colors: list[ColorToken]) -> list[ColorToken]:
        names = [c.name for c in colors]
        dupes = sorted({n for n in names if names.count(n) > 1})
        if dupes:
            raise ValueError(f"duplicate color names: {', '.join(dupes)}")
        return colors

    def color(self, token: str) -> str | None:
        return next((c.hex for c in self.colors if c.name == token), None)


class FontFile(Model):
    family: str = Field(min_length=1)
    path: str = Field(min_length=1)
    weight: int = Field(default=400, ge=100, le=900)
    italic: bool | None = None


class Asset(Model):
    id: Id
    path: str = Field(min_length=1)
    kind: Literal["image", "svg", "model"]


class SafeArea(Model):
    top: float = 0
    right: float = 0
    bottom: float = 0
    left: float = 0


class Screen(Model):
    """A UI mockup (an HTML page) rendered to a texture and shown on a device's screen mesh."""

    id: Id
    path: str = Field(min_length=1)
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    scale: float | None = Field(default=None, gt=0, le=4)
    safe_area: SafeArea | None = None
    # A landscape page on a portrait screen mesh: the device is turned so its top is on the
    # left (`landscape-left`, pose rotation z = +90) or on the right (`landscape-right`, z = −90).
    orientation: Literal["portrait", "landscape-left", "landscape-right"] | None = None

    @property
    def landscape(self) -> bool:
        return self.orientation in ("landscape-left", "landscape-right")


class Material(Model):
    id: Id
    name: str
    color: Hex
    metalness: float = Field(default=0, ge=0, le=1)
    roughness: float = Field(default=0.5, ge=0, le=1)


class Pose(Model):
    """Meters, Euler degrees (XYZ), non-zero scale. Y is up, the floor is y = 0."""

    position: Vec3 = (0, 0, 0)
    rotation: Vec3 = (0, 0, 0)
    scale: Vec3 = (1, 1, 1)

    @field_validator("scale")
    @classmethod
    def _nonzero_scale(cls, scale: Vec3) -> Vec3:
        if any(v == 0 for v in scale):
            raise ValueError("scale components must be non-zero")
        return scale


class SceneObject(Model):
    id: Id
    name: str
    kind: Literal["model", "box", "sphere", "cylinder", "torus", "plane"]
    asset: str | None = None
    params: dict[str, float] | None = None
    material: str | None = None
    pose: Pose = Field(default_factory=Pose)

    @model_validator(mode="after")
    def _model_needs_asset(self) -> SceneObject:
        if self.kind == "model" and not self.asset:
            raise ValueError("a 'model' object needs an asset")
        if self.kind != "model" and self.asset:
            raise ValueError("only 'model' objects take an asset; primitives use params")
        if self.kind == "model" and self.material:
            raise ValueError("a model brings its own materials; 'material' is for primitives")
        return self


Look = Literal["softbox", "contrast", "rim", "bright"]
Shadow = Literal["contact", "soft", "none"]


class Lighting(Model):
    """The complete description of a slide's light (see lighting-and-backgrounds.md)."""

    look: Look = "softbox"
    angle: float = Field(default=35, ge=0, le=360)
    elevation: float = Field(default=30, ge=0, le=80)
    shadow: Shadow = "contact"
    brightness: float = Field(default=0, ge=-1, le=1)
    tint: str | None = None


class LightingOverride(Model):
    """`Slide.lighting`: overrides `project.lighting` field by field."""

    look: Look | None = None
    angle: float | None = Field(default=None, ge=0, le=360)
    elevation: float | None = Field(default=None, ge=0, le=80)
    shadow: Shadow | None = None
    brightness: float | None = Field(default=None, ge=-1, le=1)
    tint: str | None = None


class FrameCamera(Model):
    """Place the subject by canvas percentage; the camera follows."""

    mode: Literal["frame"] = "frame"
    x: float = 50
    y: float = 55
    height: float = Field(default=55, gt=0, le=200)
    yaw: float | None = None
    pitch: float | None = Field(default=None, ge=-89, le=89)
    fov: float | None = Field(default=None, gt=1, lt=120)


class FreeCamera(Model):
    mode: Literal["free"]
    position: Vec3
    target: Vec3
    fov: float = Field(gt=1, lt=120)


Camera = Annotated[Union[FrameCamera, FreeCamera], Field(discriminator="mode")]

FRAME_DEFAULTS = {"x": 50.0, "y": 55.0, "height": 55.0, "yaw": 25.0, "pitch": 12.0, "fov": 30.0}


class Box(Model):
    """Percent of the format, origin top-left, y down."""

    x: float
    y: float
    w: float = Field(gt=0)
    h: float = Field(gt=0)
    rotation: float = 0
    opacity: float = Field(default=1, ge=0, le=1)


class Exception_(Model):
    """A deliberately waived audit rule, with the reason (design-rules §7)."""

    model_config = ConfigDict(title="Exception")

    rule: str = Field(min_length=1)
    reason: str = Field(min_length=1)

    @field_validator("reason")
    @classmethod
    def _real_reason(cls, reason: str) -> str:
        if not reason.strip():
            raise ValueError("an exception needs a reason")
        return reason


Scalar = Union[bool, int, float, str]


class GroundData(Model):
    design: str = Field(min_length=1)
    variant: str | None = None
    values: dict[str, Scalar] | None = None


class ImageData(Model):
    asset: str = Field(min_length=1)
    fit: Literal["cover", "contain", "fill"] = "cover"


Shape = Literal["star-4", "star-8", "sparkle", "ring", "rings", "lens", "ellipse", "rect", "line", "plus",
                "arc", "grid"]
SHAPES: tuple[str, ...] = ("star-4", "star-8", "sparkle", "ring", "rings", "lens", "ellipse", "rect", "line",
                           "plus", "arc", "grid")


class ShapeData(Model):
    """An ornament on the 2D layer, drawn by the renderer (no file): a parameterized vector shape
    with a stroke in u and a fill token. `params` are the shape's own knobs (e.g. `count` for
    rings, `points` for a star, `radius` for a rect's corners, in u)."""

    shape: Shape
    stroke: Stroke | None = None
    fill: str | None = None          # a brand color token, or "none"
    params: dict[str, float] | None = None


class Stack(Model):
    """Place a block a set gap below, above, right of or left of another block, measured ink to
    ink (text) or box to box (images).

    `gap` is in spacing units (u). The anchor is a text, image or shape node on the same slide.
    While a stack is set, the block's `box.y` (or `box.x`, for a horizontal stack) is ignored:
    the layout decides it.
    """

    below: str | None = Field(default=None, min_length=1)
    above: str | None = Field(default=None, min_length=1)
    right_of: str | None = Field(default=None, min_length=1)
    left_of: str | None = Field(default=None, min_length=1)
    gap: float = Field(default=2, ge=-100, le=100)

    @model_validator(mode="after")
    def _one_anchor(self) -> Stack:
        if sum(v is not None for v in (self.below, self.above, self.right_of, self.left_of)) != 1:
            raise ValueError("a stack names exactly one anchor: 'below', 'above', 'rightOf' or 'leftOf'")
        return self

    @property
    def anchor(self) -> str:
        return self.below or self.above or self.right_of or self.left_of or ""

    @property
    def axis(self) -> Literal["x", "y"]:
        return "x" if (self.right_of or self.left_of) else "y"


PinLine = Literal["edge", "safe", "margin", "center", "third", "two-thirds"]


class Pin(Model):
    """Pin a box edge (or center) to a line of the format, plus an offset in u. Lines re-resolve
    in every format, so a pinned edge stays on the margin when the format changes."""

    to: PinLine
    offset: float = Field(default=0, ge=-100, le=100)


class Pins(Model):
    """Which edges are pinned. Opposite edges both pinned (left and right) size the box; an edge
    and its center pinned together is an error."""

    left: Pin | None = None
    right: Pin | None = None
    top: Pin | None = None
    bottom: Pin | None = None
    cx: Pin | None = None
    cy: Pin | None = None

    @model_validator(mode="after")
    def _no_overconstraint(self) -> Pins:
        if self.cx is not None and (self.left is not None or self.right is not None):
            raise ValueError("pin either the center (cx) or the left/right edges, not both")
        if self.cy is not None and (self.top is not None or self.bottom is not None):
            raise ValueError("pin either the center (cy) or the top/bottom edges, not both")
        return self


AlignEdge = Literal["left", "center", "right", "top", "middle", "bottom"]


class AlignTo(Model):
    """Share an edge (or center line) with another node on the slide, plus an offset in u."""

    node: str = Field(min_length=1)
    edge: AlignEdge
    offset: float = Field(default=0, ge=-100, le=100)


class Layout(Model):
    """How a 2D node's box is decided beyond its numbers (data-models §2.5a). Every relation
    resolves to a plain box, which the editor keeps written in `box`; dragging a related node
    edits the relation's offset or gap, or detaches it.

    - `pin`: edges to lines of the format (margin, safe zone, center, thirds);
    - `align`: edges shared with other nodes (at most one per axis);
    - `stack`: a gap below/above/right of/left of another node (in u, ink to ink);
    - `fit`: `"text"` makes a text box as tall as its laid-out text;
    - `group`: a flow group on the slide (`Slide.groups`) that lays its members out.
    """

    pin: Pins | None = None
    align: list[AlignTo] | None = Field(default=None, max_length=2)
    stack: Stack | None = None
    fit: Literal["text"] | None = None
    group: str | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def _one_per_axis(self) -> Layout:
        if self.align:
            axes = ["x" if a.edge in ("left", "center", "right") else "y" for a in self.align]
            if len(set(axes)) != len(axes):
                raise ValueError("align at most once per axis (one of left/center/right, one of top/middle/bottom)")
        return self


class Group(Model):
    """A flow group (data-models §2.5b): its members (nodes whose `layout.group` names it, in
    z-order) are laid out in a column or row with a gap in u, inside a box that `pin` places."""

    direction: Literal["column", "row"] = "column"
    gap: float = Field(default=2, ge=0, le=100)
    align: Literal["start", "center", "end"] = "start"
    padding: float = Field(default=0, ge=0, le=100)
    pin: Pins | None = None


class Extrude(Model):
    """Stacked copies behind the text in one direction: depth and angle, like a cast shadow or a
    3D block face."""

    depth: float = Field(gt=0, le=40)          # u
    angle: float = Field(default=135, ge=0, lt=360)
    color: str | None = None                   # token; default: the text color at 40 %
    steps: int | None = Field(default=None, ge=1, le=64)


class Repeat(Model):
    """The block drawn `count` times, each copy offset by (dx, dy) u from the last, behind the
    original. `outline` alternates filled and outlined copies; `fade` dims them towards the back."""

    count: int = Field(ge=2, le=12)
    dx: float = Field(default=0, ge=-100, le=100)
    dy: float = Field(default=0, ge=-100, le=100)
    outline: bool | None = None
    fade: bool | None = None


class Plate(Model):
    """A rounded plate behind the text: padding and corner radius in u, a fill token and/or stroke."""

    padding: float = Field(default=2, ge=0, le=40)
    radius: float = Field(default=0, ge=0, le=40)
    fill: str | None = None
    stroke: Stroke | None = None


class TypeData(Model):
    text: str
    role: str = Field(min_length=1)
    align: Literal["left", "center", "right"] = "left"
    valign: Literal["top", "middle", "bottom"] = "top"
    color: str | None = None
    size: float | None = Field(default=None, gt=0)
    weight: int | None = Field(default=None, ge=100, le=900)
    italic: bool | None = None
    line_height: float | None = Field(default=None, gt=0)
    letter_spacing: float | None = None
    uppercase: bool | None = None
    group: str | None = None
    decorative: bool | None = None
    wrap: Wrap | None = None
    stack: Stack | None = None   # kept for existing files; new files put it in `layout.stack`
    # A factor of the role's effective size (1 = the role's), used when `size` is absent.
    scale: float | None = Field(default=None, gt=0, le=10)
    # Expressive treatments (design-rules §8). Each is one renderer feature with checkable numbers.
    skew: float | None = Field(default=None, ge=-45, le=45)        # degrees, a slant of the glyphs
    fill: Literal["solid", "none"] | None = None                   # "none" + stroke = outline text
    stroke: Stroke | None = None
    extrude: Extrude | None = None
    repeat: Repeat | None = None
    plate: Plate | None = None
    fit_width: bool | None = None   # size the text so its longest line fills the box width (display type)


class PartPose(Model):
    """Relative to the part's rest pose: degrees about its own pivot, meters in parent space."""

    rotate: Vec3 | None = None
    move: Vec3 | None = None
    hidden: bool | None = None


class AnimationFrame(Model):
    clip: str = Field(min_length=1)
    time: float = Field(ge=0)


class Place(Model):
    """Put this object on the canvas by percentage, like a frame camera does for the whole subject:
    its center at (x, y) % and its height `height` % of the canvas height. The object is moved
    and scaled to land there; the camera's yaw, pitch and fov still set the view."""

    x: float = 50
    y: float = 55
    height: float = Field(default=40, gt=0, le=200)


class RenderData(Model):
    object: str = Field(min_length=1)
    pose: Pose | None = None
    place: Place | None = None
    parts: dict[str, PartPose] | None = None
    animation: AnimationFrame | None = None
    screens: dict[str, str] | None = None


class _NodeBase(Model):
    id: Id
    name: str = ""
    hidden: bool | None = None
    exceptions: list[Exception_] | None = None
    # Per-orientation overrides (data-models §2.5c): fields merged over the node when the format
    # falls in that class, so one source serves a portrait post and a landscape banner.
    variants: dict[Orientation, dict[str, Any]] | None = None


class GroundNode(_NodeBase):
    layer: Literal["ground"]
    box: Box
    layout: Layout | None = None
    data: GroundData


class ImageNode(_NodeBase):
    layer: Literal["image"]
    box: Box
    layout: Layout | None = None
    data: Union[ImageData, ShapeData]


class TypeNode(_NodeBase):
    layer: Literal["type"]
    box: Box
    layout: Layout | None = None
    data: TypeData


class RenderNode(_NodeBase):
    """No 2D box: the 3D layer covers the slide; position comes from pose and camera."""

    layer: Literal["render"]
    data: RenderData


Node = Annotated[Union[GroundNode, ImageNode, TypeNode, RenderNode], Field(discriminator="layer")]
NodeAdapter = TypeAdapter(Node)


def apply_variant(node: Any, orientation: Orientation) -> Any:
    """The node as a format of this orientation shows it: its base with `variants[orientation]`
    merged over it (data-models §2.5c). Raises `ValidationError` for a variant that does not
    produce a valid node; `Project.effective_nodes` falls back to the base then (the gate reports
    `VARIANT_INVALID`)."""
    patch = (node.variants or {}).get(orientation)
    if not patch:
        return node
    doc = node.model_dump(mode="json", by_alias=True, exclude_none=True)
    merged = merge_variant(doc, {k: v for k, v in patch.items() if k in VARIANT_KEYS})
    return NodeAdapter.validate_python(merged)


class Slide(Model):
    id: Id
    name: str = ""
    # No page color: the ground layer paints the whole canvas (a `solid` design for a plain color).
    lighting: LightingOverride | None = None
    camera: Camera | None = None
    nodes: list[Node] = Field(default_factory=list)
    exceptions: list[Exception_] | None = None
    groups: dict[str, Group] | None = None
    # False: the project's master nodes are left off this slide; a list: those master ids are.
    master: Union[bool, list[str]] | None = None


class RuleOverrides(Model):
    """Per-project audit tuning: threshold values by name, and rules switched off."""

    set: dict[str, float | list[float]] = Field(default_factory=dict)
    off: list[str] = Field(default_factory=list)


DEFAULT_LAYER_ORDER: list[Layer] = ["ground", "render", "image", "type"]


class Master(Model):
    """Nodes every slide shows (data-models §2.8): a background, the logo, a footer. They render
    behind the slide's own nodes of the same layer and cannot be edited per slide, only excluded
    (`Slide.master`). Ids must not collide with slide node ids."""

    nodes: list[Node] = Field(default_factory=list)


class Project(Model):
    schema_version: Literal[3] = SCHEMA_VERSION
    id: Annotated[str, Field(min_length=1, pattern=r"^[a-z0-9-]+$")]
    name: str = Field(min_length=1)
    description: str = ""
    created_at: Timestamp = Field(default_factory=now)
    updated_at: Timestamp = Field(default_factory=now)
    format: Format
    brand: Brand
    fonts: list[FontFile] = Field(default_factory=list)
    assets: list[Asset] = Field(default_factory=list)
    screens: list[Screen] = Field(default_factory=list)
    materials: list[Material] = Field(default_factory=list)
    objects: list[SceneObject] = Field(default_factory=list)
    layer_order: list[Layer] = Field(default_factory=lambda: list(DEFAULT_LAYER_ORDER))
    lighting: Lighting | None = None
    rules: RuleOverrides | None = None
    master: Master | None = None
    slides: list[Slide] = Field(min_length=1)

    @field_validator("layer_order")
    @classmethod
    def _permutation(cls, order: list[Layer]) -> list[Layer]:
        if sorted(order) != sorted(LAYERS):
            raise ValueError("layerOrder must list each of ground, render, image, type once")
        return order

    @model_validator(mode="after")
    def _unique_ids(self) -> Project:
        def dupes(ids: list[str]) -> list[str]:
            return sorted({i for i in ids if ids.count(i) > 1})

        checks = {
            "slide": [s.id for s in self.slides],
            "node": [n.id for s in self.slides for n in s.nodes]
                    + [n.id for n in (self.master.nodes if self.master else [])],
            "asset": [a.id for a in self.assets],
            "object": [o.id for o in self.objects],
            "material": [m.id for m in self.materials],
            "screen": [s.id for s in self.screens],
        }
        for kind, ids in checks.items():
            if d := dupes(ids):
                raise ValueError(f"duplicate {kind} ids: {', '.join(d)}")
        return self

    # Convenience lookups used across the Python side.
    def slide(self, slide_id: str) -> Slide | None:
        return next((s for s in self.slides if s.id == slide_id), None)

    def master_nodes_for(self, slide: Slide) -> list[Node]:
        """The master nodes a slide shows: all, none (`master: false`) or all but the listed ids."""
        if not self.master or slide.master is False:
            return []
        off = set(slide.master) if isinstance(slide.master, list) else set()
        return [n for n in self.master.nodes if n.id not in off]

    @property
    def orientation(self) -> Orientation:
        return orientation_of(self.format.width, self.format.height)

    def effective_nodes(self, slide: Slide) -> list[Node]:
        """Every node a slide draws: its master nodes first (behind), then its own, each with the
        format's orientation variant applied (an invalid variant falls back to the base)."""
        o = self.orientation
        out = []
        for n in [*self.master_nodes_for(slide), *slide.nodes]:
            try:
                out.append(apply_variant(n, o))
            except ValidationError:
                out.append(n)
        return out

    def asset(self, asset_id: str) -> Asset | None:
        return next((a for a in self.assets if a.id == asset_id), None)

    def object(self, object_id: str) -> SceneObject | None:
        return next((o for o in self.objects if o.id == object_id), None)

    def screen(self, screen_id: str) -> Screen | None:
        return next((s for s in self.screens if s.id == screen_id), None)

    def slide_lighting(self, slide: Slide) -> Lighting:
        base = (self.lighting or Lighting()).model_dump()
        if slide.lighting:
            base.update(slide.lighting.model_dump(exclude_none=True))
        return Lighting.model_validate(base)

    def to_json(self) -> dict[str, Any]:
        """The canonical serialized form: camelCase, declared key order, no nulls."""
        return self.model_dump(mode="json", by_alias=True, exclude_none=True)


# ---------------------------------------------------------------------------------------------
# designs/<id>.svg manifest (the JSON inside <metadata id="xds-design">)
# ---------------------------------------------------------------------------------------------


class DesignParam(Model):
    name: str = Field(min_length=1, pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")
    type: Literal["number", "color", "select", "boolean", "text"]
    label: str | None = None
    default: Scalar
    min: float | None = None
    max: float | None = None
    step: float | None = None
    options: list[str] | None = None


class DesignVariant(Model):
    name: str = Field(min_length=1)
    values: dict[str, Scalar]


class DesignManifest(Model):
    name: str | None = None
    params: list[DesignParam] = Field(default_factory=list)
    variants: list[DesignVariant] | None = None


# ---------------------------------------------------------------------------------------------
# Derived files: what the render page measures, and the audit report
# ---------------------------------------------------------------------------------------------


class Rect(Model):
    x: float
    y: float
    w: float
    h: float


class MeasuredLine(Model):
    text: str
    rect: Rect
    baseline: float


class MeasuredStyle(Model):
    font: str
    size: float
    weight: float
    line_height: float  # px
    letter_spacing: float  # em
    color: str  # "#rrggbb"
    uppercase: bool
    italic: bool = False


class MeasuredNode(Model):
    id: str
    layer: Layer
    box: Rect
    lines: list[MeasuredLine] | None = None
    style: MeasuredStyle | None = None
    overflow: bool | None = None
    content_height: float | None = None  # type nodes: the laid-out text's height, px (box.h must hold it)
    # Type nodes: the declared role and its level, as the browser resolved them.
    role: str | None = None
    level: Level | None = None
    align: Literal["left", "center", "right"] | None = None
    group: str | None = None
    decorative: bool | None = None
    # Treated or rotated text (design-rules §8): the ink's corners on the canvas, px, after the
    # treatments (stroke, extrusion, repeats, plate), skew and rotation. The audit masks such a
    # block by this polygon ∩ the type layer's alpha instead of its axis-aligned line rects.
    ink_polygon: list[tuple[float, float]] | None = None
    treated: bool | None = None


class MeasuredSubject(Model):
    bounds: Rect
    coverage: float  # fraction of the canvas covered by the silhouette
    floor: float | None = None  # screen y of the floor plane under the subject


class MeasuredScreen(Model):
    """A device screen as it appears on the slide (for the SCREEN_* rules)."""

    screen_id: str
    object_id: str
    mesh: str
    rect: Rect  # on-slide bounds of the screen mesh, px
    displayed_width: float  # px the screen's logical width spans on the slide
    mesh_aspect: float | None = None  # width / height of the mesh's UV-mapped face


class SlideMeasure(Model):
    slide_id: str
    width: int
    height: int
    nodes: list[MeasuredNode]
    subject: MeasuredSubject | None = None
    screens: list[MeasuredScreen] = Field(default_factory=list)
    layers: dict[str, str] = Field(default_factory=dict)  # layer → mask PNG (cache-relative)
    background_only: str | None = None  # composite without the type layer
    slide_png: str | None = None


Severity = Literal["error", "warn", "info"]


EditValue = Union[bool, int, float, str, list[Any], dict[str, Any]]


class Edit(Model):
    """One field written by a fix: a dotted path on the node (`box.y`, `data.size`,
    `layout.stack.gap`), on the slide when `node_id` is absent (`camera.height`), or on the
    project when both are (`brand.typography.body.size`). `value` replaces; absent deletes."""

    slide_id: str | None = None
    node_id: str | None = None
    path: str = Field(min_length=1)
    value: EditValue | None = None


class Finding(Model):
    rule: str
    family: str
    severity: Severity
    status: Literal["open", "waived"] = "open"
    slide_id: str | None = None
    nodes: list[str] = Field(default_factory=list)
    region: Rect | None = None
    message: str
    measured: dict[str, Any] = Field(default_factory=dict)
    expected: dict[str, Any] = Field(default_factory=dict)
    fix: str = ""
    principle: str = ""
    # The fix as edits (design-rules §6): `xds fix` and the editor's Fix button apply them.
    edits: list[Edit] | None = None
    path: str | None = None  # JSON path, for structural findings
    waiver: dict[str, str] | None = None


class AuditSummary(Model):
    errors: int = 0
    warnings: int = 0
    infos: int = 0
    waived: int = 0


class AuditReport(Model):
    source_hash: str
    format: str
    created_at: Timestamp = Field(default_factory=now)
    slides: list[str] = Field(default_factory=list)  # the slide ids this report covers
    summary: AuditSummary
    findings: list[Finding]


class ExportRecord(Model):
    source_hash: str
    format: str
    created_at: Timestamp = Field(default_factory=now)
    files: list[str]
    audit: dict[str, int]
    forced: bool
    # Set when the export was made from a target (the source reflowed to another preset): the
    # source's format, so the record says where the files came from.
    source_format: str | None = None


# The models whose JSON Schema becomes packages/protocol/src/generated/project.ts.
EXPORTED_TYPES: list[type[BaseModel]] = [
    Project,
    DesignManifest,
    SlideMeasure,
    AuditReport,
    ExportRecord,
]

