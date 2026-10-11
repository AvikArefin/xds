import json

import pytest
from fastapi.testclient import TestClient

from xds import cli, layouts, project as proj
from xds.api import create_app
from xds.models import LEVELS, Project
from xds.project import XdsError

from .conftest import edit

FORMATS = {
    "portrait": {"preset": "instagram-portrait", "width": 1080, "height": 1350},
    "square": {"preset": "instagram-square", "width": 1080, "height": 1080},
    "landscape": {"preset": "linkedin-landscape", "width": 1200, "height": 627},
    "story": {"preset": "instagram-story", "width": 1080, "height": 1920},
}


def ready(root, *, roles=True, logo=True):
    """A blank project with a font, a role per level and a logo asset."""
    (root / "fonts" / "Inter").mkdir(parents=True, exist_ok=True)
    (root / "fonts" / "Inter" / "Inter.woff2").write_bytes(b"")
    (root / "assets").mkdir(exist_ok=True)
    (root / "assets" / "logo.svg").write_text("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 5'/>")

    def fn(d):
        d["fonts"] = [{"family": "Inter", "path": "fonts/Inter/Inter.woff2", "weight": 400}]
        if roles:
            d["brand"]["typography"] = {lvl: {"level": lvl, "font": "Inter"} for lvl in LEVELS}
        if logo:
            d["assets"] = [{"id": "logo", "path": "assets/logo.svg", "kind": "svg"}]
    return edit(root, fn)


def gate(root, doc):
    p = Project.model_validate(doc)
    return [f for f in proj.check_references(root, p, deep=False) if f.severity == "error"]


def test_library_lists_every_layout_with_relations_only():
    items = layouts.list_layouts()
    assert len(items) >= 10 and {i["id"] for i in items} >= {
        "hero-left", "hero-centered", "split-left", "split-right", "stacked-centered", "caption-bottom",
        "quote", "product-spotlight", "carousel-page", "poster-expressive", "thumbnail"}
    for item in items:
        d = layouts.load_layout(item["id"])
        assert set(d["slots"]) <= set(layouts.SLOTS) and d["intent"] and d["description"]
        for n in d["nodes"]:
            assert n["layer"] in ("type", "image"), n["id"]
            assert "size" not in n.get("data", {}), f"{item['id']}/{n['id']} uses a px size"
            assert n["slot"] in layouts.SLOTS
            if n["layer"] == "type":
                assert n["layout"], f"{item['id']}/{n['id']} has no relation"


@pytest.mark.parametrize("mode", layouts.MODES)
@pytest.mark.parametrize("orient", list(FORMATS))
def test_every_layout_applies_in_every_mode_and_orientation(blank, mode, orient):
    doc = ready(blank)
    doc["format"] = FORMATS[orient]
    for item in layouts.list_layouts():
        out, report = layouts.apply(doc, "s1", item["id"], mode=mode)
        assert report["orientation"] == orient
        assert gate(blank, out) == [], (item["id"], mode, orient)
        slide = next(s for s in out["slides"] if s["id"] == report["slide"])
        assert any(n["layer"] == "ground" for n in slide["nodes"])   # the background came along
        ids = [n["id"] for n in slide["nodes"]]
        assert len(ids) == len(set(ids))


def test_fill_keeps_words_and_lists_the_rest(blank):
    doc = ready(blank)
    doc["slides"][0]["nodes"] += [
        {"id": "h", "layer": "type", "box": {"x": 1, "y": 1, "w": 50, "h": 10}, "data": {"text": "Keep me", "role": "headline", "color": "paper"}},
        {"id": "odd", "layer": "type", "box": {"x": 1, "y": 50, "w": 50, "h": 10}, "data": {"text": "Loose", "role": "body"}},
        {"id": "brand", "layer": "image", "box": {"x": 1, "y": 80, "w": 10, "h": 5}, "data": {"asset": "logo"}},
    ]
    out, r = layouts.apply(doc, "s1", "product-spotlight", mode="fill")
    slide = out["slides"][0]
    h = next(n for n in slide["nodes"] if n["id"] == "h")
    assert h["data"]["text"] == "Keep me" and h["data"]["color"] == "paper" and h["data"]["scale"] == 0.8
    assert h["layout"]["pin"]["left"] == {"to": "margin"} and h["layout"]["fit"] == "text"
    assert {f["slot"] for f in r["filled"]} == {"headline", "logo"}
    assert r["kept"] == ["odd"] and r["added"] == []
    brand = next(n for n in slide["nodes"] if n["id"] == "brand")
    assert brand["data"]["asset"] == "logo" and brand["layout"]["pin"]["right"] == {"to": "margin"}


