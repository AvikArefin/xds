"""3D models: inspect GLB files, convert .gltf/.dae to .glb, register them, check render nodes.

Inspection uses the standard library only: it reads the GLB header and JSON chunk (never the
binary chunk), so it works on Draco- and Meshopt-compressed files too. Everything it reports
comes from the glTF JSON:

- **bounds**: each mesh primitive's `POSITION` accessor `min`/`max`, transformed by the node's
  world matrix (all 8 corners), unioned over the default scene;
- **triangles**: index (or vertex) counts per primitive, per node instance;
- **parts**: every named node, with its parent, pivot (= local translation) and joint limits from
  `extras.xds.limits` (also accepted: `extras["xds.limits"]`, or either as a JSON string);
- **clips**: animations with durations (the largest sampler input `max`); unnamed clips are named
  `animation_<i>` like three's GLTFLoader;
- **screens**: nodes with a mesh whose name (before any `.suffix`) ends in "screen"
  (`Screen`, `Screen.001`, `CoverScreen`), with the aspect ratio of their world bounds and the
  closest device preset resized to that aspect.

Conversion (`add`, `inspect` of non-GLB files) shells out: `.gltf` → `npx --no-install
gltf-transform copy`; `.dae` → three's ColladaLoader + GLTFExporter in headless Chromium.
"""

from __future__ import annotations

import base64
import hashlib
import json
import math
import re
import shutil
import struct
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from .models import Asset, Finding, Pose, Project, RenderNode, SceneObject

REPO_ROOT = Path(__file__).resolve().parent.parent  # where node_modules lives

# What the studio's loader (drei useGLTF: GLTFLoader + DRACOLoader + MeshoptDecoder, three r170)
# can decode. KHR_texture_basisu needs a KTX2Loader, which the studio does not configure.
SUPPORTED_EXTENSIONS = {
    "KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_mesh_quantization",
    "KHR_texture_transform", "KHR_materials_unlit", "KHR_materials_emissive_strength",
    "KHR_materials_clearcoat", "KHR_materials_ior", "KHR_materials_sheen",
    "KHR_materials_specular", "KHR_materials_transmission", "KHR_materials_volume",
    "KHR_materials_iridescence", "KHR_materials_anisotropy", "KHR_materials_dispersion",
    "KHR_materials_variants", "KHR_lights_punctual", "EXT_texture_webp", "EXT_texture_avif",
    "EXT_mesh_gpu_instancing",
}

MAX_BYTES = 20 * 1024 * 1024
MAX_TRIANGLES = 500_000
ASPECT_TOLERANCE = 0.02
_COMPONENT_MAX = {5120: 127, 5121: 255, 5122: 32767, 5123: 65535}
_CACHE: dict[str, dict[str, Any]] = {}


class ModelError(ValueError):
    pass


# --- reading the glTF JSON -------------------------------------------------------------------

def read_gltf_json(path: Path) -> dict[str, Any]:
    """The glTF JSON of a .glb (header + first chunk) or a .gltf file."""
    data = path.read_bytes()
    if path.suffix.lower() == ".gltf":
        try:
            return json.loads(data)
        except json.JSONDecodeError as e:
            raise ModelError(f"not valid glTF JSON: {e}") from e
    if len(data) < 20:
        raise ModelError("file too short to be a GLB")
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF":
        raise ModelError("not a GLB file (bad magic)")
    if version != 2:
        raise ModelError(f"GLB container version {version}; only glTF 2.0 is supported")
    chunk_len, chunk_type = struct.unpack_from("<I4s", data, 12)
    if chunk_type != b"JSON":
        raise ModelError("the first GLB chunk is not JSON")
    try:
        return json.loads(data[20:20 + chunk_len])
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise ModelError(f"GLB JSON chunk does not parse: {e}") from e


# --- matrices (row-major 4×4 lists) ----------------------------------------------------------

def _matmul(a: list[list[float]], b: list[list[float]]) -> list[list[float]]:
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def _identity() -> list[list[float]]:
    return [[1.0 if i == j else 0.0 for j in range(4)] for i in range(4)]


