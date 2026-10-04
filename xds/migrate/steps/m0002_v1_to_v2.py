"""v1 → v2: the XDS 1 project format (xds_pre) to schemaVersion 2.

The runner (`migrate.run`) puts the side files this step reads into the document before calling
it, and acts on what the step asks for afterwards:

- `doc["__sceneData"]`: the parsed `scene-data.json` (objects, materials, camera), or None;
- `doc["__designs"]`: `{design id: SVG text}` for `designs/*.svg`;
- `report.files`: `{project-relative path: new text}` to write (with a backup) after the project;
- `report.fonts`: font families to fetch from Fontshare once the project is written;
- `report.retire`: v1-only files to move into the backup folder (out of the project, recoverable).

What v1 meant, and so what this step reproduces (read from the xds_pre studio):

- node boxes are percent of the canvas, rotation in degrees, `visible: false` hides;
- text sizes are canvas px: node `fontSize`, else the role's `fontSize`, else the v1 band default
  `round(short edge × ratio)`; weight 700 when bold (headline and eyebrow default to bold); line
  height 1.05 for headline, 1.25 otherwise; eyebrow/caption/label are uppercase; eyebrow and
  caption track at max(0.8, 0.12 × size / 16) px; the font defaults to Satoshi;
- the 3D view always covered the whole slide (a render node's 2D box was ignored) and was framed
  only by its camera: position = the node's `cameraTransform.location` (else the scene camera's),
  looking at `cameraTarget`, with a vertical fov of 2·atan(sensorWidth / 2·lens). The world is
  Y-up three.js, in meters, so positions carry over unchanged → `Slide.camera` (free);
- scene objects whose asset is a model (whatever their `kind`) are models; primitives were
  centered on their origin while v2 stands them on it, so their y moves down by half their height;
- a render node's `data.transform` is that slide's pose of the object → `RenderData.pose`;
- slide lighting was an explicit light rig (`lights`, already rotated by `direction`/`pitch`): the
  key light's azimuth and elevation become `angle`/`elevation`, the preset becomes the nearest
  `look`, and exposure × intensity becomes `brightness` (in stops);
- `canvas.background` is the slide background color token; `publishTarget` is the format.
"""

from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Any

# v1 type bands: ratio of the short edge (services/targets.py).
BAND_RATIO = {"display": 0.085, "headline": 0.060, "accent": 0.030, "body": 0.030,
              "eyebrow": 0.022, "caption": 0.022, "label": 0.022, "annotation": 0.022,
              "rule": 0.004}
LEVEL = {"display": "display", "headline": "headline", "accent": "subhead", "body": "body",
         "eyebrow": "caption", "caption": "caption", "label": "caption", "annotation": "caption",
         "rule": "caption"}
BOLD_BY_DEFAULT = {"headline", "eyebrow"}
UPPERCASE = {"eyebrow", "caption", "label"}
TRACKED = {"eyebrow", "caption"}
SEED_COLOR = {"accent": "accent", "eyebrow": "accent", "rule": "accent", "caption": "secondary"}
DEFAULT_FONT = "Satoshi"

LOOK = {"studio-3point": "softbox", "softbox-product": "softbox", "dramatic-rim": "rim",
        "outdoor-sun": "contrast", "flat-ambient": "bright"}

PRESET = {"instagram-square": "instagram-square", "instagram-portrait": "instagram-portrait",
          "instagram-story": "instagram-story", "linkedin-link": "linkedin-landscape",
          "x-post": "x-landscape", "youtube-thumbnail": "youtube-thumbnail",
          "paper-a3": "print-a3", "paper-a4": "print-a4"}

V1_FILES = ["scene-data.json", "review-state.json", "project-scene.py"]

ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
MODEL_EXT = (".glb", ".gltf", ".dae")


