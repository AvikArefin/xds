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
    field_validator,
    model_validator,
)
from pydantic.alias_generators import to_camel

SCHEMA_VERSION = 3

Layer = Literal["ground", "render", "image", "type"]
LAYERS: tuple[Layer, ...] = ("ground", "render", "image", "type")
Level = Literal["display", "headline", "subhead", "body", "caption"]
LEVELS: tuple[Level, ...] = ("display", "headline", "subhead", "body", "caption")

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


class TypeRole(Model):
    level: Level
    font: str = Field(min_length=1)
    weight: int = Field(default=400, ge=100, le=900)
    italic: bool | None = None
    size: float | None = Field(default=None, gt=0)
    color: str | None = None
    line_height: float | None = Field(default=None, gt=0)
    letter_spacing: float | None = None
    uppercase: bool | None = None


class Brand(Model):
    colors: list[ColorToken] = Field(min_length=1)
    typography: dict[str, TypeRole] = Field(default_factory=dict)

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


class PartPose(Model):
    """Relative to the part's rest pose: degrees about its own pivot, meters in parent space."""

    rotate: Vec3 | None = None
    move: Vec3 | None = None
    hidden: bool | None = None


class AnimationFrame(Model):
    clip: str = Field(min_length=1)
    time: float = Field(ge=0)


class RenderData(Model):
    object: str = Field(min_length=1)
    pose: Pose | None = None
    parts: dict[str, PartPose] | None = None
    animation: AnimationFrame | None = None
    screens: dict[str, str] | None = None


class _NodeBase(Model):
    id: Id
    name: str = ""
    hidden: bool | None = None
    exceptions: list[Exception_] | None = None


class GroundNode(_NodeBase):
    layer: Literal["ground"]
    box: Box
    data: GroundData


class ImageNode(_NodeBase):
    layer: Literal["image"]
    box: Box
    data: ImageData


class TypeNode(_NodeBase):
    layer: Literal["type"]
    box: Box
    data: TypeData


class RenderNode(_NodeBase):
    """No 2D box: the 3D layer covers the slide; position comes from pose and camera."""

    layer: Literal["render"]
    data: RenderData


Node = Annotated[Union[GroundNode, ImageNode, TypeNode, RenderNode], Field(discriminator="layer")]


class Slide(Model):
    id: Id
    name: str = ""
    # No page color: the ground layer paints the whole canvas (a `solid` design for a plain color).
    lighting: LightingOverride | None = None
    camera: Camera | None = None
    nodes: list[Node] = Field(default_factory=list)
    exceptions: list[Exception_] | None = None


class RuleOverrides(Model):
    """Per-project audit tuning: threshold values by name, and rules switched off."""

    set: dict[str, float | list[float]] = Field(default_factory=dict)
    off: list[str] = Field(default_factory=list)


DEFAULT_LAYER_ORDER: list[Layer] = ["ground", "render", "image", "type"]


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
            "node": [n.id for s in self.slides for n in s.nodes],
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
    # Type nodes: the declared role and its level, as the browser resolved them.
    role: str | None = None
    level: Level | None = None
    align: Literal["left", "center", "right"] | None = None
    group: str | None = None
    decorative: bool | None = None


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


# The models whose JSON Schema becomes packages/protocol/src/generated/project.ts.
EXPORTED_TYPES: list[type[BaseModel]] = [
    Project,
    DesignManifest,
    SlideMeasure,
    AuditReport,
    ExportRecord,
]