def test_relations_between_layout_nodes_are_remapped(blank):
    doc = ready(blank)
    doc["slides"][0]["nodes"].append({"id": "headline", "layer": "image", "box": {"x": 1, "y": 1, "w": 10, "h": 5},
                                      "data": {"asset": "logo"}})   # takes the id the layout wants
    out, r = layouts.apply(doc, "s1", "carousel-page", mode="fill")
    slide = out["slides"][0]
    body = next(n for n in slide["nodes"] if n["id"] == "body")
    assert body["layout"]["stack"]["below"] == "headline-2" and body["layout"]["align"][0]["node"] == "headline-2"
    assert "headline-2" in r["added"]


def test_replace_and_new(blank):
    doc = ready(blank)
    doc["slides"][0]["nodes"].append({"id": "old", "layer": "type", "box": {"x": 1, "y": 1, "w": 50, "h": 10},
                                      "layout": {"group": "g"}, "data": {"text": "Old", "role": "body"}})
    doc["slides"][0]["groups"] = {"g": {"direction": "row"}}
    doc["objects"] = [{"id": "box", "name": "Box", "kind": "box"}]
    doc["slides"][0]["nodes"].append({"id": "obj", "layer": "render", "data": {"object": "box"}})
    out, r = layouts.apply(doc, "s1", "hero-left", mode="replace")
    slide = out["slides"][0]
    assert r["replaced"] == ["old"] and "g" not in (slide.get("groups") or {}) and "intro" in slide["groups"]
    assert [n["id"] for n in slide["nodes"] if n["layer"] in ("ground", "render")] == ["s1-background", "obj"]
    assert r["subject"]["node"] == "obj" and slide["nodes"][1]["data"]["place"] == {"x": 72, "y": 58, "height": 55}

    out, r = layouts.apply(doc, "s1", "hero-centered", mode="new")
    assert [s["id"] for s in out["slides"]] == ["s1", "s2"] and r["slide"] == "s2"
    s2 = out["slides"][1]
    assert s2["nodes"][0]["layer"] == "ground" and s2["nodes"][0]["id"] == "s2-background"
    assert any("add a model" in n for n in r["notes"])
    assert out["slides"][0]["nodes"][1]["id"] == "old"   # the source slide is untouched


def test_group_variants_follow_the_orientation(blank):
    doc = ready(blank)
    doc["format"] = FORMATS["landscape"]
    out, _ = layouts.apply(doc, "s1", "hero-left", mode="replace")
    g = out["slides"][0]["groups"]["intro"]
    assert g["direction"] == "column" and g["pin"]["left"] == {"to": "margin"}
    _, r = layouts.apply(doc, "s1", "stacked-centered", mode="replace")
    doc2 = ready(blank)
    doc2["objects"] = [{"id": "box", "name": "Box", "kind": "box"}]
    doc2["slides"][0]["nodes"].append({"id": "obj", "layer": "render", "data": {"object": "box"}})
    doc2["format"] = FORMATS["landscape"]
    _, r = layouts.apply(doc2, "s1", "stacked-centered", mode="replace")
    assert r["subject"]["place"]["height"] == 52   # the landscape variant of the hint


def test_missing_roles_are_reported_or_added(blank):
    doc = ready(blank, roles=False)
    with pytest.raises(XdsError) as e:
        layouts.apply(doc, "s1", "hero-left", mode="replace")
    assert e.value.code == "MISSING_ROLES"
    levels = [m["level"] for m in e.value.details["missingRoles"]]
    assert levels == ["caption", "headline", "subhead", "body"]
    assert e.value.details["missingRoles"][1]["suggested"] == {"headline": {"level": "headline", "font": "Inter"}}
    out, r = layouts.apply(doc, "s1", "hero-left", mode="replace", add_roles=True)
    assert set(r["addedRoles"]) == {"caption", "headline", "subhead", "body"}
    assert gate(blank, out) == []
    doc["fonts"] = []
    with pytest.raises(XdsError) as e:
        layouts.apply(doc, "s1", "hero-left", mode="replace", add_roles=True)
    assert e.value.code == "NO_FONTS"


