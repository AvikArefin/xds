import json

from pydantic import AliasChoices, Field

from xds import migrate
from xds import project as proj
from xds.migrate import conform as conform_mod
from xds.migrate.steps import registry
from xds.models import Model

from .conftest import edit


def test_canonical_project_is_unchanged(blank):
    before = (blank / "project.json").read_text()
    rep = migrate.run(blank)
    assert rep["ok"] and not rep["changed"] and not rep["written"] and rep["backup"] is None
    assert (blank / "project.json").read_text() == before


def test_conform_renames_fills_and_drops(blank):
    def mess(d):
        d["layer_order"] = d.pop("layerOrder")
        d["legacy"] = {"a": 1}
        d["slides"][0]["camera"] = {"x": 30}
        d["slides"][0]["nodes"].append({"id": "g", "layer": "ground",
                                        "box": {"x": 0, "y": 0, "w": 100, "h": 100, "skew": 3},
                                        "data": {"design": "sweep"}})
    edit(blank, mess)
    rep = migrate.run(blank)
    assert rep["ok"] and rep["written"]
    assert {"from": "layer_order", "to": "layerOrder"} in rep["renamed"]
    assert {"path": "legacy", "value": {"a": 1}} in rep["dropped"]
    assert {"path": "slides[0].nodes[0].box.skew", "value": 3} in rep["dropped"]
    assert {"path": "slides[0].camera.mode", "value": "frame"} in rep["defaulted"]
    assert "-  \"legacy\"" in rep["diff"] or "legacy" in rep["diff"]
    backup = blank / rep["backup"]
    assert "legacy" in backup.read_text()
    doc = json.loads((blank / "project.json").read_text())
    assert doc["slides"][0]["camera"]["mode"] == "frame" and "legacy" not in doc
    proj.Project.model_validate(doc)


def test_dry_run_writes_nothing(blank):
    edit(blank, lambda d: d.update(junk=True))
    before = (blank / "project.json").read_text()
    rep = migrate.run(blank, dry_run=True)
    assert rep["changed"] and not rep["written"] and "junk" in rep["diff"]
    assert (blank / "project.json").read_text() == before
    assert not (blank / ".migrate-backup").exists()


def test_unresolved_is_not_written(blank):
    edit(blank, lambda d: (d.pop("name"), d["slides"][0].update(background=42)))
    before = (blank / "project.json").read_text()
    rep = migrate.run(blank)
    assert not rep["ok"] and not rep["written"]
    paths = {u["path"] for u in rep["unresolved"]}
    assert "name" in paths and "slides[0].background" in paths
    assert all(u["rule"] == "MIGRATION_UNRESOLVED" for u in rep["unresolved"])
    assert (blank / "project.json").read_text() == before


def test_v1_has_no_step_yet(blank):
    edit(blank, lambda d: d.update(schemaVersion=1))
    rep = migrate.run(blank)
    assert not rep["ok"] and "no migration step" in rep["unresolved"][0]["message"]
    assert registry() == {}
    rep = migrate.run(blank, conform_only=True)
    assert not rep["ok"]


def test_steps_are_applied_in_order(blank, monkeypatch):
    def step(doc, report):
        report.notes.append("renamed title → name")
        doc["name"] = doc.pop("title")
        return doc

    monkeypatch.setattr(migrate, "registry", lambda: {2: ("m0002_test", step)})
    edit(blank, lambda d: (d.update(schemaVersion=1, title=d.pop("name"))))
    rep = migrate.run(blank)
    assert rep["ok"] and rep["steps"] == ["m0002_test"] and rep["fromVersion"] == 1
    assert json.loads((blank / "project.json").read_text())["schemaVersion"] == 2


def test_alias_choices_rename():
    class Thing(Model):
        box: int = Field(validation_alias=AliasChoices("box", "transform"))
        label: str = "x"

    report = conform_mod.Report()
    out = conform_mod.conform_model({"transform": 3, "extra": 1}, Thing, "t", report)
    assert out == {"box": 3, "label": "x"}
    assert report.renamed == [{"from": "t.transform", "to": "t.box"}]
    assert report.dropped == [{"path": "t.extra", "value": 1}]


def test_run_all(tmp_path):
    a = proj.init(tmp_path / "a", name="A")
    proj.init(tmp_path / "b", name="B")
    (tmp_path / "not-a-project").mkdir()
    edit(a, lambda d: d.update(junk=1))
    reports = migrate.run_all(tmp_path, dry_run=True)
    assert [r["changed"] for r in reports] == [True, False]
