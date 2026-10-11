"""Expression and coherence (design-rules §8).

Expressive work is checked for *coherence*, never for taste: every treatment and ornament on a
slide should draw from one small system of values (one angle family, one skew, one stroke scale,
one extrusion direction, one ornament family). `brand.expression` declares that system; without
it, each rule infers it from the slide and flags a second value. The rules read the source nodes
(treatments live in the file) and the measured geometry; they never need pixels.
"""

from __future__ import annotations

import math
from typing import TYPE_CHECKING, Any, Iterator

from ...models import ImageNode, ShapeData, TypeNode
from ..geometry import R, union_all
from ..registry import Hit, rule

if TYPE_CHECKING:
    from ...models import Expression
    from ..measured import MeasuredSlide
    from ..thresholds import Thresholds

FAMILY = "expression"

ORNAMENT_FAMILIES: dict[str, str] = {
    "star-4": "stars", "star-8": "stars", "sparkle": "stars",
    "ring": "rings", "rings": "rings", "lens": "rings", "ellipse": "rings", "arc": "rings",
    "rect": "grids", "line": "grids", "plus": "grids", "grid": "grids",
}


# --- what the slide declares ---------------------------------------------------------------

def _system(s: MeasuredSlide) -> Expression | None:
    return s.project.brand.expression


def _visible(s: MeasuredSlide) -> list[Any]:
    """The slide's 2D source nodes that are shown and measured (hidden ones carry no treatment)."""
    return [n for n in s.project.effective_nodes(s.slide)
            if n.layer != "render" and not n.hidden and s.node(n.id) is not None]


def _type_nodes(s: MeasuredSlide) -> list[TypeNode]:
    return [n for n in _visible(s) if isinstance(n, TypeNode)]


def _shape_nodes(s: MeasuredSlide) -> list[ImageNode]:
    return [n for n in _visible(s) if isinstance(n, ImageNode) and isinstance(n.data, ShapeData)]


def _rect(s: MeasuredSlide, node_id: str) -> R | None:
    m = s.node(node_id)
    return s.ink(m) if m is not None else None


def _region(s: MeasuredSlide, ids: list[str]) -> R | None:
    return union_all(r for r in (_rect(s, i) for i in ids) if r is not None)


def _distinct(values: list[float], tol: float) -> list[float]:
    """Values merged when within `tol` of one already kept, ascending."""
    out: list[float] = []
    for v in sorted(values):
        if not out or v - out[-1] > tol:
            out.append(v)
    return out


def _fmt(v: float) -> str:
    return f"{v:g}"


# --- angles --------------------------------------------------------------------------------

def angle_family(angle: float) -> float:
    """The angle family: −a is a's family and 90° steps are the same family, so 12, −12, 102
    and −78 all read as 12 (the canonical family is in 0–45)."""
    f = angle % 90
    return round(min(f, 90 - f), 3)


def _in_family(angle: float, declared: list[float], tol: float) -> bool:
    fam = angle_family(angle)
    return any(abs(fam - angle_family(d)) <= tol for d in declared)


