"""Build small, valid GLB files in memory for the model tests (no binary fixtures).

`make_glb()` writes a model with a node hierarchy:

    Body (mesh: box)                       origin at the bottom center
    └── Lid (mesh: box, pivot on the hinge, optional extras.xds.limits)
    Screen (mesh: plane, optional)         a flat display facing +Z

plus an optional animation clip. Everything is meters, Y-up.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path
from typing import Any


def _box(sx: float, sy: float, sz: float, y0: float = 0.0) -> tuple[list[float], list[int]]:
    """Corner positions of a box spanning x ±sx/2, y y0..y0+sy, z ±sz/2, and 12 triangles."""
    xs, zs = (-sx / 2, sx / 2), (-sz / 2, sz / 2)
    ys = (y0, y0 + sy)
    pos = [c for x in xs for y in ys for z in zs for c in (x, y, z)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    idx = [i for a, b, c, d in faces for i in (a, b, c, a, c, d)]
    return pos, idx


def _plane(w: float, h: float, y0: float, z: float) -> tuple[list[float], list[int]]:
    pos = [-w / 2, y0, z, w / 2, y0, z, w / 2, y0 + h, z, -w / 2, y0 + h, z]
    return pos, [0, 1, 2, 0, 2, 3]


class _Builder:
    def __init__(self) -> None:
        self.bin = bytearray()
        self.doc: dict[str, Any] = {"asset": {"version": "2.0", "generator": "xds tests"},
                                    "buffers": [], "bufferViews": [], "accessors": [],
                                    "meshes": [], "nodes": [], "scenes": [{"nodes": []}],
                                    "scene": 0}

    def _view(self, data: bytes) -> int:
        while len(self.bin) % 4:
            self.bin.append(0)
        self.doc["bufferViews"].append({"buffer": 0, "byteOffset": len(self.bin),
                                        "byteLength": len(data)})
        self.bin += data
        return len(self.doc["bufferViews"]) - 1

    def accessor(self, values: list[float], kind: str, minmax: bool = False) -> int:
        size = {"SCALAR": 1, "VEC2": 2, "VEC3": 3}[kind]
        view = self._view(struct.pack(f"<{len(values)}f", *values))
        acc: dict[str, Any] = {"bufferView": view, "componentType": 5126,
                               "count": len(values) // size, "type": kind}
        if minmax:
            acc["min"] = [min(values[i::size]) for i in range(size)]
            acc["max"] = [max(values[i::size]) for i in range(size)]
        self.doc["accessors"].append(acc)
        return len(self.doc["accessors"]) - 1

    def mesh(self, name: str, pos: list[float], idx: list[int], uv: list[float] | None = None) -> int:
        attributes = {"POSITION": self.accessor(pos, "VEC3", minmax=True)}
        if uv is not None:
            attributes["TEXCOORD_0"] = self.accessor(uv, "VEC2")
        i = self._indices(idx)
        self.doc["meshes"].append({"name": name, "primitives": [
            {"attributes": attributes, "indices": i}]})
        return len(self.doc["meshes"]) - 1

    def _indices(self, idx: list[int]) -> int:
        view = self._view(struct.pack(f"<{len(idx)}I", *idx))
        self.doc["accessors"].append({"bufferView": view, "componentType": 5125,
                                      "count": len(idx), "type": "SCALAR"})
        return len(self.doc["accessors"]) - 1

    def node(self, **kw: Any) -> int:
        self.doc["nodes"].append(kw)
        return len(self.doc["nodes"]) - 1

    def glb(self) -> bytes:
        self.doc["buffers"] = [{"byteLength": len(self.bin)}]
        js = json.dumps(self.doc).encode()
        js += b" " * (-len(js) % 4)
        binary = bytes(self.bin) + b"\0" * (-len(self.bin) % 4)
        total = 12 + 8 + len(js) + 8 + len(binary)
        return (struct.pack("<4sII", b"glTF", 2, total)
                + struct.pack("<I4s", len(js), b"JSON") + js
                + struct.pack("<I4s", len(binary), b"BIN\0") + binary)


def make_glb(path: Path | None = None, *, size: tuple[float, float, float] = (0.2, 0.1, 0.15),
             offset: tuple[float, float, float] = (0, 0, 0), screen: tuple[float, float] | None = None,
             animation: float | None = None, limits: dict[str, list[float]] | None = None,
             lid_name: str = "Lid", extensions_required: list[str] | None = None,
             root_scale: float = 1.0) -> bytes:
    """A box `Body` with a child `Lid`, optionally a `Screen` plane (w, h) and a clip `Open`
    lasting `animation` seconds. `offset` moves the whole model off the origin."""
    b = _Builder()
    sx, sy, sz = size
    body_mesh = b.mesh("BodyMesh", *_box(sx, sy, sz))
    lid_pos, lid_idx = _box(sx, sy * 0.1, sz, 0.0)
    lid_pos = [v + sz / 2 if k % 3 == 2 else v for k, v in enumerate(lid_pos)]  # hinge at the back
    lid_mesh = b.mesh("LidMesh", lid_pos, lid_idx)
    lid: dict[str, Any] = {"name": lid_name, "mesh": lid_mesh, "translation": [0, sy, -sz / 2]}
    if limits:
        lid["extras"] = {"xds": {"limits": limits}}
    lid_i = b.node(**lid)
    body: dict[str, Any] = {"name": "Body", "mesh": body_mesh, "children": [lid_i]}
    if offset != (0, 0, 0) or root_scale != 1.0:
        body["translation"] = list(offset)
        body["scale"] = [root_scale] * 3
    roots = [b.node(**body)]
    if screen:
        w, h = screen
        # glTF UVs have their origin at the top-left: the plane's bottom-left corner is (0, 1).
        scr_mesh = b.mesh("ScreenMesh", *_plane(w, h, 0.0, 0.0), uv=[0, 1, 1, 1, 1, 0, 0, 0])
        roots.append(b.node(name="Screen", mesh=scr_mesh, translation=[offset[0], offset[1] + 0.01,
                                                                       offset[2] + sz / 2 + 0.001]))
    b.doc["scenes"][0]["nodes"] = roots
    if animation is not None:
        t = b.accessor([0.0, animation], "SCALAR", minmax=True)
        q = b._view(struct.pack("<8f", 0, 0, 0, 1, -0.5, 0, 0, 0.866))
        b.doc["accessors"].append({"bufferView": q, "componentType": 5126, "count": 2,
                                   "type": "VEC4"})
        b.doc["animations"] = [{"name": "Open", "samplers": [
            {"input": t, "output": len(b.doc["accessors"]) - 1}],
            "channels": [{"sampler": 0, "target": {"node": lid_i, "path": "rotation"}}]}]
    if extensions_required:
        b.doc["extensionsUsed"] = list(extensions_required)
        b.doc["extensionsRequired"] = list(extensions_required)
    data = b.glb()
    if path is not None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return data
