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
    assert len(p.slides) == 1 and p.slides[0].nodes == []
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
        d["slides"][0]["background"] = "missing"
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