def upgrade(doc: dict[str, Any], report: Any) -> dict[str, Any]:
    scene = doc.pop("__sceneData", None) or {}
    designs = doc.pop("__designs", None) or {}
    report.files = getattr(report, "files", {})
    report.fonts = getattr(report, "fonts", [])
    # v1 format files v2 never reads, and v1's AGENTS.md, which would steer an agent wrong: they
    # move into the backup; the project gets the v2 AGENTS.md.
    report.retire = [*V1_FILES, "AGENTS.md"]
    report.files["AGENTS.md"] = (Path(__file__).parents[2] / "resources" / "template" / "AGENTS.md"
                                 ).read_text(encoding="utf-8")

    canvas = doc.get("canvas") or {}
    target = doc.get("publishTarget") or {}
    width = int(target.get("width") or canvas.get("width") or 1080)
    height = int(target.get("height") or canvas.get("height") or 1350)
    short = min(width, height)
    colors = [c for c in (doc.get("brand") or {}).get("colors") or [] if isinstance(c, dict)]
    color_names = [c.get("name") for c in colors]

    def token(name: Any) -> str | None:
        return name if name in color_names else None

    out: dict[str, Any] = {
        "schemaVersion": 2,
        "id": _slug(doc.get("id") or doc.get("name") or "project"),
        "name": doc.get("name") or doc.get("id") or "Project",
        "description": doc.get("description") or "",
        "createdAt": doc.get("createdAt"),
        "updatedAt": doc.get("updatedAt"),
        "format": _format(target, width, height),
        "brand": {"colors": [{"name": c.get("name"), "hex": str(c.get("hex", "")).lower()}
                             for c in colors]},
    }
    for k in ("createdAt", "updatedAt"):
        if not out[k]:
            del out[k]

    # --- typography --------------------------------------------------------------------------
    styles = (doc.get("brand") or {}).get("typographyStyles") or {}
    used_roles = {(n.get("data") or {}).get("role") for n in doc.get("nodes") or []
                  if n.get("kind") == "text"}
    roles: dict[str, Any] = {}
    families: list[str] = []
    for role in [*styles, *sorted(r for r in used_roles if r and r not in styles)]:
        style = styles.get(role) or {}
        size = style.get("fontSize") or round(short * BAND_RATIO.get(role, BAND_RATIO["body"]))
        font = style.get("fontFamily") or DEFAULT_FONT
        if font not in families:
            families.append(font)
        bold = style.get("bold", role in BOLD_BY_DEFAULT)
        r: dict[str, Any] = {"level": LEVEL.get(role, "body"), "font": font,
                             "weight": 700 if bold else 400, "size": size,
                             "lineHeight": 1.05 if role == "headline" else 1.25}
        if style.get("italic"):
            r["italic"] = True
        color = token(style.get("colorToken")) or token(SEED_COLOR.get(role, "ink"))
        if color:
            r["color"] = color
        if role in TRACKED:
            r["letterSpacing"] = round(max(0.8, 0.12 * size / 16) / size, 4)
        if role in UPPERCASE:
            r["uppercase"] = True
        if role == "rule" and role in used_roles:
            report.notes.append("role 'rule' drew a 2px bar in v1; v2 has no bar, so it is text now")
        roles[role] = r
    out["brand"]["typography"] = roles
    report.fonts = families

    # --- fonts, assets, materials, objects ---------------------------------------------------
    out["fonts"] = []
    assets = []
    asset_kind: dict[str, str] = {}
    for a in doc.get("assets") or []:
        path = str(a.get("path", ""))
        kind = "model" if a.get("kind") == "model" or path.lower().endswith(MODEL_EXT) else (
            "svg" if path.lower().endswith(".svg") else "image")
        asset_kind[a.get("id")] = kind
        assets.append({"id": a.get("id"), "path": path, "kind": kind})
    out["assets"] = assets

    materials = []
    for m in scene.get("materials") or []:
        mat = {"id": m.get("id"), "name": m.get("name") or m.get("id"),
               "color": _rgba_hex(m.get("color"))}
        if isinstance(m.get("metallic"), (int, float)):
            mat["metalness"] = m["metallic"]
        if isinstance(m.get("roughness"), (int, float)):
            mat["roughness"] = m["roughness"]
        materials.append(mat)
    out["materials"] = materials

    objects = []
    lift: dict[str, float] = {}
    for o in scene.get("objects") or []:
        oid, kind = o.get("id"), o.get("kind")
        asset = o.get("assetId")
        if asset and asset_kind.get(asset) == "model":
            obj: dict[str, Any] = {"id": oid, "name": o.get("name") or oid, "kind": "model",
                                   "asset": asset}
        elif kind in ("box", "sphere", "cylinder", "torus", "plane"):
            params, half = _primitive(kind, o.get("parameters") or {})
            obj = {"id": oid, "name": o.get("name") or oid, "kind": kind, "params": params}
            if o.get("materialId"):
                obj["material"] = o["materialId"]
            lift[oid] = half
        else:
            report.notes.append(f"scene object '{oid}' ({kind}"
                                + (f", image asset '{asset}'" if asset else "")
                                + ") has no v2 equivalent and was left out; use an image node")
            continue
        if o.get("parentId"):
            report.notes.append(f"scene object '{oid}' was parented to '{o['parentId']}'; v2 "
                                "objects are independent, so it keeps only its own transform")
        obj["pose"] = _pose(o.get("transform"), lift.get(oid, 0.0))
        objects.append(obj)
    out["objects"] = objects
    object_ids = {o["id"] for o in objects}

    order = doc.get("layerOrder")
    if isinstance(order, list) and sorted(order) == ["ground", "image", "render", "type"]:
        out["layerOrder"] = order

    # --- slides and nodes --------------------------------------------------------------------
    renames = _fix_designs(designs, report)
    cam = scene.get("camera") or {}
    fov = _fov(cam)
    nodes_by_slide: dict[str, list[dict[str, Any]]] = {}
    for n in doc.get("nodes") or []:
        nodes_by_slide.setdefault(n.get("slideId"), []).append(n)
    background = token(canvas.get("background")) or (color_names[0] if color_names else "ink")

    slides = []
    for s in sorted(doc.get("slides") or [], key=lambda s: s.get("order", 0)):
        slide: dict[str, Any] = {"id": s.get("id"), "name": s.get("name") or "",
                                 "background": background}
        if isinstance(s.get("lighting"), dict):
            slide["lighting"] = _lighting(s["lighting"], s.get("id"), report)
        nodes = []
        camera_done = False
        for n in nodes_by_slide.get(s.get("id"), []):
            node = _node(n, renames, lift, object_ids, report)
            if node is None:
                continue
            if node["layer"] == "render" and not camera_done and not node.get("hidden"):
                d = n.get("data") or {}
                pos = ((d.get("cameraTransform") or {}).get("location")
                       or (cam.get("transform") or {}).get("location"))
                tgt = d.get("cameraTarget") or (cam.get("target") or {}).get("location") or [0, 0, 0]
                if _vec(pos) and _vec(tgt):
                    slide["camera"] = {"mode": "free", "position": [float(v) for v in pos],
                                       "target": [float(v) for v in tgt], "fov": fov}
                    camera_done = True
            nodes.append(node)
        slide["nodes"] = nodes
        slides.append(slide)
    out["slides"] = slides

    dropped = [k for k in ("canvas", "layout", "scene", "publishTarget") if k in doc]
    if dropped:
        report.notes.append("v1 blocks with no v2 counterpart were dropped: " + ", ".join(dropped)
                            + " (scene-data.json lights and render settings are replaced by "
                            "each slide's lighting look)")
    return out


