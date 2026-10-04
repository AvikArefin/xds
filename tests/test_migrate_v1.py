"""v1 (xds_pre) → v2: the m0002 step through `xds migrate`, on a small hand-made v1 project."""

import json
import math

import pytest

from xds import fonts, migrate
from xds import project as proj

V1 = {
    "schemaVersion": "1.0", "id": "Old_Project", "name": "Old project", "description": "d",
    "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-02T00:00:00Z",
    "canvas": {"width": 1080, "height": 1350, "unit": "px", "background": "night"},
    "publishTarget": {"name": "social-portrait", "width": 1080, "height": 1350, "format": "png"},
    "brand": {"name": "B", "colors": [{"name": "night", "hex": "#101010"},
                                      {"name": "ink", "hex": "#FAFAFA"},
                                      {"name": "accent", "hex": "#ff5500"}],
              "typographyStyles": {"headline": {"fontFamily": "Clash Display", "colorToken": "ink"},
                                   "eyebrow": {"fontFamily": "Satoshi", "fontSize": 30},
                                   "body": {"fontFamily": "Satoshi", "colorToken": "ink"}}},
    "layout": {"outerInset": 64},
    "slides": [{"id": "s2", "name": "Second", "order": 1, "interface": []},
               {"id": "s1", "name": "First", "order": 0, "interface": ["logo"],
                "lighting": {"presetId": "dramatic-rim", "intensity": 1, "direction": 90, "pitch": 0,
                             "exposure": 2, "lights": [
                                 {"id": "rig-key", "transform": {"location": [2, 0, 0]}}]}}],
    "nodes": [
        {"id": "g1", "slideId": "s1", "layer": "ground", "kind": "design",
         "transform": {"x": 0, "y": 0, "width": 100, "height": 100, "rotation": 0, "opacity": 1,
                       "visible": True},
         "data": {"kind": "design", "designId": "haze", "values": {"width": 40, "glow": 0.2}}},
        {"id": "r1", "slideId": "s1", "layer": "render", "kind": "scene-object",
         "transform": {"x": 10, "y": 12, "width": 80, "height": 45},
         "data": {"kind": "scene-object", "objectId": "drone", "role": "subject",
                  "transform": {"location": [0, 0, 0], "rotation": [0, 45, 0], "scale": [0.01] * 3},
                  "cameraTransform": {"location": [2, 1, 6]}, "cameraTarget": [0, 0.5, 0]}},
        {"id": "r2", "slideId": "s1", "layer": "render", "kind": "scene-object",
         "transform": {"x": 0, "y": 0, "width": 10, "height": 10, "visible": False},
         "data": {"kind": "scene-object", "objectId": "cube"}},
        {"id": "t1", "slideId": "s1", "layer": "type", "kind": "text",
         "transform": {"x": 8, "y": 6, "width": 84, "height": 4, "rotation": 5, "opacity": 0.5},
         "data": {"kind": "text", "text": "NEW", "role": "eyebrow", "horizontalAlign": "center",
                  "verticalAlign": "middle", "offsetX": 0, "offsetY": 0, "colorToken": "accent"}},
        {"id": "i1", "slideId": "s2", "layer": "image", "kind": "image",
         "transform": {"x": 0, "y": 50, "width": 100, "height": 50},
         "data": {"kind": "image", "assetId": "photo", "fit": "contain"}},
    ],
    "assets": [{"id": "drone-glb", "path": "assets/drone.glb", "kind": "model", "role": "model"},
               {"id": "photo", "path": "assets/photo.jpg", "kind": "image", "role": "image"}],
    "fonts": [], "scene": {"sceneData": "scene-data.json"},
}
SCENE = {"camera": {"lens": 58, "sensorWidth": 36, "transform": {"location": [0, 2, 9]}},
         "materials": [{"id": "red", "name": "Red", "color": {"r": 1, "g": 0, "b": 0, "a": 1}}],
         "objects": [
             {"id": "drone", "name": "Drone", "kind": "image", "assetId": "drone-glb",
              "transform": {"location": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}},
             {"id": "cube", "name": "Cube", "kind": "box", "materialId": "red",
              "parameters": {"width": 1, "height": 2, "depth": 1},
              "transform": {"location": [1, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}}]}
HAZE = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none">
  <metadata id="xds-design">{"name": "Haze", "params": [
    {"name": "width", "type": "number", "default": 30, "min": 0, "max": 100},
    {"name": "glow", "type": "number", "default": 0.3}]}</metadata>
  <rect x="0" y="0" width="{{width}}" height="100" opacity="{{glow * 2}}"/>
</svg>
"""


@pytest.fixture
def fetched():
    return []


@pytest.fixture
def v1(tmp_path, monkeypatch, fetched):
    root = tmp_path / "old"
    (root / "assets").mkdir(parents=True)
    (root / "designs").mkdir()
    (root / "project.json").write_text(json.dumps(V1))
    (root / "scene-data.json").write_text(json.dumps(SCENE))
    (root / "designs" / "haze.svg").write_text(HAZE)
    (root / "assets" / "photo.jpg").write_bytes(b"jpg")
    (root / "AGENTS.md").write_text("# v1 instructions")
    (root / "review-state.json").write_text("{}")
    (root / "blender-5.2.md").write_text("notes")
    from .glb_factory import make_glb
    make_glb(root / "assets" / "drone.glb")
    def fake_fetch(r, family):  # offline: register a library-style entry without downloading
        doc = json.loads((r / "project.json").read_text())
        doc["fonts"].append({"family": family, "path": f"fonts/{family}.woff2", "weight": 400})
        (r / "fonts").mkdir(exist_ok=True)
        (r / "fonts" / f"{family}.woff2").write_bytes(b"")
        (r / "project.json").write_text(json.dumps(doc))
        fetched.append(family)
        return [doc["fonts"][-1]]

    monkeypatch.setattr(fonts, "fetch", fake_fetch)
    return root


def test_v1_migrates_to_a_valid_project(v1, fetched):
    rep = migrate.run(v1)
    assert rep["ok"] and rep["written"] and rep["steps"] == ["m0002_v1_to_v2"]
    assert rep["fromVersion"] == "1.0" and rep["toVersion"] == 2
    assert sorted(fetched) == ["Clash Display", "Satoshi"]
    assert json.loads((v1 / rep["backup"]).read_text())["schemaVersion"] == "1.0"
    loaded = proj.load(v1)
    assert loaded.ok, [f.message for f in loaded.findings]
    p = loaded.project
    assert p.id == "old-project" and p.format.preset == "instagram-portrait"
    assert [s.id for s in p.slides] == ["s1", "s2"]  # ordered by v1 `order`
    assert p.slides[0].background == "night"


def test_v1_typography_keeps_the_v1_look(v1):
    migrate.run(v1)
    t = proj.load(v1).project.brand.typography
    # headline: v1 band default round(1080 × 0.06), bold, tight
    assert (t["headline"].level, t["headline"].size, t["headline"].weight) == ("headline", 65, 700)
    assert t["headline"].line_height == 1.05 and t["headline"].color == "ink"
    # eyebrow: explicit size, bold, uppercase, tracked, seed color accent
    e = t["eyebrow"]
    assert (e.level, e.size, e.weight, e.uppercase, e.color) == ("caption", 30, 700, True, "accent")
    assert e.letter_spacing == pytest.approx(max(0.8, 0.12 * 30 / 16) / 30, abs=1e-4)
    assert (t["body"].level, t["body"].size, t["body"].weight) == ("body", 32, 400)


def test_v1_nodes_scene_camera_and_light(v1):
    rep = migrate.run(v1)
    p = proj.load(v1).project
    s1 = p.slides[0]
    by_id = {n.id: n for n in s1.nodes}
    assert by_id["g1"].data.values == {"widthParam": 40, "glow": 0.2}
    t1 = by_id["t1"]
    assert (t1.box.x, t1.box.w, t1.box.rotation, t1.box.opacity) == (8, 84, 5, 0.5)
    assert (t1.data.align, t1.data.valign, t1.data.color) == ("center", "middle", "accent")
    r1 = by_id["r1"]
    assert r1.data.pose.rotation == (0, 45, 0) and r1.data.pose.scale == (0.01, 0.01, 0.01)
    assert by_id["r2"].hidden is True
    # the camera of the first visible render node, fov from lens 58 / sensor 36
    cam = s1.camera
    assert cam.mode == "free" and cam.position == (2, 1, 6) and cam.target == (0, 0.5, 0)
    assert cam.fov == pytest.approx(math.degrees(2 * math.atan(36 / 116)), abs=1e-3)
    assert p.slides[1].camera is None
    # light: the key at +X is azimuth 90°, exposure 2 is +1 stop
    light = s1.lighting
    assert (light.look, light.angle, light.elevation, light.brightness) == ("rim", 90, 0, 1)
    # objects: the glb "image" is a model; the box stands on the floor (v1 centered it)
    objs = {o.id: o for o in p.objects}
    assert objs["drone"].kind == "model" and objs["drone"].asset == "drone-glb"
    assert objs["cube"].kind == "box" and objs["cube"].pose.position == (1, -1, 0)
    assert objs["cube"].material == "red" and p.materials[0].color == "#ff0000"
    img = p.slides[1].nodes[0]
    assert img.data.asset == "photo" and img.data.fit == "contain"
    assert "designs/haze.svg" in rep["files"]


def test_v1_design_param_clash_is_renamed(v1):
    migrate.run(v1)
    text = (v1 / "designs" / "haze.svg").read_text()
    assert '"name": "widthParam"' in text and 'width="{{widthParam}}"' in text
    assert 'opacity="{{glow * 2}}"' in text
    backups = list((v1 / migrate.BACKUP_DIR).glob("*/designs/haze.svg"))
    assert backups and "{{width}}" in backups[0].read_text()
    from xds import designs
    assert designs.load_all(v1)["haze"].get("error") is None


def test_v1_dry_run_touches_nothing(v1, fetched):
    before = (v1 / "project.json").read_text()
    rep = migrate.run(v1, dry_run=True)
    assert rep["ok"] and not rep["written"] and fetched == []
    assert (v1 / "project.json").read_text() == before and "{{width}}" in (v1 / "designs" / "haze.svg").read_text()


def test_v1_leftovers_move_into_the_backup(v1):
    rep = migrate.run(v1)
    bdir = (v1 / rep["backup"]).parent
    for f in ("scene-data.json", "review-state.json", "AGENTS.md"):
        assert (bdir / f).is_file() and f in rep["retired"]
    assert not (v1 / "scene-data.json").exists() and not (v1 / "review-state.json").exists()
    assert (bdir / "AGENTS.md").read_text() == "# v1 instructions"
    assert "xds model library" in (v1 / "AGENTS.md").read_text()  # the v2 guide replaces it
    assert (v1 / "blender-5.2.md").exists()  # not a v1 format file: left alone
