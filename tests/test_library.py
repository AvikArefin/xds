"""The built-in model library: listing, `xds:` paths, add by reference, vendoring."""

import pytest

from xds import library, models3d, screens
from xds import project as proj
from xds.project import XdsError

from .conftest import edit

IDS = {"iphone-17-pro", "macbook-pro-14"}


def test_models_follow_the_conventions():
    items = {m["id"]: m for m in library.models()}
    assert set(items) >= IDS
    for m in items.values():
        info = models3d.inspect_glb(library.resolve(m["path"]))
        assert info["ok"] and info["warnings"] == [], (m["id"], info["warnings"])
        found = {s["name"]: s for s in info["screens"]}
        for mesh, spec in m["screens"].items():
            dev = screens.DEVICES[spec["device"]]
            # the declared device preset fits the mesh, so `screen add --device` needs no tuning
            assert abs(dev["width"] / dev["height"] / found[mesh]["aspect"] - 1) < models3d.ASPECT_TOLERANCE
            assert found[mesh]["uv"]
        parts = {p["name"] for p in info["parts"]}
        assert set(m["parts"]) <= parts
    lid = next(p for p in models3d.inspect_glb(library.resolve(items["macbook-pro-14"]["path"]))["parts"]
               if p["name"] == "Lid")
    assert lid["limits"] == {"rotateX": [-25.0, 110.0]}


@pytest.mark.parametrize("bad", ["xds:", "xds:../pyproject.toml", "xds:/etc/passwd",
                                 "xds:models/../../cli.py"])
def test_resolve_stays_inside(bad):
    with pytest.raises(XdsError) as e:
        library.resolve(bad)
    assert e.value.code == "PATH_ESCAPE"


def test_add_by_reference_with_screen(blank):
    screens.add(blank, "home", device="iphone-17-pro")
    r = models3d.add_library(blank, "iphone-17-pro", slide="s1", screen="home")
    assert r["asset"] == "xds:models/iphone-17-pro/model.glb"
    assert not (blank / "assets" / "models").exists()  # nothing copied
    loaded = proj.load(blank)
    assert loaded.findings == []
    node = next(n for n in loaded.project.slides[0].nodes if n.id == r["node"])
    assert node.data.screens == {"Screen": "home"}


def test_add_errors(blank):
    with pytest.raises(XdsError) as e:
        models3d.add_library(blank, "toaster")
    assert e.value.code == "UNKNOWN_LIBRARY_MODEL"
    with pytest.raises(XdsError) as e:
        models3d.add_library(blank, "iphone-17-pro", slide="s1", screen="nope")
    assert e.value.code == "UNKNOWN_SCREEN"
    models3d.add_library(blank, "iphone-17-pro")
    with pytest.raises(XdsError) as e:
        models3d.add_library(blank, "iphone-17-pro")
    assert e.value.code == "MODEL_EXISTS"


def test_check_reports_unknown_library_file(blank):
    models3d.add_library(blank, "macbook-pro-14")
    edit(blank, lambda d: d["assets"][0].update(path="xds:models/macbook-pro-14/missing.glb"))
    found = [(f.rule, f.message) for f in proj.load(blank).findings]
    assert len(found) == 1 and found[0][0] == "MISSING_FILE" and "xds model library" in found[0][1]


def test_vendor_copies_into_the_project(blank):
    models3d.add_library(blank, "macbook-pro-14", slide="s1")
    r = models3d.vendor(blank, "macbook-pro-14")
    assert r["path"] == "assets/models/macbook-pro-14.glb"
    assert (blank / r["path"]).read_bytes() == library.resolve(r["from"]).read_bytes()
    assert proj.load(blank).findings == []
    with pytest.raises(XdsError) as e:
        models3d.vendor(blank, "macbook-pro-14")
    assert e.value.code == "NOT_LIBRARY"


def test_screen_aspect_counts_the_lean():
    # a 0.30 × 0.195 m screen leaning back 20°: y and z extents together make its height
    w, h = models3d.screen_aspect([0.30, 0.195 * 0.9397, 0.195 * 0.3420])
    assert w == pytest.approx(0.30) and h == pytest.approx(0.195, rel=1e-3)
