import json

import pytest

from xds import project as proj
from xds.models import Project
from xds.project import XdsError

from .conftest import edit


def codes(loaded):
    return sorted({f.rule for f in loaded.findings})


def test_init_is_valid_and_content_neutral(blank):
    loaded = proj.load(blank)
    assert loaded.ok, loaded.findings
    p = loaded.project
    assert len(p.slides) == 1 and [n.data.design for n in p.slides[0].nodes] == ["solid"]
    assert (blank / "designs" / "solid.svg").exists()
    assert p.objects == [] and p.brand.typography == {}
    assert (blank / "AGENTS.md").exists()


def test_hash_changes_with_any_source_file(blank):
    h1 = proj.source_hash(blank)
    (blank / "cache").mkdir()
    (blank / "cache" / "x").write_text("derived")
    (blank / "sources").mkdir(exist_ok=True)
    (blank / "sources" / "a.blend").write_text("ignored")
    assert proj.source_hash(blank) == h1
    (blank / "assets" / "a.png").write_bytes(b"x")
    assert proj.source_hash(blank) != h1


def test_unknown_fields_are_rejected(blank):
    edit(blank, lambda d: d.update(canvas={"width": 1}))
    loaded = proj.load(blank)
    assert not loaded.ok and codes(loaded) == ["SCHEMA_INVALID"]
    assert loaded.findings[0].path == "canvas"


def test_old_schema_version_needs_migration(blank):
    edit(blank, lambda d: d.update(schemaVersion="1.0"))
    assert codes(proj.load(blank)) == ["MIGRATION_NEEDED"]


def test_reference_checks(blank):
    def add(d):
        d["brand"]["typography"]["headline"] = {"level": "headline", "font": "Nope"}
        d["brand"]["colors"][0]["name"] = "paper2"   # the template's background now names no token
        d["slides"][0]["nodes"] = [
            {"id": "t", "name": "T", "layer": "type", "box": {"x": 0, "y": 0, "w": 10, "h": 10},
             "data": {"text": "Hi", "role": "kicker", "color": "red"}},
            {"id": "i", "name": "I", "layer": "image", "box": {"x": 0, "y": 0, "w": 10, "h": 10},
             "data": {"asset": "nope"}},
            {"id": "g", "name": "G", "layer": "ground", "box": {"x": 0, "y": 0, "w": 100, "h": 100},
             "data": {"design": "nope"}},
            {"id": "r", "name": "R", "layer": "render", "data": {"object": "nope"}},
        ]
        d["assets"] = [{"id": "esc", "path": "../x.png", "kind": "image"}]
    edit(blank, add)
    assert set(codes(proj.load(blank))) >= {
        "UNKNOWN_FONT", "UNKNOWN_COLOR", "UNKNOWN_ROLE", "UNKNOWN_ASSET", "UNKNOWN_DESIGN",
        "UNKNOWN_OBJECT", "PATH_ESCAPE"}


def test_structural_rules_cannot_be_waived(blank):
    edit(blank, lambda d: d["slides"][0].update(exceptions=[{"rule": "UNKNOWN_ROLE", "reason": "x"}]))
    assert "NOT_WAIVABLE" in codes(proj.load(blank))


def test_save_round_trip_and_conflict(blank):
    loaded = proj.load(blank)
    doc = loaded.raw
    doc["name"] = "Renamed"
    result = proj.save(blank, doc, loaded.file_hash)
    saved = json.loads((blank / "project.json").read_text())
    assert saved["name"] == "Renamed"
    assert list(saved)[:4] == ["schemaVersion", "id", "name", "description"]
    assert result["fileHash"] == proj.project_file_hash(blank)
    with pytest.raises(XdsError) as e:
        proj.save(blank, doc, loaded.file_hash)  # stale baseHash
    assert e.value.status == 409 and e.value.code == "SAVE_CONFLICT"


