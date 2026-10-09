"""Through the real browser: stacked text, `xds measure`, per-object `place` and landscape screens."""

import json
import shutil
from pathlib import Path

import pytest
from PIL import Image

from xds import browser, layout, screens
from xds import project as proj
from xds.api import STUDIO_DIST
from xds.models import SlideMeasure

from .conftest import edit

EXAMPLE = Path(__file__).parent / "fixtures" / "example"
U = 8  # the spacing unit at 1080 px wide

pytestmark = pytest.mark.skipif(not (STUDIO_DIST / "index.html").exists(),
                                reason="needs a built studio (npm run build)")

LANDSCAPE_PAGE = """<!doctype html><html><body style="margin:0">
<div style="position:absolute;left:0;top:0;bottom:0;width:50%;background:#ff0000"></div>
<div style="position:absolute;right:0;top:0;bottom:0;width:50%;background:#0000ff"></div>
</body></html>"""


def node(doc, slide_id, node_id):
    slide = next(s for s in doc["slides"] if s["id"] == slide_id)
    return next(n for n in slide["nodes"] if n["id"] == node_id)


@pytest.fixture(scope="module")
def example(tmp_path_factory):
    root = tmp_path_factory.mktemp("layout") / "example"
    shutil.copytree(EXAMPLE, root, ignore=shutil.ignore_patterns("cache", "export"))
    if not all(proj.resolve_asset(root, f["path"]).exists()
               for f in json.loads((root / "project.json").read_text())["fonts"]):
        from xds import fonts
        try:
            for family in ("Satoshi", "General Sans"):
                fonts.fetch(root, family)
        except Exception as e:  # offline
            pytest.skip(f"the example's fonts could not be downloaded: {e}")

    screens.add(root, "cam", width=852, height=393, scale=2, orientation="landscape-left")
    (root / "screens" / "cam" / "index.html").write_text(LANDSCAPE_PAGE)

    def change(d):
        b2 = node(d, "s2", "b2")
        b2["box"]["y"] = 0
        b2["data"]["stack"] = {"below": "h2", "gap": 3}
        phone2 = node(d, "s2", "phone-s2")["data"]
        phone2["pose"]["rotation"] = [0, 0, 90]
        phone2["screens"] = {"Screen": "cam"}
        node(d, "s1", "phone-s1")["data"]["place"] = {"x": 30, "y": 50, "height": 40}
        node(d, "s1", "podium-s1")["data"]["place"] = {"x": 72, "y": 64, "height": 12}
    edit(root, change)
    assert proj.load(root).ok, proj.load(root).findings
    return root


def ink(measured_node):
    lines = measured_node.lines
    return min(r.rect.y for r in lines), max(r.rect.y + r.rect.h for r in lines)


def test_measure_places_a_stacked_block_ink_to_ink(example):
    report = layout.measure(example, slide_ids=["s2"])
    rows = {n["id"]: n for n in report["slides"][0]["nodes"]}
    assert rows["b2"]["stack"] == {"below": "h2", "gap": 3, "y": rows["b2"]["box"]["y"]}
    gap_px = (rows["b2"]["ink"]["px"]["y"]) - (rows["h2"]["ink"]["px"]["y"] + rows["h2"]["ink"]["px"]["h"])
    assert gap_px == pytest.approx(3 * U, abs=1)
    assert rows["b2"]["lineCount"] == len(rows["b2"]["lines"]) >= 1 and rows["b2"]["fitH"] > 0
    assert rows["b2"]["contrast"]["lcMin"] in (45, 60, 75)
    assert set(report["checks"]) >= {"WIDOW", "TEXT_CLIPPED", "SPACING_OFF_SCALE"}
    assert not {"LOW_CONTRAST", "SUBJECT_TOO_SMALL"} & set(report["checks"])


def test_render_matches_measure_and_places_objects(example):
    text_only = layout.measure(example, slide_ids=["s2"])["slides"][0]["nodes"]
    result = browser.render(example)
    by_id = {s.slide_id: SlideMeasure.model_validate_json(s.measure.read_text()) for s in result.slides}
    W, H = by_id["s1"].width, by_id["s1"].height

    # the full render puts the stacked block exactly where `xds measure` said
    b2 = next(n for n in by_id["s2"].nodes if n.id == "b2")
    expected_y = next(n for n in text_only if n["id"] == "b2")["box"]["y"]
    assert 100 * b2.box.y / H == pytest.approx(expected_y, abs=0.05)
    h2 = next(n for n in by_id["s2"].nodes if n.id == "h2")
    assert ink(b2)[0] - ink(h2)[1] == pytest.approx(3 * U, abs=1)

    # each placed object's silhouette is centered where its `place` says, at about its height
    phone = next(n for n in by_id["s1"].nodes if n.id == "phone-s1").box
    assert 100 * (phone.x + phone.w / 2) / W == pytest.approx(30, abs=1.5)
    assert 100 * (phone.y + phone.h / 2) / H == pytest.approx(50, abs=1.5)
    assert 100 * phone.h / H == pytest.approx(40, abs=2.5)
    podium = next(n for n in by_id["s1"].nodes if n.id == "podium-s1").box
    assert 100 * (podium.x + podium.w / 2) / W == pytest.approx(72, abs=2)

    # a landscape page is drawn upright on a phone turned with its top to the left
    screen = by_id["s2"].screens[0]
    assert screen.screen_id == "cam" and screen.rect.w > screen.rect.h
    png = Image.open(result.slides[1].png).convert("RGB")
    cy = screen.rect.y + screen.rect.h / 2
    left = png.getpixel((int(screen.rect.x + 0.3 * screen.rect.w), int(cy)))
    right = png.getpixel((int(screen.rect.x + 0.7 * screen.rect.w), int(cy)))
    assert left[0] > 200 and left[2] < 60, left     # the page's left half: red
    assert right[2] > 200 and right[0] < 60, right  # its right half: blue