# --- helpers ---------------------------------------------------------------------------------

def _slug(s: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9-]+", "-", str(s).lower())).strip("-") or "project"


def _format(target: dict[str, Any], width: int, height: int) -> dict[str, Any]:
    from ...formats import CATALOG

    preset = PRESET.get(str(target.get("name", "")))
    if preset not in CATALOG or (CATALOG[preset].width, CATALOG[preset].height) != (width, height):
        preset = next((k for k, p in CATALOG.items() if (p.width, p.height) == (width, height)), None)
    f: dict[str, Any] = {"width": width, "height": height}
    if preset:
        f = {"preset": preset, **f}
    return f


def _vec(v: Any) -> bool:
    return isinstance(v, (list, tuple)) and len(v) == 3 and all(isinstance(x, (int, float)) for x in v)


def _pose(t: Any, lift: float = 0.0) -> dict[str, Any]:
    t = t or {}
    pos = list(t.get("location") or [0, 0, 0]) if _vec(t.get("location")) else [0.0, 0.0, 0.0]
    pos[1] = pos[1] - lift
    rot = list(t["rotation"]) if _vec(t.get("rotation")) else [0, 0, 0]
    scale = list(t["scale"]) if _vec(t.get("scale")) and all(t["scale"]) else [1, 1, 1]
    return {"position": pos, "rotation": rot, "scale": scale}


