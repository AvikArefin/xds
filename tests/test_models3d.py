import json
import shutil
import struct

import pytest

from xds import models3d
from xds import project as proj
from xds.project import XdsError

from .conftest import edit
from .glb_factory import make_glb

COLLADA = """<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset><unit name="meter" meter="1"/><up_axis>Y_UP</up_axis></asset>
  <library_effects><effect id="fx"><profile_COMMON><technique sid="common"><phong>
    <diffuse><color>0.8 0.2 0.2 1</color></diffuse><shininess><float>30</float></shininess>
  </phong></technique></profile_COMMON></effect></library_effects>
  <library_materials><material id="mat" name="Red"><instance_effect url="#fx"/></material></library_materials>
  <library_geometries><geometry id="tri" name="Tri"><mesh>
    <source id="pos"><float_array id="pos-a" count="9">-0.05 0 0 0.05 0 0 0 0.1 0</float_array>
      <technique_common><accessor source="#pos-a" count="3" stride="3">
        <param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/>
      </accessor></technique_common></source>
    <vertices id="verts"><input semantic="POSITION" source="#pos"/></vertices>
    <triangles material="Red" count="1"><input semantic="VERTEX" source="#verts" offset="0"/><p>0 1 2</p></triangles>
  </mesh></geometry></library_geometries>
  <library_visual_scenes><visual_scene id="scene"><node id="Thing" name="Thing">
    <instance_geometry url="#tri"><bind_material><technique_common>
      <instance_material symbol="Red" target="#mat"/></technique_common></bind_material></instance_geometry>
  </node></visual_scene></library_visual_scenes>
  <scene><instance_visual_scene url="#scene"/></scene>
</COLLADA>
"""


def test_inspect_basic(tmp_path):
    f = tmp_path / "m.glb"
    make_glb(f, animation=1.5, limits={"rotateX": [-110, 0]})
    r = models3d.inspect(f)
    assert r["ok"] and r["errors"] == []
    b = r["bounds"]
    assert b["min"][1] == pytest.approx(0) and b["max"][1] == pytest.approx(0.11)
    assert b["size"][0] == pytest.approx(0.2)
    assert r["triangles"] == 24
    parts = {p["name"]: p for p in r["parts"]}
    assert parts["Lid"]["parent"] == "Body" and parts["Lid"]["pivot"] == [0, 0.1, -0.075]
    assert parts["Lid"]["limits"] == {"rotateX": [-110, 0]}
    assert r["clips"] == [{"name": "Open", "duration": 1.5}]
    assert r["warnings"] == []


def test_screen_mesh_aspect_and_recommendation(tmp_path):
    f = tmp_path / "phone.glb"
    make_glb(f, size=(0.075, 0.16, 0.008), screen=(0.069, 0.1495))
    (s,) = models3d.inspect(f)["screens"]
    assert s["name"] == "Screen"
    assert s["aspect"] == pytest.approx(0.069 / 0.1495, rel=1e-3)
    assert s["recommended"]["device"] in ("iphone", "iphone-max", "android")
    rec = s["recommended"]
    assert rec["width"] / rec["height"] == pytest.approx(s["aspect"], rel=0.01)


def test_convention_warnings(tmp_path):
    f = tmp_path / "bad.glb"
    make_glb(f, offset=(5, 3, 0), lid_name="Body", root_scale=100)
    codes = {w["code"] for w in models3d.inspect(f)["warnings"]}
    assert {"MODEL_UNITS_SUSPECT", "MODEL_NOT_GROUNDED", "MODEL_OFF_CENTER",
            "MODEL_DUPLICATE_PART_NAMES"} <= codes


def test_unsupported_required_extension(tmp_path):
    f = tmp_path / "x.glb"
    make_glb(f, extensions_required=["KHR_texture_basisu"])
    r = models3d.inspect(f)
    assert not r["ok"] and any(w["code"] == "MODEL_UNSUPPORTED_EXTENSION" for w in r["warnings"])
    g = tmp_path / "y.glb"
    make_glb(g, extensions_required=["KHR_draco_mesh_compression"])
    assert models3d.inspect(g)["ok"]


def test_not_a_glb(tmp_path):
    f = tmp_path / "n.glb"
    f.write_bytes(b"nope" * 10)
    assert not models3d.inspect(f)["ok"]
    v1 = tmp_path / "v1.glb"
    data = bytearray(make_glb())
    struct.pack_into("<I", data, 4, 1)
    v1.write_bytes(bytes(data))
    assert "version" in models3d.inspect(v1)["errors"][0]


