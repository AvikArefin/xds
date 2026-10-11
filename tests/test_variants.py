import json

from xds import formats, project as proj
from xds.models import Format, Project, apply_variant, merge_variant, orientation_of

from .conftest import edit


def test_orientation_classes():
    assert orientation_of(1080, 1350) == "portrait"
    assert orientation_of(1080, 1440) == "portrait"
    assert orientation_of(1080, 1920) == "story"
    assert orientation_of(1080, 1080) == "square"
    assert orientation_of(1100, 1080) == "square"
    assert orientation_of(1200, 627) == "landscape"
    assert formats.orientation(Format(width=1440, height=1080)) == "landscape"
    assert formats.derive(Format(preset="instagram-story", width=1080, height=1920)).to_json()["orientation"] == "story"
    by_key = {f["key"]: f["orientation"] for f in formats.catalog_json()}
    assert by_key["instagram-story"] == "story" and by_key["linkedin-landscape"] == "landscape"
    assert by_key["instagram-square"] == "square" and by_key["instagram-portrait"] == "portrait"


def test_merge_rule():
    base = {"box": {"x": 1, "y": 2}, "layout": {"pin": {}}, "data": {"text": "a"}}
    out = merge_variant(base, {"box": {"y": 9}, "layout": None, "data": {"size": 3}})
    assert out == {"box": {"x": 1, "y": 9}, "data": {"text": "a", "size": 3}}
    assert base["layout"] == {"pin": {}}   # untouched


def with_variants(root):
    (root / "fonts").mkdir(exist_ok=True)
    (root / "fonts" / "Inter.woff2").write_bytes(b"")

    def fn(d):
        d["brand"]["typography"]["body"] = {"level": "body", "font": "Inter"}
        d["fonts"] = [{"family": "Inter", "path": "fonts/Inter.woff2"}]
        d["slides"][0]["nodes"].append({
            "id": "t", "layer": "type", "box": {"x": 5, "y": 5, "w": 50, "h": 6},
            "layout": {"pin": {"left": {"to": "margin"}}},
            "data": {"text": "Hi", "role": "body"},
            "variants": {"landscape": {"box": {"w": 30}, "layout": None, "data": {"size": 40}},
                         "square": {"hidden": True}}})
    return edit(root, fn)


def test_effective_nodes_apply_the_format_variant(blank):
    with_variants(blank)
    loaded = proj.load(blank)
    assert loaded.ok, loaded.findings
    p = loaded.project
    assert p.orientation == "portrait"
    t = p.slides[0].nodes[1]
    assert p.effective_nodes(p.slides[0])[1] is t          # no portrait variant: the base itself
    sq = apply_variant(t, "square")
    assert sq.hidden is True and sq.box.w == 50 and sq.layout is not None
    ls = apply_variant(t, "landscape")
    assert ls.box.w == 30 and ls.layout is None and ls.data.size == 40 and ls.variants == t.variants
    # retarget the project: the landscape variant applies
    p.format = Format(preset="linkedin-landscape", width=1200, height=627)
    assert p.effective_nodes(p.slides[0])[1].box.w == 30


def test_variant_gate(blank):
    with_variants(blank)

    def bad(d):
        d["slides"][0]["nodes"][1]["variants"]["story"] = {"id": "other"}
        d["slides"][0]["nodes"][1]["variants"]["landscape"]["data"]["size"] = "big"
    edit(blank, bad)
    loaded = proj.load(blank)
    found = {(f.rule, f.path) for f in loaded.findings}
    assert ("VARIANT_INVALID", "slides[0].nodes[1].variants.story.id") in found
    assert ("VARIANT_INVALID", "slides[0].nodes[1].variants.landscape.data.size") in found
    assert not loaded.ok
    # an invalid variant never breaks the base: effective nodes fall back to it
    p = Project.model_validate(loaded.raw)
    p.format = Format(preset="linkedin-landscape", width=1200, height=627)
    assert p.effective_nodes(p.slides[0])[1].box.w == 50


def test_reflow_keeps_variants(blank):
    from xds import reflow
    with_variants(blank)
    doc = json.loads((blank / "project.json").read_text())
    new, _ = reflow.reflow(doc, Format(preset="linkedin-landscape", width=1200, height=627))
    assert new["slides"][0]["nodes"][1]["variants"] == doc["slides"][0]["nodes"][1]["variants"]