def _primitive(kind: str, p: dict[str, Any]) -> tuple[dict[str, float], float]:
    """v2 params for a v1 primitive, and half its height (v1 centered it on the origin)."""
    num = {k: float(v) for k, v in p.items() if isinstance(v, (int, float))}
    if kind == "box":
        out = {k: num[k] for k in ("width", "height", "depth") if k in num}
        return out, out.get("height", 1) / 2
    if kind == "sphere":
        r = num.get("radius", 0.5)
        return {"radius": r}, r
    if kind == "cylinder":
        r, h = num.get("radius", 0.5), num.get("depth", num.get("height", 1))
        return {"radius": r, "height": h}, h / 2
    if kind == "torus":
        big, small = num.get("majorRadius", 0.4), num.get("minorRadius", 0.1)
        return {"radius": big, "tube": small}, big + small
    out = {k: num[k] for k in ("width", "height") if k in num}
    return out, out.get("height", 1) / 2


def _rgba_hex(c: Any) -> str:
    if isinstance(c, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", c):
        return c.lower()
    if isinstance(c, dict):
        c = [c.get("r", 0), c.get("g", 0), c.get("b", 0)]
    if isinstance(c, (list, tuple)) and len(c) >= 3:
        return "#" + "".join(f"{max(0, min(255, round(float(v) * 255))):02x}" for v in c[:3])
    return "#808080"


def _fov(cam: dict[str, Any]) -> float:
    lens, sensor = cam.get("lens") or 58, cam.get("sensorWidth") or 36
    return round(math.degrees(2 * math.atan(sensor / (2 * lens))), 3)


def _lighting(light: dict[str, Any], slide_id: Any, report: Any) -> dict[str, Any]:
    preset = light.get("presetId")
    look = LOOK.get(preset or "")
    if look is None:
        look = "softbox"
        report.notes.append(f"slide '{slide_id}': lighting preset {preset!r} → look 'softbox'")
    out: dict[str, Any] = {"look": look}
    rig = light.get("lights") or light.get("baseline") or []
    key = next((r for r in rig if "key" in str(r.get("id", "")).lower()), rig[0] if rig else None)
    loc = ((key or {}).get("transform") or {}).get("location")
    if _vec(loc):
        x, y, z = loc
        out["angle"] = round(math.degrees(math.atan2(x, z)) % 360, 1)
        out["elevation"] = round(min(80, max(0, math.degrees(math.atan2(y, math.hypot(x, z))))), 1)
    gain = float(light.get("exposure") or 1) * float(light.get("intensity") or 1)
    stops = max(-1, min(1, math.log2(gain))) if gain > 0 else 0
    if abs(stops) >= 0.025:
        out["brightness"] = round(stops * 20) / 20
    return out


def _box(t: Any) -> dict[str, Any]:
    t = t or {}
    box = {"x": float(t.get("x", 0)), "y": float(t.get("y", 0)),
           "w": float(t.get("width") or 1), "h": float(t.get("height") or 1)}
    box["rotation"] = float(t.get("rotation") or 0)
    box["opacity"] = float(t["opacity"]) if isinstance(t.get("opacity"), (int, float)) else 1.0
    return box


def _node(n: dict[str, Any], renames: dict[str, dict[str, str]], lift: dict[str, float],
          object_ids: set[str], report: Any) -> dict[str, Any] | None:
    nid, layer, d = n.get("id"), n.get("layer"), n.get("data") or {}
    if not isinstance(nid, str) or not ID.match(nid):
        report.unresolve(f"nodes[{nid}]", f"node id {nid!r} is not a valid v2 id")
        return None
    node: dict[str, Any] = {"id": nid, "name": n.get("name") or "", "layer": layer}
    t = n.get("transform") or {}
    hidden = t.get("visible") is False or d.get("hidden") is True
    if layer == "ground":
        design = d.get("designId") or d.get("design")
        values = dict(d.get("values") or {})
        for old, new in (renames.get(design) or {}).items():
            if old in values:
                values[new] = values.pop(old)
        node["box"] = _box(t)
        node["data"] = {"design": design}
        if d.get("variant"):
            node["data"]["variant"] = d["variant"]
        if values:
            node["data"]["values"] = values
    elif layer == "image":
        node["box"] = _box(t)
        node["data"] = {"asset": d.get("assetId") or d.get("asset"), "fit": d.get("fit") or "cover"}
    elif layer == "type":
        node["box"] = _box(t)
        data: dict[str, Any] = {"text": d.get("text", ""), "role": d.get("role") or "body",
                                "align": d.get("horizontalAlign") or "left",
                                "valign": d.get("verticalAlign") or "top"}
        if d.get("colorToken"):
            data["color"] = d["colorToken"]
        if isinstance(d.get("fontSize"), (int, float)) and d["fontSize"] > 0:
            data["size"] = d["fontSize"]
        if isinstance(d.get("bold"), bool):
            data["weight"] = 700 if d["bold"] else 400
        if isinstance(d.get("italic"), bool):
            data["italic"] = d["italic"]
        if d.get("fontFamily"):
            report.notes.append(f"text '{nid}' set its own font '{d['fontFamily']}'; v2 fonts come "
                                "from the role, so it uses its role's font")
        node["data"] = data
    elif layer == "render":
        obj = d.get("objectId") or d.get("object")
        if obj not in object_ids:
            report.notes.append(f"render node '{nid}' showed '{obj}', which was not migrated; "
                                "the node was left out")
            return None
        node["data"] = {"object": obj}
        if isinstance(d.get("transform"), dict):
            node["data"]["pose"] = _pose(d["transform"], lift.get(obj, 0.0))
    else:
        report.notes.append(f"node '{nid}' on layer {layer!r} has no v2 equivalent; left out")
        return None
    if hidden:
        node["hidden"] = True
    return node


_TEMPLATE = re.compile(r"\{\{(.*?)\}\}", re.S)
_META = re.compile(r'(<metadata id="xds-design">)(.*?)(</metadata>)', re.S)


def _fix_designs(designs: dict[str, str], report: Any) -> dict[str, dict[str, str]]:
    """Rename design params that clash with v2 built-in names (width, height, subject, …) in the
    SVG, and return {design: {old: new}} so node values follow."""
    import json

    from ...designs import RESERVED as BUILTINS

    renames: dict[str, dict[str, str]] = {}
    for design_id, text in designs.items():
        meta = _META.search(text)
        if not meta:
            continue
        try:
            manifest = json.loads(meta.group(2))
        except ValueError:
            continue
        names = {p.get("name") for p in manifest.get("params") or []}
        clash = {n: f"{n}Param" for n in names if n in BUILTINS}
        if not clash:
            continue
        for p in manifest["params"]:
            if p.get("name") in clash:
                p["name"] = clash[p["name"]]
        for v in manifest.get("variants") or []:
            v["values"] = {clash.get(k, k): val for k, val in (v.get("values") or {}).items()}
        word = re.compile(r"\b(" + "|".join(map(re.escape, clash)) + r")\b")
        body = _TEMPLATE.sub(lambda m: "{{" + word.sub(lambda w: clash[w.group(1)], m.group(1)) + "}}",
                             text[meta.end():])
        head = text[:meta.start()] + meta.group(1) + json.dumps(manifest, indent=2) + meta.group(3)
        report.files[f"designs/{design_id}.svg"] = head + body
        renames[design_id] = clash
        report.notes.append(f"design '{design_id}': renamed params {sorted(clash)} → "
                            f"{sorted(clash.values())} (the old names are v2 built-ins)")
    return renames