def test_add_registers_and_replace_keeps_poses(blank, tmp_path):
    src = tmp_path / "bottle.glb"
    make_glb(src)
    res = models3d.add(blank, src, id="bottle", name="Bottle", slide="s1", replace=False)
    assert res["asset"] == "assets/models/bottle.glb" and res["node"] == "bottle-s1"
    loaded = proj.load(blank)
    assert loaded.ok, loaded.findings
    p = loaded.project
    assert p.asset("bottle").kind == "model" and p.object("bottle").pose.scale == (1, 1, 1)

    with pytest.raises(XdsError) as e:
        models3d.add(blank, src, id="bottle", slide=None)
    assert e.value.code == "MODEL_EXISTS"

    edit(blank, lambda d: d["objects"][0]["pose"].update(position=[0.1, 0, 0]))
    make_glb(src, size=(0.3, 0.2, 0.1))
    models3d.add(blank, src, id="bottle", slide="s1", replace=True)
    p = proj.load(blank).project
    assert p.object("bottle").pose.position == (0.1, 0, 0)
    assert len(p.slides[0].nodes) == 1 and len(p.assets) == 1


def test_add_converts_gltf_and_keeps_source(blank, tmp_path):
    glb = tmp_path / "a.glb"
    make_glb(glb)
    gltf = tmp_path / "a.gltf"
    # unpack the GLB into .gltf + .bin
    data = glb.read_bytes()
    jlen = struct.unpack_from("<I", data, 12)[0]
    doc = json.loads(data[20:20 + jlen])
    blen = struct.unpack_from("<I", data, 20 + jlen)[0]
    (tmp_path / "a.bin").write_bytes(data[28 + jlen:28 + jlen + blen])
    doc["buffers"][0]["uri"] = "a.bin"
    gltf.write_text(json.dumps(doc))
    res = models3d.add(blank, gltf, id="a", slide=None)
    assert res["converted"] and res["source"] == "sources/a/a.gltf"
    assert (blank / "sources" / "a" / "a.bin").exists()
    assert models3d.inspect(blank / "assets" / "models" / "a.glb")["triangles"] == 24


def test_add_converts_collada(blank, tmp_path):
    dae = tmp_path / "thing.dae"
    dae.write_text(COLLADA)
    res = models3d.add(blank, dae, id="thing", slide="s1")
    assert any(w["code"] == "MODEL_MATERIALS_APPROXIMATED" for w in res["warnings"])
    info = res["inspection"]
    assert info["ok"] and info["triangles"] == 1
    assert info["bounds"]["max"][1] == pytest.approx(0.1, abs=1e-6)
    assert (blank / "sources" / "thing" / "thing.dae").exists()


def _with_node(root, tmp_path, data, **glb_kw):
    src = tmp_path / "dev.glb"
    make_glb(src, **glb_kw)
    models3d.add(root, src, id="dev", slide="s1")
    edit(root, lambda d: d["slides"][0]["nodes"][0]["data"].update(data))
    return {(f.rule, f.path) for f in proj.load(root).findings}


def test_check_parts_clips_and_limits(blank, tmp_path):
    np_ = "slides[0].nodes[0].data"
    found = _with_node(blank, tmp_path, {
        "parts": {"Lid": {"rotate": [-120, 0, 0]}, "Nope": {"hidden": True}},
        "animation": {"clip": "Open", "time": 3}}, animation=1.0, limits={"rotateX": [-110, 0]})
    assert ("PART_OUT_OF_RANGE", f"{np_}.parts.Lid.rotate") in found
    assert ("UNKNOWN_PART", f"{np_}.parts.Nope") in found
    assert ("UNKNOWN_CLIP", f"{np_}.animation.time") in found

    edit(blank, lambda d: d["slides"][0]["nodes"][0]["data"].update(
        parts={"Lid": {"rotate": [-90, 0, 0]}}, animation={"clip": "Close", "time": 0}))
    found = {(f.rule, f.path) for f in proj.load(blank).findings}
    assert found == {("UNKNOWN_CLIP", f"{np_}.animation.clip")}


def test_check_screen_aspect(blank, tmp_path):
    def add_screen(d, w, h):
        d["screens"] = [{"id": "home", "path": "screens/home/index.html", "width": w, "height": h}]
    (blank / "screens" / "home").mkdir(parents=True)
    (blank / "screens" / "home" / "index.html").write_text("<html></html>")
    edit(blank, lambda d: add_screen(d, 393, 852))
    found = _with_node(blank, tmp_path, {"screens": {"Screen": "home"}},
                       size=(0.075, 0.16, 0.008), screen=(0.069, 0.1495))
    assert found == set()
    edit(blank, lambda d: add_screen(d, 393, 700))
    rules = [f.rule for f in proj.load(blank).findings]
    assert rules == ["SCREEN_ASPECT_MISMATCH"]


def test_check_invalid_model(blank, tmp_path):
    src = tmp_path / "dev.glb"
    make_glb(src)
    models3d.add(blank, src, id="dev", slide="s1")
    (blank / "assets" / "models" / "dev.glb").write_bytes(b"garbage-garbage-garbage")
    assert [f.rule for f in proj.load(blank).findings] == ["MODEL_INVALID"]


def test_cache_by_hash(tmp_path):
    f = tmp_path / "m.glb"
    make_glb(f)
    a = models3d.inspect_glb(f)
    a["parts"].clear()
    assert models3d.inspect_glb(f)["parts"]  # callers get copies
    shutil.copyfile(f, tmp_path / "n.glb")
    assert models3d.inspect_glb(tmp_path / "n.glb") == models3d.inspect_glb(f)