def local_matrix(node: dict[str, Any]) -> list[list[float]]:
    if "matrix" in node:  # column-major in glTF
        m = node["matrix"]
        return [[m[c * 4 + r] for c in range(4)] for r in range(4)]
    tx, ty, tz = node.get("translation", [0, 0, 0])
    x, y, z, w = node.get("rotation", [0, 0, 0, 1])
    sx, sy, sz = node.get("scale", [1, 1, 1])
    r = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
         [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
         [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
    return [[r[0][0] * sx, r[0][1] * sy, r[0][2] * sz, tx],
            [r[1][0] * sx, r[1][1] * sy, r[1][2] * sz, ty],
            [r[2][0] * sx, r[2][1] * sy, r[2][2] * sz, tz],
            [0.0, 0.0, 0.0, 1.0]]


def _transform_box(m: list[list[float]], lo: list[float], hi: list[float]
                   ) -> tuple[list[float], list[float]]:
    pts = [[m[i][0] * x + m[i][1] * y + m[i][2] * z + m[i][3] for i in range(3)]
           for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
    return ([min(p[i] for p in pts) for i in range(3)], [max(p[i] for p in pts) for i in range(3)])


class Bounds:
    def __init__(self) -> None:
        self.min = [math.inf] * 3
        self.max = [-math.inf] * 3

    def add(self, lo: list[float], hi: list[float]) -> None:
        self.min = [min(a, b) for a, b in zip(self.min, lo)]
        self.max = [max(a, b) for a, b in zip(self.max, hi)]

    @property
    def empty(self) -> bool:
        return self.min[0] == math.inf

    @property
    def size(self) -> list[float]:
        return [0.0] * 3 if self.empty else [b - a for a, b in zip(self.min, self.max)]

    def to_json(self) -> dict[str, Any] | None:
        if self.empty:
            return None
        r = lambda v: [round(x, 6) for x in v]  # noqa: E731
        center = [(a + b) / 2 for a, b in zip(self.min, self.max)]
        return {"min": r(self.min), "max": r(self.max), "size": r(self.size), "center": r(center)}


# --- inspection ------------------------------------------------------------------------------

def _position_box(doc: dict[str, Any], acc_index: int) -> tuple[list[float], list[float]] | None:
    acc = doc.get("accessors", [])[acc_index]
    lo, hi = acc.get("min"), acc.get("max")
    if not lo or not hi or len(lo) < 3:
        return None
    if acc.get("normalized") and acc.get("componentType") in _COMPONENT_MAX:
        d = _COMPONENT_MAX[acc["componentType"]]
        lo, hi = [max(v / d, -1.0) for v in lo], [v / d for v in hi]
    return list(lo[:3]), list(hi[:3])


def _primitive_triangles(doc: dict[str, Any], prim: dict[str, Any]) -> int:
    accessors = doc.get("accessors", [])
    if "indices" in prim:
        count = accessors[prim["indices"]].get("count", 0)
    elif "POSITION" in prim.get("attributes", {}):
        count = accessors[prim["attributes"]["POSITION"]].get("count", 0)
    else:
        return 0
    mode = prim.get("mode", 4)
    return count // 3 if mode == 4 else max(count - 2, 0) if mode in (5, 6) else 0


def _limits(node: dict[str, Any]) -> dict[str, list[float]] | None:
    extras = node.get("extras") or {}
    raw = None
    if isinstance(extras.get("xds"), dict):
        raw = extras["xds"].get("limits")
    raw = raw if raw is not None else extras.get("xds.limits")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return None
    if not isinstance(raw, dict):
        return None
    out = {}
    for k, v in raw.items():
        if re.fullmatch(r"(rotate|move)[XYZ]", k) and isinstance(v, list) and len(v) == 2:
            out[k] = [float(v[0]), float(v[1])]
    return out or None


def is_screen_name(name: str | None) -> bool:
    return bool(name) and name.split(".")[0].lower().endswith("screen")  # type: ignore[union-attr]


def screen_aspect(size: list[float]) -> tuple[float, float]:
    """(width, height) of a flat screen from its world extents. The screen may lean about the X
    axis (a laptop lid, a phone lying flat): width is the x extent and height spans y and z
    together. A screen facing ±X (the thinnest axis is x) is z wide instead."""
    ex, ey, ez = size
    if min(range(3), key=lambda i: size[i]) == 0:
        return ez, math.hypot(ey, ex)
    return ex, math.hypot(ey, ez)


def recommend_screen(aspect: float) -> dict[str, Any]:
    """The device preset closest in aspect, with its height adjusted to match exactly."""
    from .screens import DEVICES

    name, dev = min(DEVICES.items(), key=lambda kv: abs(math.log(
        (kv[1]["width"] / kv[1]["height"]) / aspect)))
    return {"device": name, "width": dev["width"], "height": round(dev["width"] / aspect),
            "scale": dev["scale"]}


def inspect_json(doc: dict[str, Any], *, file_size: int = 0) -> dict[str, Any]:
    """Inspect parsed glTF JSON. Never raises: problems become `errors` (→ ok: false)."""
    errors: list[str] = []
    version = str((doc.get("asset") or {}).get("version", ""))
    if not version.startswith("2."):
        errors.append(f"asset.version is {version or 'missing'}; glTF 2.0 is required")
    required = list(doc.get("extensionsRequired") or [])
    used = list(doc.get("extensionsUsed") or [])
    unsupported_required = [e for e in required if e not in SUPPORTED_EXTENSIONS]
    unsupported_optional = [e for e in used if e not in SUPPORTED_EXTENSIONS and e not in required]
    if unsupported_required:
        errors.append("required extensions the studio can't load: "
                      + ", ".join(unsupported_required))

    nodes = doc.get("nodes") or []
    meshes = doc.get("meshes") or []
    scenes = doc.get("scenes") or []
    if scenes:
        roots = scenes[doc.get("scene", 0)].get("nodes", []) if doc.get("scene", 0) < len(scenes) else []
    else:
        children = {c for n in nodes for c in n.get("children", [])}
        roots = [i for i in range(len(nodes)) if i not in children]

    bounds, triangles = Bounds(), 0
    parts: list[dict[str, Any]] = []
    screens: list[dict[str, Any]] = []

    def visit(i: int, parent_m: list[list[float]], parent: str | None, depth: int) -> None:
        nonlocal triangles
        if depth > 64 or i >= len(nodes):
            return
        node = nodes[i]
        local = local_matrix(node)
        world = _matmul(parent_m, local)
        name = node.get("name")
        mesh_bounds = Bounds()
        if "mesh" in node and node["mesh"] < len(meshes):
            for prim in meshes[node["mesh"]].get("primitives", []):
                triangles += _primitive_triangles(doc, prim)
                pos = prim.get("attributes", {}).get("POSITION")
                box = _position_box(doc, pos) if pos is not None else None
                if box:
                    mesh_bounds.add(*_transform_box(world, *box))
            if not mesh_bounds.empty:
                bounds.add(mesh_bounds.min, mesh_bounds.max)
        if name:
            part: dict[str, Any] = {
                "name": name, "parent": parent, "depth": depth,
                "pivot": [round(local[r][3], 6) for r in range(3)],
                "mesh": "mesh" in node}
            if limits := _limits(node):
                part["limits"] = limits
            parts.append(part)
            if "mesh" in node and is_screen_name(name) and not mesh_bounds.empty:
                w, h = screen_aspect(mesh_bounds.size)
                if w > 0 and h > 0:
                    has_uv = all("TEXCOORD_0" in prim.get("attributes", {})
                                 for prim in meshes[node["mesh"]].get("primitives", []))
                    screens.append({"name": name, "aspect": round(w / h, 4),
                                    "size": [round(w, 6), round(h, 6)], "uv": has_uv,
                                    "recommended": recommend_screen(w / h)})
        for c in node.get("children", []):
            visit(c, world, name or parent, depth + 1)

    for r in roots:
        visit(r, _identity(), None, 0)

    clips = []
    for i, anim in enumerate(doc.get("animations") or []):
        duration = 0.0
        for s in anim.get("samplers", []):
            acc = (doc.get("accessors") or [])[s.get("input", 0)]
            duration = max(duration, float((acc.get("max") or [0])[0]))
        clips.append({"name": anim.get("name") or f"animation_{i}", "duration": round(duration, 6)})

    result: dict[str, Any] = {
        "ok": not errors, "errors": errors, "version": version,
        "extensionsUsed": used, "extensionsRequired": required,
        "bounds": bounds.to_json(), "triangles": triangles, "bytes": file_size,
        "parts": parts, "clips": clips, "screens": screens, "warnings": [],
    }
    result["warnings"] = _warnings(result, bounds, unsupported_required, unsupported_optional)
    return result


def _warn(code: str, message: str, severity: str = "warn", **measured: Any) -> dict[str, Any]:
    return {"code": code, "severity": severity, "message": message, "measured": measured}


def _warnings(r: dict[str, Any], b: Bounds, bad_required: list[str],
              bad_optional: list[str]) -> list[dict[str, Any]]:
    out = []
    if bad_required:
        out.append(_warn("MODEL_UNSUPPORTED_EXTENSION", "Required extensions the studio can't "
                         f"load: {', '.join(bad_required)}. Re-export without them.", "error",
                         extensions=bad_required))
    if bad_optional:
        out.append(_warn("MODEL_UNSUPPORTED_EXTENSION", "Optional extensions that will be "
                         f"ignored: {', '.join(bad_optional)}.", extensions=bad_optional))
    if not b.empty:
        size = b.size
        largest = max(size)
        if largest < 0.01 or largest > 10:
            out.append(_warn("MODEL_UNITS_SUSPECT", f"The model is {largest:.4g} m at its largest; "
                             "models should be in real-world meters (1 cm – 10 m). Check the "
                             "export units.", largest=round(largest, 6)))
        if abs(b.min[1]) > max(0.002, 0.02 * size[1]):
            out.append(_warn("MODEL_NOT_GROUNDED", f"The lowest point is at y = {b.min[1]:.4g} m, "
                             "not on the floor (y = 0). Put the origin at the bottom center.",
                             minY=round(b.min[1], 6)))
        cx, cz = (b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2
        if max(abs(cx), abs(cz)) > max(0.005, 0.1 * max(size[0], size[2])):
            out.append(_warn("MODEL_OFF_CENTER", f"The footprint center is at x = {cx:.4g}, "
                             f"z = {cz:.4g} m, not at the origin. Center the origin under the "
                             "model.", centerX=round(cx, 6), centerZ=round(cz, 6)))
    heavy = r["bytes"] > MAX_BYTES or r["triangles"] > MAX_TRIANGLES
    for scr in r["screens"]:
        if not scr.get("uv", True):
            out.append(_warn("MODEL_SCREEN_NO_UV", f"Screen mesh '{scr['name']}' has no UVs "
                             "(TEXCOORD_0), so a screen texture can't be mapped onto it; "
                             "unwrap it to fill 0–1 and re-export."))
    if heavy:
        out.append(_warn("MODEL_HEAVY", f"{r['bytes'] / 1e6:.1f} MB, {r['triangles']:,} triangles; "
                         "keep models ≤ 20 MB and ≤ 500k triangles (decimate, compress textures, "
                         "or use `gltf-transform optimize`).", bytes=r["bytes"],
                         triangles=r["triangles"]))
    names = [p["name"] for p in r["parts"]]
    dupes = sorted({n for n in names if names.count(n) > 1})
    if dupes:
        out.append(_warn("MODEL_DUPLICATE_PART_NAMES", f"Duplicate node names: {', '.join(dupes)}. "
                         "Parts must have unique names to be posed.", names=dupes))
    return out


def file_sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inspect_glb(path: Path) -> dict[str, Any]:
    """Inspect a .glb (cached in-process by file hash)."""
    key = file_sha(path)
    if key not in _CACHE:
        try:
            doc = read_gltf_json(path)
        except ModelError as e:
            _CACHE[key] = {"ok": False, "errors": [str(e)], "parts": [], "clips": [],
                           "screens": [], "warnings": [], "bounds": None, "triangles": 0,
                           "bytes": path.stat().st_size}
        else:
            _CACHE[key] = inspect_json(doc, file_size=path.stat().st_size)
    return json.loads(json.dumps(_CACHE[key]))  # a copy callers may modify


def inspect(path: Path) -> dict[str, Any]:
    """`xds model inspect`: steps 0–2 (convert if needed, inspect, warn); changes nothing."""
    path = Path(path)
    suffix = path.suffix.lower()
    if suffix == ".glb":
        return {"file": str(path), **inspect_glb(path)}
    with tempfile.TemporaryDirectory() as tmp:
        glb, notes = convert(path, Path(tmp) / "model.glb")
        result = inspect_glb(glb)
        result["warnings"] = notes + result["warnings"]
        result["converted"] = suffix
        return {"file": str(path), **result}


# --- conversion ------------------------------------------------------------------------------

def convert(src: Path, out: Path) -> tuple[Path, list[dict[str, Any]]]:
    """Convert a .gltf or .dae file into `out` (.glb). Returns the path and any warnings."""
    from .project import XdsError

    suffix = src.suffix.lower()
    if suffix == ".glb":
        shutil.copyfile(src, out)
        return out, []
    if suffix == ".gltf":
        return _convert_gltf(src, out), []
    if suffix == ".dae":
        return _convert_dae(src, out)
    raise XdsError("MODEL_FORMAT", f"'{src.name}': models must be .glb, .gltf or .dae",
                   status=422)


def _convert_gltf(src: Path, out: Path) -> Path:
    from .project import XdsError

    cmd = ["npx", "--no-install", "gltf-transform", "copy", str(src.resolve()), str(out.resolve())]
    proc = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True, timeout=300)
    if proc.returncode != 0 or not out.exists():
        raise XdsError("MODEL_CONVERT_FAILED", f"gltf-transform copy failed: "
                       f"{(proc.stderr or proc.stdout).strip()[-800:]}", status=422)
    return out


_DAE_PAGE = """<!doctype html><html><head><script type="importmap">
{"imports": {"three": "/three/build/three.module.js", "three/addons/": "/three/examples/jsm/"}}
</script></head><body><script type="module">
import * as THREE from "three";
import { ColladaLoader } from "three/addons/loaders/ColladaLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
window.convert = async (url) => {
  const collada = await new ColladaLoader().loadAsync(url);
  const scene = collada.scene;
  const drop = [];
  let approximated = 0;
  scene.traverse((o) => {
    if (o.isLight || o.isCamera) drop.push(o);
    if (!o.isMesh) return;
    const swap = (m) => {
      if (m.isMeshStandardMaterial || m.isMeshBasicMaterial) return m;
      approximated++;
      const shininess = m.shininess ?? 30;
      return new THREE.MeshStandardMaterial({
        name: m.name, color: m.color, map: m.map, normalMap: m.normalMap ?? null,
        emissive: m.emissive ?? new THREE.Color(0), emissiveMap: m.emissiveMap ?? null,
        opacity: m.opacity, transparent: m.transparent, side: m.side,
        alphaMap: m.alphaMap ?? null, metalness: 0,
        roughness: Math.min(1, Math.sqrt(2 / (shininess + 2))),
      });
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
  drop.forEach((o) => o.parent && o.parent.remove(o));
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
  let s = ""; const bytes = new Uint8Array(glb);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { glb: btoa(s), approximated };
};
window.ready = true;
</script></body></html>"""


def _convert_dae(src: Path, out: Path) -> tuple[Path, list[dict[str, Any]]]:
    """Collada → GLB in headless Chromium with three's ColladaLoader and GLTFExporter."""
    from playwright.sync_api import sync_playwright

    from .project import XdsError

    three = REPO_ROOT / "node_modules" / "three"
    base = src.resolve().parent
    origin = "http://xds.convert"

    def handle(route: Any) -> None:
        path = route.request.url[len(origin):].split("?")[0]
        if path == "/":
            return route.fulfill(body=_DAE_PAGE, content_type="text/html")
        root, rel = (three, path[len("/three/"):]) if path.startswith("/three/") else \
            (base, path[len("/model/"):]) if path.startswith("/model/") else (None, "")
        from urllib.parse import unquote
        target = (root / unquote(rel)).resolve() if root else None
        if target is None or root not in target.parents or not target.is_file():
            return route.fulfill(status=404, body="not found")
        ctype = "text/javascript" if target.suffix == ".js" else None
        return route.fulfill(path=str(target), content_type=ctype) if ctype else \
            route.fulfill(path=str(target))

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            page.route(f"{origin}/**", handle)
            page.goto(f"{origin}/")
            page.wait_for_function("window.ready === true", timeout=30_000)
            from urllib.parse import quote
            res = page.evaluate("(u) => window.convert(u)", f"{origin}/model/{quote(src.name)}")
            browser.close()
    except Exception as e:  # noqa: BLE001 - surface any browser failure as one error
        raise XdsError("MODEL_CONVERT_FAILED", f"Collada conversion failed: {e}", status=422) from e
    out.write_bytes(base64.b64decode(res["glb"]))
    notes = []
    if res["approximated"]:
        notes.append(_warn("MODEL_MATERIALS_APPROXIMATED",
                           f"{res['approximated']} Collada Phong/Lambert material(s) were "
                           "approximated as PBR (metalness 0, roughness from shininess). If the "
                           "result looks wrong, re-export from the source tool as glTF.",
                           count=res["approximated"]))
    return out, notes


def _gltf_dependencies(src: Path) -> list[Path]:
    """The .bin and texture files a .gltf references by relative URI."""
    try:
        doc = json.loads(src.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    from urllib.parse import unquote

    uris = [b.get("uri") for b in doc.get("buffers", [])] + [i.get("uri") for i in doc.get("images", [])]
    return [src.parent / unquote(u) for u in uris
            if u and not u.startswith("data:") and (src.parent / unquote(u)).is_file()]


# --- adding to a project ---------------------------------------------------------------------

def add(root: Path, file: Path, *, id: str, name: str | None = None, slide: str | None = None,
        replace: bool = False) -> dict[str, Any]:
    """`xds model add`: convert, inspect, copy to assets/models/<id>.glb, register asset and
    object (identity pose) and, with `slide`, a render node. `replace` keeps poses and nodes."""
    from .project import XdsError, read_raw, write_project

    root, file = Path(root).resolve(), Path(file).expanduser().resolve()
    if not file.is_file():
        raise XdsError("MISSING_FILE", f"'{file}' does not exist", status=404)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", id):
        raise XdsError("INVALID_ID", f"'{id}' is not a valid id (letters, digits, _ . -)",
                       status=422)
    project = Project.model_validate(read_raw(root))
    existing = project.asset(id) or project.object(id)
    if existing and not replace:
        raise XdsError("MODEL_EXISTS", f"An asset or object '{id}' already exists; pass "
                       "--replace to swap the file and keep poses.", status=409)
    if slide and not project.slide(slide):
        raise XdsError("UNKNOWN_SLIDE", f"No slide '{slide}'.", status=404)

    dest = root / "assets" / "models" / f"{id}.glb"
    dest.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        glb, notes = convert(file, Path(tmp) / f"{id}.glb")
        info = inspect_glb(glb)
        if not info["ok"]:
            raise XdsError("MODEL_INVALID", "; ".join(info["errors"]), status=422,
                           details=info["warnings"])
        shutil.copyfile(glb, dest)
    source = _keep_source(root, file, id) if file.suffix.lower() in (".gltf", ".dae") else None

    rel = dest.relative_to(root).as_posix()
    asset = project.asset(id)
    if asset:
        asset.path, asset.kind = rel, "model"
    else:
        project.assets.append(Asset(id=id, path=rel, kind="model"))
    obj = project.object(id)
    if obj:
        obj.kind, obj.asset, obj.material, obj.params = "model", id, None, None
        if name:
            obj.name = name
    else:
        project.objects.append(SceneObject(id=id, name=name or id, kind="model", asset=id,
                                           pose=Pose()))
    node_id = _add_render_node(project, slide, id, name or id) if slide else None
    write_project(root, project)
    return {"id": id, "asset": rel, "object": id, "node": node_id, "replaced": bool(existing),
            "source": source, "converted": file.suffix.lower() != ".glb",
            "warnings": notes + info["warnings"], "inspection": info}


def add_library(root: Path, model_id: str, *, id: str | None = None, name: str | None = None,
                slide: str | None = None, screen: str | None = None,
                replace: bool = False) -> dict[str, Any]:
    """`xds model add --library`: register a library model by reference (nothing is copied) and
    its object and, with `slide`, a render node. `screen` puts that screen on the model's screen
    mesh in that node."""
    from . import library
    from .project import XdsError, read_raw, write_project

    meta = library.model(model_id)
    root, id = Path(root).resolve(), id or model_id
    project = Project.model_validate(read_raw(root))
    existing = project.asset(id) or project.object(id)
    if existing and not replace:
        raise XdsError("MODEL_EXISTS", f"An asset or object '{id}' already exists; pass "
                       "--replace to swap the model and keep poses.", status=409)
    if slide and not project.slide(slide):
        raise XdsError("UNKNOWN_SLIDE", f"No slide '{slide}'.", status=404)
    if screen and not slide:
        raise XdsError("SCREEN_NEEDS_SLIDE", "--screen needs --slide: the screen is set on that "
                       "slide's render node.", status=422)
    if screen and project.screen(screen) is None:
        raise XdsError("UNKNOWN_SCREEN", f"No screen '{screen}'. Create it first with "
                       f"`xds screen add PROJECT {screen} --device "
                       f"{next(iter(meta['screens'].values()), {}).get('device', 'iphone')}`.",
                       status=404)
    asset = project.asset(id)
    if asset:
        asset.path, asset.kind = meta["path"], "model"
    else:
        project.assets.append(Asset(id=id, path=meta["path"], kind="model"))
    obj = project.object(id)
    if obj:
        obj.kind, obj.asset, obj.material, obj.params = "model", id, None, None
        if name:
            obj.name = name
    else:
        project.objects.append(SceneObject(id=id, name=name or meta["name"], kind="model",
                                           asset=id, pose=Pose()))
    node_id = _add_render_node(project, slide, id, name or meta["name"]) if slide else None
    if node_id and screen:
        node = next(n for n in project.slide(slide).nodes if n.id == node_id)  # type: ignore[union-attr]
        mesh = next(iter(meta["screens"]), "Screen")
        node.data.screens = {**(node.data.screens or {}), mesh: screen}  # type: ignore[union-attr]
    write_project(root, project)
    return {"id": id, "asset": meta["path"], "object": id, "node": node_id,
            "replaced": bool(existing), "library": model_id, "screens": meta["screens"]}


def vendor(root: Path, asset_id: str) -> dict[str, Any]:
    """`xds model vendor`: copy a library model into assets/models/<id>.glb and point the asset
    at the copy, so the project opens without this xds install."""
    from . import library
    from .project import XdsError, read_raw, write_project

    root = Path(root).resolve()
    project = Project.model_validate(read_raw(root))
    asset = project.asset(asset_id)
    if asset is None:
        raise XdsError("UNKNOWN_ASSET", f"No asset '{asset_id}'.", status=404)
    if not library.is_library_path(asset.path):
        raise XdsError("NOT_LIBRARY", f"Asset '{asset_id}' is already a project file "
                       f"({asset.path}).", status=409)
    dest = root / "assets" / "models" / f"{asset_id}.glb"
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(library.resolve(asset.path), dest)
    was, asset.path = asset.path, dest.relative_to(root).as_posix()
    write_project(root, project)
    return {"id": asset_id, "from": was, "path": asset.path}


def _keep_source(root: Path, file: Path, id: str) -> str | None:
    """Copy an original .gltf/.dae (with its .bin and textures) into sources/<id>/."""
    sources = root / "sources"
    if sources.resolve() in file.parents:
        return file.relative_to(root).as_posix()
    target = sources / id
    target.mkdir(parents=True, exist_ok=True)
    files = [file] + (_gltf_dependencies(file) if file.suffix.lower() == ".gltf" else [])
    for f in files:
        rel = f.relative_to(file.parent) if file.parent in f.parents or f.parent == file.parent \
            else Path(f.name)
        (target / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(f, target / rel)
    return (target / file.name).relative_to(root).as_posix()


def _add_render_node(project: Project, slide_id: str, object_id: str, name: str) -> str:
    slide = project.slide(slide_id)
    assert slide is not None
    for n in slide.nodes:
        if isinstance(n, RenderNode) and n.data.object == object_id:
            return n.id
    taken = {n.id for s in project.slides for n in s.nodes}
    node_id, k = f"{object_id}-{slide_id}", 2
    while node_id in taken:
        node_id, k = f"{object_id}-{slide_id}-{k}", k + 1
    slide.nodes.append(RenderNode.model_validate(
        {"id": node_id, "name": name, "layer": "render", "data": {"object": object_id}}))
    return node_id


# --- the gate --------------------------------------------------------------------------------

def _finding(rule: str, path: str, message: str, fix: str, node: RenderNode,
             slide_id: str) -> Finding:
    return Finding(rule=rule, family="check", severity="error", path=path, message=message,
                   fix=fix, nodes=[node.id], slide_id=slide_id)


_AXES = {"X": 0, "Y": 1, "Z": 2}


def check_project(root: Path, project: Project) -> list[Finding]:
    """Check render nodes against their GLB: parts, clips, joint limits and screen aspects."""
    from .project import XdsError, resolve_asset

    out: list[Finding] = []
    invalid_reported: set[str] = set()
    for si, slide in enumerate(project.slides):
        for ni, node in enumerate(slide.nodes):
            if not isinstance(node, RenderNode):
                continue
            obj = project.object(node.data.object)
            asset = project.asset(obj.asset) if obj and obj.asset else None
            if not asset or asset.kind != "model":
                continue
            try:
                path = resolve_asset(root, asset.path)
            except XdsError:
                continue
            if not path.is_file() or path.suffix.lower() != ".glb":
                continue  # MISSING_FILE / ASSET_KIND come from check_references
            info = inspect_glb(path)
            np_ = f"slides[{si}].nodes[{ni}].data"
            if not info["ok"]:
                if asset.id not in invalid_reported:
                    invalid_reported.add(asset.id)
                    out.append(_finding("MODEL_INVALID", np_ + ".object",
                                        f"Model '{asset.id}' ({asset.path}) can't be loaded: "
                                        + "; ".join(info["errors"]),
                                        "Re-export the model as glTF 2.0 (`xds model inspect`).",
                                        node, slide.id))
                continue
            out += _check_node(node, info, np_, slide.id, project)
    return out


def _check_node(node: RenderNode, info: dict[str, Any], np_: str, slide_id: str,
                project: Project) -> list[Finding]:
    out: list[Finding] = []
    parts = {p["name"]: p for p in info["parts"]}
    names = ", ".join(sorted(parts)) or "(none)"
    for part_name, pose in (node.data.parts or {}).items():
        path = f"{np_}.parts.{part_name}"
        part = parts.get(part_name)
        if part is None:
            out.append(_finding("UNKNOWN_PART", path, f"The model has no part '{part_name}'.",
                                f"Parts: {names}.", node, slide_id))
            continue
        for kind, vec in (("rotate", pose.rotate), ("move", pose.move)):
            for axis, i in _AXES.items():
                lim = (part.get("limits") or {}).get(f"{kind}{axis}")
                if vec is None or lim is None:
                    continue
                if not lim[0] - 1e-9 <= vec[i] <= lim[1] + 1e-9:
                    out.append(_finding(
                        "PART_OUT_OF_RANGE", f"{path}.{kind}",
                        f"'{part_name}' {kind}{axis} = {vec[i]:g} is outside its limits "
                        f"[{lim[0]:g}, {lim[1]:g}].",
                        f"Keep {kind}[{i}] within [{lim[0]:g}, {lim[1]:g}].", node, slide_id))
    if node.data.animation:
        clips = {c["name"]: c["duration"] for c in info["clips"]}
        clip, t = node.data.animation.clip, node.data.animation.time
        if clip not in clips:
            out.append(_finding("UNKNOWN_CLIP", f"{np_}.animation.clip",
                                f"The model has no animation clip '{clip}'.",
                                f"Clips: {', '.join(clips) or '(none)'}.", node, slide_id))
        elif t > clips[clip] + 1e-6:
            out.append(_finding("UNKNOWN_CLIP", f"{np_}.animation.time",
                                f"time {t:g} s is past the end of '{clip}' ({clips[clip]:g} s).",
                                f"Use a time between 0 and {clips[clip]:g}.", node, slide_id))
    meshes = {s["name"]: s for s in info["screens"]}
    for mesh, screen_id in (node.data.screens or {}).items():
        path = f"{np_}.screens.{mesh}"
        if mesh not in parts:
            out.append(_finding("UNKNOWN_PART", path, f"The model has no mesh '{mesh}'.",
                                f"Screen meshes: {', '.join(meshes) or '(none)'}.", node, slide_id))
            continue
        screen = project.screen(screen_id)
        target = meshes.get(mesh)
        if screen is None or target is None:
            continue
        aspect = screen.width / screen.height
        if abs(aspect / target["aspect"] - 1) > ASPECT_TOLERANCE:
            rec = target["recommended"]
            out.append(_finding(
                "SCREEN_ASPECT_MISMATCH", path,
                f"Screen '{screen_id}' is {screen.width:g}×{screen.height:g} "
                f"(aspect {aspect:.3f}) but mesh '{mesh}' has aspect {target['aspect']:.3f}.",
                f"Set the screen to {rec['width']}×{rec['height']} (or another size with aspect "
                f"{target['aspect']:.3f}).", node, slide_id))
    return out