@rule("ANGLE_OFF_SYSTEM", family=FAMILY, severity="warn", thresholds=("expression.angleTolerance",))
def angle_off_system(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """One angle family per design: rotated blocks share an angle (or its negative, or a right
    angle to it); a second angle reads as a slip, not a system.

    Checked against `brand.expression.angles`; without them, a slide may use two families.
    """
    tol = t["expression.angleTolerance"]
    rotated = [(n, n.box.rotation % 360) for n in _visible(s) if n.layer != "ground" and n.box.rotation % 360]
    if not rotated:
        return
    sysm = _system(s)
    if sysm and sysm.angles:
        for n, a in rotated:
            if _in_family(a, sysm.angles, tol):
                continue
            nearest = min(sysm.angles, key=lambda d: abs(angle_family(a) - angle_family(d)))
            yield Hit(
                nodes=[n.id], region=_rect(s, n.id),
                message=f"'{s.name(n.id)}' is rotated {_fmt(n.box.rotation)}°, outside the brand's angles "
                        f"({', '.join(_fmt(d) for d in sysm.angles)}).",
                measured={"rotation": n.box.rotation}, expected={"angles": sysm.angles},
                fix=f"Set box.rotation to {_fmt(nearest)} (or its negative), or add it to brand.expression.angles",
            )
        return
    fams = _distinct([angle_family(a) for _, a in rotated], tol)
    if len(fams) > 2:
        ids = [n.id for n, _ in rotated]
        yield Hit(
            nodes=ids, region=_region(s, ids),
            message=f"The slide rotates blocks in {len(fams)} angle families: {', '.join(_fmt(f) for f in fams)}°.",
            measured={"angleFamilies": fams}, expected={"angleFamiliesMax": 2},
            fix="Use one angle (its negative and right angles count as the same) for every rotated block, "
                "or declare the set in brand.expression.angles",
        )


@rule("SKEW_MIXED", family=FAMILY, severity="warn", thresholds=("expression.angleTolerance",))
def skew_mixed(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """One slant: skewed type on a slide shares a single skew angle.

    Checked against `brand.expression.skews` when declared.
    """
    tol = t["expression.angleTolerance"]
    skewed = [n for n in _type_nodes(s) if n.data.skew]
    if not skewed:
        return
    sysm = _system(s)
    if sysm and sysm.skews:
        for n in skewed:
            if any(abs(abs(n.data.skew) - abs(d)) <= tol for d in sysm.skews):
                continue
            nearest = min(sysm.skews, key=lambda d: abs(abs(n.data.skew) - abs(d)))
            yield Hit(
                nodes=[n.id], region=_rect(s, n.id),
                message=f"'{s.name(n.id)}' is skewed {_fmt(n.data.skew)}°, outside the brand's skews "
                        f"({', '.join(_fmt(d) for d in sysm.skews)}).",
                measured={"skew": n.data.skew}, expected={"skews": sysm.skews},
                fix=f"Set data.skew to {_fmt(nearest)}",
            )
        return
    values = _distinct([abs(n.data.skew) for n in skewed], tol)
    if len(values) > 1:
        ids = [n.id for n in skewed]
        yield Hit(
            nodes=ids, region=_region(s, ids),
            message=f"The slide skews type at {len(values)} angles: {', '.join(_fmt(v) for v in values)}°.",
            measured={"skews": values}, expected={"skewsMax": 1},
            fix=f"Set data.skew to {_fmt(values[0])} on every skewed block, or declare brand.expression.skews",
        )


# --- strokes, extrusions, plates ------------------------------------------------------------

def _strokes(s: MeasuredSlide) -> list[tuple[str, float, str]]:
    """(node id, width in u, path) of every stroke on the slide."""
    out: list[tuple[str, float, str]] = []
    for n in _type_nodes(s):
        if n.data.stroke:
            out.append((n.id, n.data.stroke.width, "data.stroke.width"))
        if n.data.plate and n.data.plate.stroke:
            out.append((n.id, n.data.plate.stroke.width, "data.plate.stroke.width"))
    for n in _shape_nodes(s):
        if n.data.stroke:
            out.append((n.id, n.data.stroke.width, "data.stroke.width"))
    return out


@rule("STROKE_OFF_SCALE", family=FAMILY, severity="warn", thresholds=("expression.strokeStep",))
def stroke_off_scale(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """One line weight (two at most): outlines and ornaments drawn with the same stroke read as
    one drawing; a stroke off the quarter-unit scale looks arbitrary.

    Checked against `brand.expression.strokeWidths` when declared.
    """
    strokes = _strokes(s)
    if not strokes:
        return
    sysm = _system(s)
    step = t["expression.strokeStep"]
    if sysm and sysm.stroke_widths:
        for node_id, w, path in strokes:
            if any(abs(w - d) <= 0.01 for d in sysm.stroke_widths):
                continue
            nearest = min(sysm.stroke_widths, key=lambda d: abs(w - d))
            yield Hit(
                nodes=[node_id], region=_rect(s, node_id),
                message=f"'{s.name(node_id)}' has a {_fmt(w)}u stroke, outside the brand's widths "
                        f"({', '.join(_fmt(d) for d in sysm.stroke_widths)}u).",
                measured={"strokeU": w}, expected={"strokeWidths": sysm.stroke_widths},
                fix=f"Set {path} to {_fmt(nearest)}",
            )
        return
    for node_id, w, path in strokes:
        off = abs(w / step - round(w / step)) * step
        if off > 0.01:
            snapped = round(w / step) * step or step
            yield Hit(
                nodes=[node_id], region=_rect(s, node_id),
                message=f"'{s.name(node_id)}' has a {_fmt(w)}u stroke, off the {_fmt(step)}u scale.",
                measured={"strokeU": w}, expected={"strokeStepU": step},
                fix=f"Set {path} to {_fmt(snapped)}",
            )
    widths = _distinct([w for _, w, _ in strokes], 0.01)
    if len(widths) > 2:
        ids = [i for i, _, _ in strokes]
        yield Hit(
            nodes=ids, region=_region(s, ids),
            message=f"The slide draws strokes at {len(widths)} widths: {', '.join(_fmt(w) for w in widths)}u.",
            measured={"strokeWidths": widths}, expected={"strokeWidthsMax": 2},
            fix="Draw every outline and ornament with one stroke width (two at most), "
                "or declare brand.expression.strokeWidths",
        )


def _directions(s: MeasuredSlide) -> list[tuple[str, float, str]]:
    """(node id, direction in degrees, path) of every extrusion and directed repeat. 0° is to
    the right, 90° down (screen coordinates)."""
    out: list[tuple[str, float, str]] = []
    for n in _type_nodes(s):
        if n.data.extrude:
            out.append((n.id, n.data.extrude.angle % 360, "data.extrude.angle"))
        r = n.data.repeat
        if r and (r.dx or r.dy):
            out.append((n.id, math.degrees(math.atan2(r.dy, r.dx)) % 360, "data.repeat.dx/dy"))
    return out


def _angular_diff(a: float, b: float) -> float:
    d = abs(a - b) % 360
    return min(d, 360 - d)


@rule("EXTRUDE_DIRECTION_MIXED", family=FAMILY, severity="warn", thresholds=("expression.extrudeTolerance",))
def extrude_direction_mixed(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """One light: extrusions and repeated copies on a slide fall in one direction, like shadows
    from one lamp.

    Checked against `brand.expression.extrudeAngle` when declared.
    """
    dirs = _directions(s)
    if not dirs:
        return
    tol = t["expression.extrudeTolerance"]
    sysm = _system(s)
    if sysm and sysm.extrude_angle is not None:
        for node_id, a, path in dirs:
            if _angular_diff(a, sysm.extrude_angle) <= tol:
                continue
            yield Hit(
                nodes=[node_id], region=_rect(s, node_id),
                message=f"'{s.name(node_id)}' extrudes towards {round(a)}°; the brand's direction is "
                        f"{_fmt(sysm.extrude_angle)}°.",
                measured={"angle": round(a, 1)}, expected={"extrudeAngle": sysm.extrude_angle},
                fix=f"Set {path} so the direction is {_fmt(sysm.extrude_angle)}°",
            )
        return
    ref = dirs[0][1]
    if any(_angular_diff(a, ref) > tol for _, a, _ in dirs):
        ids = [i for i, _, _ in dirs]
        yield Hit(
            nodes=ids, region=_region(s, ids),
            message="Extrusions on the slide fall in different directions: "
                    + ", ".join(f"'{s.name(i)}' {round(a)}°" for i, a, _ in dirs) + ".",
            measured={"angles": [round(a, 1) for _, a, _ in dirs]}, expected={"spreadMax": tol},
            fix=f"Give every extrusion and repeat the direction of '{s.name(dirs[0][0])}' ({round(ref)}°), "
                "or declare brand.expression.extrudeAngle",
        )


@rule("EXTRUDE_AGAINST_LIGHT", family=FAMILY, severity="info", thresholds=())
def extrude_against_light(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Shadows agree: a 2D extrusion that falls towards the side the 3D key light comes from
    contradicts the product's own shadow.

    The key light's side is its yaw relative to the camera (`angle − yaw`: positive is to the
    right of the view). Only clearly horizontal extrusions are compared, only on slides with a
    lit subject and a frame camera.
    """
    dirs = _directions(s)
    if not dirs or not s.render_nodes:
        return
    cam = s.camera()
    if cam is None:
        return
    lighting = s.project.slide_lighting(s.slide)
    side = math.sin(math.radians(lighting.angle - cam["yaw"]))
    light_side = 1 if side > 0.2 else -1 if side < -0.2 else 0
    if not light_side:
        return
    for node_id, a, path in dirs:
        horizontal = math.cos(math.radians(a))
        if abs(horizontal) < 0.5:
            continue
        if (1 if horizontal > 0 else -1) == light_side:
            where = "right" if light_side > 0 else "left"
            yield Hit(
                nodes=[node_id], region=_rect(s, node_id),
                message=f"'{s.name(node_id)}' extrudes towards the {where}, where the key light comes from "
                        f"(lighting.angle {_fmt(lighting.angle)}°).",
                measured={"angle": round(a, 1), "lightingAngle": lighting.angle}, expected={"awayFromLight": True},
                fix=f"Mirror {path} so the extrusion falls away from the light, or move lighting.angle",
            )


@rule("RADIUS_OFF_SYSTEM", family=FAMILY, severity="info", thresholds=())
def radius_off_system(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """One corner: plates and rectangles share a corner radius (two at most).

    Checked against `brand.expression.radii` when declared.
    """
    radii: list[tuple[str, float, str]] = []
    for n in _type_nodes(s):
        if n.data.plate:
            radii.append((n.id, n.data.plate.radius, "data.plate.radius"))
    for n in _shape_nodes(s):
        if n.data.shape == "rect" and n.data.params and "radius" in n.data.params:
            radii.append((n.id, n.data.params["radius"], "data.params.radius"))
    if not radii:
        return
    sysm = _system(s)
    if sysm and sysm.radii:
        for node_id, r, path in radii:
            if any(abs(r - d) <= 0.01 for d in sysm.radii):
                continue
            nearest = min(sysm.radii, key=lambda d: abs(r - d))
            yield Hit(
                nodes=[node_id], region=_rect(s, node_id),
                message=f"'{s.name(node_id)}' has a {_fmt(r)}u corner radius, outside the brand's radii "
                        f"({', '.join(_fmt(d) for d in sysm.radii)}u).",
                measured={"radiusU": r}, expected={"radii": sysm.radii},
                fix=f"Set {path} to {_fmt(nearest)}",
            )
        return
    values = _distinct([r for _, r, _ in radii], 0.01)
    if len(values) > 2:
        ids = [i for i, _, _ in radii]
        yield Hit(
            nodes=ids, region=_region(s, ids),
            message=f"The slide rounds corners at {len(values)} radii: {', '.join(_fmt(v) for v in values)}u.",
            measured={"radii": values}, expected={"radiiMax": 2},
            fix="Use one corner radius (two at most), or declare brand.expression.radii",
        )


# --- ornaments ------------------------------------------------------------------------------

@rule("ORNAMENT_FAMILY_MIXED", family=FAMILY, severity="warn", thresholds=())
def ornament_family_mixed(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """One family of ornaments: stars, rings or grids, not a mix; mixed motifs look like clip
    art.

    Checked against `brand.expression.ornaments` when declared.
    """
    shapes = _shape_nodes(s)
    if not shapes:
        return
    sysm = _system(s)
    if sysm and sysm.ornaments:
        for n in shapes:
            if n.data.shape in sysm.ornaments:
                continue
            yield Hit(
                nodes=[n.id], region=_rect(s, n.id),
                message=f"'{s.name(n.id)}' is a {n.data.shape}, not one of the brand's ornaments "
                        f"({', '.join(sysm.ornaments)}).",
                measured={"shape": n.data.shape}, expected={"ornaments": sysm.ornaments},
                fix=f"Set data.shape to one of {', '.join(sysm.ornaments)}, or add it to brand.expression.ornaments",
            )
        return
    fams: dict[str, list[str]] = {}
    for n in shapes:
        fams.setdefault(ORNAMENT_FAMILIES.get(n.data.shape, n.data.shape), []).append(n.id)
    if len(fams) > 1:
        ids = [i for ids in fams.values() for i in ids]
        yield Hit(
            nodes=ids, region=_region(s, ids),
            message=f"The slide mixes ornament families: {', '.join(sorted(fams))}.",
            measured={"families": sorted(fams)}, expected={"familiesMax": 1},
            fix="Keep one family (stars: star-4, star-8, sparkle · rings: ring, rings, lens, ellipse, arc · "
                "grids: rect, line, plus, grid), or declare brand.expression.ornaments",
        )


@rule("MOTIF_SCALE_OFF", family=FAMILY, severity="info", thresholds=("expression.motifTolerance",))
def motif_scale_off(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Ornaments sit on the spacing scale: a motif's size is a multiple of u, and a slide uses
    at most three motif sizes, so repeats read as a rhythm rather than a scatter."""
    shapes = _shape_nodes(s)
    if not shapes:
        return
    u = s.guide.u
    tol = t["expression.motifTolerance"]
    sizes: list[float] = []
    for n in shapes:
        m = s.node(n.id)
        if m is None:
            continue
        size = max(m.box.w, m.box.h)
        sizes.append(size)
        off = abs(size - round(size / u) * u)
        if off > tol:
            target = max(u, round(size / u) * u)
            axis = "w" if m.box.w >= m.box.h else "h"
            yield Hit(
                nodes=[n.id], region=_rect(s, n.id),
                message=f"'{s.name(n.id)}' is {size:.0f}px across, {off:.0f}px off the {u}px scale.",
                measured={"sizePx": round(size, 1)}, expected={"multipleOf": u},
                fix=f"Set box.{axis} to {100 * target / (s.width if axis == 'w' else s.height):.2f} ({target:.0f}px)",
            )
    distinct = _distinct([round(v / u) * u for v in sizes], 0.5)
    if len(distinct) > 3:
        ids = [n.id for n in shapes]
        yield Hit(
            nodes=ids, region=_region(s, ids),
            message=f"The slide's ornaments come in {len(distinct)} sizes: "
                    f"{', '.join(f'{v:.0f}' for v in distinct)}px.",
            measured={"sizes": distinct}, expected={"sizesMax": 3},
            fix="Pick up to three motif sizes on the spacing scale and reuse them",
        )


# --- budget and readability ---------------------------------------------------------------

def treatments(s: MeasuredSlide) -> dict[str, list[str]]:
    """The treatment kinds in use on the slide, with the nodes using each."""
    kinds: dict[str, list[str]] = {}

    def add(kind: str, node_id: str) -> None:
        kinds.setdefault(kind, []).append(node_id)

    for n in _visible(s):
        if n.layer != "ground" and n.box.rotation % 360:
            add("rotation", n.id)
    for n in _type_nodes(s):
        d = n.data
        if d.skew:
            add("skew", n.id)
        if d.fill == "none" and d.stroke:
            add("outline", n.id)
        if d.extrude:
            add("extrude", n.id)
        if d.repeat:
            add("repeat", n.id)
        if d.plate:
            add("plate", n.id)
    for n in _shape_nodes(s):
        add("ornaments", n.id)
    return kinds


@rule("TOO_MANY_TREATMENTS", family=FAMILY, severity="warn", thresholds=("expression.maxTreatments",))
def too_many_treatments(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """A few moves, made well: a slide carries at most two kinds of treatment (skew, outline,
    extrusion, repeat, plate, rotation, ornaments); more reads as effects, not design.

    `brand.expression.maxTreatments` sets the budget for the project.
    """
    kinds = treatments(s)
    sysm = _system(s)
    limit = sysm.max_treatments if sysm and sysm.max_treatments else t["expression.maxTreatments"]
    if len(kinds) <= limit:
        return
    yield Hit(
        nodes=sorted({i for ids in kinds.values() for i in ids}),
        message=f"The slide uses {len(kinds)} kinds of treatment: {', '.join(sorted(kinds))}.",
        measured={"treatments": sorted(kinds)}, expected={"treatmentsMax": limit},
        fix=f"Keep {limit} of them and drop the rest, or raise brand.expression.maxTreatments",
    )


@rule("EXPRESSIVE_UNREADABLE", family=FAMILY, severity="error", thresholds=("expression.cover",))
def expressive_unreadable(s: MeasuredSlide, t: Thresholds) -> Iterator[Hit]:
    """Lettering is still a message: an expressive block that is meant to be read keeps its
    words clear of other text, and its copies (repeat, extrude) within a line height, so the
    original stays the one the eye reads.

    Decorative blocks are exempt. Overlap is judged from line rects (the collision rules judge
    the pixels); waive it on the block when the overlap is the design.
    """
    limit = t["expression.cover"]
    for n in _type_nodes(s):
        m = s.node(n.id)
        if m is None or m.level != "expressive" or n.data.decorative or not m.lines:
            continue
        own = s.line_rects(m)
        area = sum(r.area for r in own)
        if area <= 0:
            continue
        covered = 0.0
        others: list[str] = []
        for o in s.text_nodes:
            if o.id == n.id:
                continue
            hit = 0.0
            for a in own:
                for b in s.line_rects(o):
                    x = a.intersect(b)
                    if x is not None:
                        hit += x.area
            if hit > 0:
                covered += hit
                others.append(o.id)
        share = 100 * covered / area
        if share > limit:
            yield Hit(
                nodes=[n.id, *others], region=_region(s, [n.id]),
                message=f"'{s.name(n.id)}' has {share:.0f}% of its lettering under other text "
                        f"({', '.join(s.name(i) for i in others)}).",
                measured={"coveredPct": round(share, 1)}, expected={"coveredPctMax": limit},
                fix=f"Move '{s.name(n.id)}' or the text over it apart, or set data.decorative when the word is a graphic",
            )
        lh = m.style.line_height if m.style else 0
        if not lh:
            continue
        u = s.guide.u
        r = n.data.repeat
        if r and math.hypot(r.dx, r.dy) * u > lh:
            yield Hit(
                nodes=[n.id], region=_region(s, [n.id]),
                message=f"'{s.name(n.id)}' repeats in steps of {math.hypot(r.dx, r.dy) * u:.0f}px, "
                        f"more than its line height ({lh:.0f}px): the copies run off the word.",
                measured={"stepPx": round(math.hypot(r.dx, r.dy) * u, 1)}, expected={"stepPxMax": round(lh, 1)},
                fix=f"Set data.repeat.dx/dy so the step is ≤ {lh / u:.1f}u",
            )
        e = n.data.extrude
        if e and e.depth * u > lh:
            yield Hit(
                nodes=[n.id], region=_region(s, [n.id]),
                message=f"'{s.name(n.id)}' extrudes {e.depth * u:.0f}px deep, more than its line height "
                        f"({lh:.0f}px): the face outweighs the letters.",
                measured={"depthPx": round(e.depth * u, 1)}, expected={"depthPxMax": round(lh, 1)},
                fix=f"Set data.extrude.depth to ≤ {lh / u:.1f}",
            )