def test_poster_installs_an_expression_system_once(blank):
    doc = ready(blank)
    out, r = layouts.apply(doc, "s1", "poster-expressive", mode="replace")
    assert out["brand"]["expression"]["skews"] == [-12] and r["expression"]
    out["brand"]["expression"] = {"skews": [5]}
    out2, r2 = layouts.apply(out, "s1", "poster-expressive", mode="new")
    assert out2["brand"]["expression"] == {"skews": [5]} and "expression" not in r2


def test_unknown_layout_slide_and_mode(blank):
    doc = ready(blank)
    for args, code in ((("s1", "nope"), "UNKNOWN_LAYOUT"), (("s9", "quote"), "UNKNOWN_SLIDE"), (("s1", "../x"), "UNKNOWN_LAYOUT")):
        with pytest.raises(XdsError) as e:
            layouts.apply(doc, *args)
        assert e.value.code == code
    with pytest.raises(XdsError) as e:
        layouts.apply(doc, "s1", "quote", mode="merge")
    assert e.value.code == "BAD_MODE"


def test_cli_list_show_apply_and_init(blank, tmp_path, capsys):
    assert cli.main(["--json", "layout", "list"]) == 0
    items = json.loads(capsys.readouterr().out)["layouts"]
    assert any(i["id"] == "quote" for i in items)
    assert cli.main(["layout", "show", "quote"]) == 0
    assert "attribution" in capsys.readouterr().out

    ready(blank)
    assert cli.main(["--json", "layout", "apply", str(blank), "carousel-page", "--dry-run"]) == 0
    r = json.loads(capsys.readouterr().out)
    assert r["dryRun"] and not r["written"] and len(json.loads((blank / "project.json").read_text())["slides"][0]["nodes"]) == 1
    assert cli.main(["--json", "layout", "apply", str(blank), "carousel-page", "--mode", "new"]) == 0
    r = json.loads(capsys.readouterr().out)
    assert r["written"] and r["slide"] == "s2"
    assert proj.load(blank).ok
    assert cli.main(["layout", "apply", str(blank), "quote", "--slide", "s2", "--mode", "fill"]) == 0
    assert "filled" in capsys.readouterr().out

    # a role is missing: exit 2 with the roles to add; --add-roles needs a font
    bare = proj.init(tmp_path / "bare", name="Bare")
    code = cli.main(["--json", "layout", "apply", str(bare), "quote"])
    err = json.loads(capsys.readouterr().out)["error"]
    assert code == 1 and err["code"] == "MISSING_ROLES" and err["details"]["missingRoles"][0]["level"] == "expressive"

    # init --layout seeds the first slide (roles are added; the template has no font, so the role names a family to fetch)
    code = cli.main(["--json", "init", str(tmp_path / "seeded"), "--layout", "hero-left", "--format", "linkedin-landscape"])
    out = json.loads(capsys.readouterr().out)
    assert code == 0 and out["layout"]["slide"] == "s1" and set(out["layout"]["addedRoles"]) == {"caption", "headline", "subhead", "body"}
    doc = json.loads((tmp_path / "seeded" / "project.json").read_text())
    assert doc["slides"][0]["groups"]["intro"]["direction"] == "column"
    # a family from the font library is registered when there is one; else the roles name one to fetch
    assert {f.rule for f in proj.load(tmp_path / "seeded").findings} <= {"UNKNOWN_FONT"}
    if not doc["fonts"]:
        assert any("xds fonts fetch" in n for n in out["layout"]["notes"])


def test_api_routes(blank):
    ready(blank)
    with TestClient(create_app(blank, watch=False, serve_studio=False)) as c:
        r = c.get("/api/layouts").json()
        assert r["ok"] and any(l["id"] == "thumbnail" for l in r["layouts"])
        r = c.post("/api/layouts/apply", json={"id": "thumbnail", "slide": "s1", "mode": "replace"}).json()
        assert r["ok"] and r["report"]["written"] and "headline" in r["report"]["added"]
        assert c.post("/api/layouts/apply", json={"id": "nope"}).status_code == 404