def test_save_rejects_invalid_without_touching_the_file(blank):
    before = (blank / "project.json").read_text()
    doc = json.loads(before)
    doc["slides"] = []
    with pytest.raises(XdsError) as e:
        proj.save(blank, doc, None)
    assert e.value.status == 422
    assert (blank / "project.json").read_text() == before
    assert not (blank / "project.json.tmp").exists()


def test_save_keeps_agent_only_fields(blank):
    def add(d):
        d["assets"] = []
        d["objects"] = [{"id": "box", "name": "Box", "kind": "box", "pose": {}}]
        d["slides"][0]["nodes"] = [{"id": "r", "name": "R", "layer": "render",
                                     "data": {"object": "box", "screens": {"Screen": "x"}}}]
    doc = edit(blank, add)
    p = Project.model_validate(doc)
    assert p.to_json()["slides"][0]["nodes"][0]["data"]["screens"] == {"Screen": "x"}


def test_paths_stay_inside(blank):
    for bad in ["../x", "/etc/passwd", "assets/../../x"]:
        with pytest.raises(XdsError):
            proj.resolve_inside(blank, bad)
    assert proj.resolve_inside(blank, "assets/x.png") == (blank / "assets" / "x.png").resolve()


def test_project_agents_md_is_self_contained(blank):
    """Agents in a project read only its AGENTS.md and xds output, never the repo's docs."""
    text = (blank / "AGENTS.md").read_text()
    assert "docs/" not in text and ".md)" not in text and "uv run" not in text
    for must in ("xds guide", "xds model library", "xds screen add", "xds fonts fetch",
                 "data-xds-repeat", "\"mode\": \"frame\""):
        assert must in text, must
    assert not (blank / "fonts").exists()  # fonts come from the xds font library


def test_init_with_a_custom_size(tmp_path):
    root = proj.init(tmp_path / "deck", name="Deck", size=(1440, 1080))
    fmt = json.loads((root / "project.json").read_text())["format"]
    assert fmt == {"width": 1440, "height": 1080} and proj.load(root).ok


def _text(id, **data):
    return {"id": id, "name": id, "layer": "type", "box": {"x": 5, "y": 0, "w": 50, "h": 10},
            "data": {"text": id, "role": "body", **data}}


def test_stack_anchors_and_cycles(blank):
    def add(d, nodes):
        d["brand"]["typography"]["body"] = {"level": "body", "font": "Satoshi"}
        d["fonts"] = [{"family": "Satoshi", "path": "xds:fonts/Satoshi/x.woff2"}]
        d["slides"][0]["nodes"] = d["slides"][0]["nodes"][:1] + nodes

    edit(blank, lambda d: add(d, [_text("h1"), _text("sub", stack={"below": "h1", "gap": 3}),
                                  _text("kicker", stack={"above": "h1"})]))
    assert {"STACK_ANCHOR", "STACK_CYCLE"}.isdisjoint(codes(proj.load(blank)))

    edit(blank, lambda d: add(d, [_text("a", stack={"below": "gone"}),
                                  _text("b", stack={"below": "s1-background"}),
                                  _text("c", stack={"below": "c"})]))
    found = [f for f in proj.load(blank).findings if f.rule == "STACK_ANCHOR"]
    assert sorted(f.nodes[0] for f in found) == ["a", "b", "c"]
    assert "is not on this slide" in found[0].message and found[0].path.endswith("data.stack.below")

    edit(blank, lambda d: add(d, [_text("p", stack={"below": "q"}), _text("q", stack={"below": "r"}),
                                  _text("r", stack={"below": "p"})]))
    cycles = [f for f in proj.load(blank).findings if f.rule == "STACK_CYCLE"]
    assert len(cycles) == 1 and "p → q → r → p" in cycles[0].message


def test_a_stack_names_exactly_one_anchor(blank):
    edit(blank, lambda d: d["slides"][0]["nodes"].append(_text("x", stack={"below": "a", "above": "b"})))
    assert "SCHEMA_INVALID" in codes(proj.load(blank))
