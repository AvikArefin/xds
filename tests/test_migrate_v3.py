"""v2 → v3: the page color goes; the ground layer paints the canvas."""

import json

from xds import migrate
from xds import project as proj


def _v2(root, slides, designs=None):
    doc = json.loads((root / "project.json").read_text())
    doc["schemaVersion"] = 2
    doc["brand"]["colors"].append({"name": "night", "hex": "#101010"})
    doc["slides"] = slides
    (root / "project.json").write_text(json.dumps(doc))
    for p in (root / "designs").glob("*.svg"):
        p.unlink()
    for name, text in (designs or {}).items():
        (root / "designs" / f"{name}.svg").write_text(text)


FULL = {"x": 0, "y": 0, "w": 100, "h": 100}


def test_covered_slides_drop_the_color_others_get_a_solid(blank):
    sweep = (proj.RESOURCES / "designs" / "sweep.svg").read_text()
    _v2(blank, [
        {"id": "a", "background": "night", "nodes": [
            {"id": "g", "name": "G", "layer": "ground", "box": FULL, "data": {"design": "sweep"}}]},
        {"id": "b", "background": "night", "nodes": [
            {"id": "half", "name": "H", "layer": "ground", "box": {**FULL, "h": 50},
             "data": {"design": "sweep"}}]},
        {"id": "c", "background": "paper", "nodes": [
            {"id": "tilted", "name": "T", "layer": "ground", "box": {**FULL, "rotation": 5},
             "data": {"design": "sweep"}}]},
    ], {"sweep": sweep})
    rep = migrate.run(blank)
    assert rep["ok"] and rep["steps"] == ["m0003_ground_paints_canvas"] and rep["toVersion"] == 3
    assert rep["files"] == ["designs/solid.svg"] and (blank / "designs" / "solid.svg").exists()
    loaded = proj.load(blank)
    assert loaded.ok, [f.message for f in loaded.findings]
    a, b, c = loaded.project.slides
    assert [n.id for n in a.nodes] == ["g"]
    assert [n.id for n in b.nodes] == ["b-background", "half"]  # at the back
    assert (b.nodes[0].data.design, b.nodes[0].data.values) == ("solid", {"color": "night"})
    assert c.nodes[0].data.values == {"color": "paper"}
    assert "background" not in json.loads((blank / "project.json").read_text())["slides"][0]


def test_reuses_an_existing_solid_and_avoids_id_clashes(blank):
    solid = (proj.RESOURCES / "designs" / "solid.svg").read_text()
    _v2(blank, [{"id": "a", "background": "night", "nodes": [
        {"id": "a-background", "name": "X", "layer": "image", "box": FULL, "data": {"asset": "x"}}]}],
        {"solid": solid})
    doc = json.loads((blank / "project.json").read_text())
    doc["assets"] = [{"id": "x", "path": "assets/x.png", "kind": "image"}]
    (blank / "assets" / "x.png").write_bytes(b"png")
    (blank / "project.json").write_text(json.dumps(doc))
    rep = migrate.run(blank)
    assert rep["ok"] and rep["files"] == []  # the project's own solid.svg fits
    nodes = proj.load(blank).project.slides[0].nodes
    assert [n.id for n in nodes] == ["a-background-2", "a-background"]


def test_uncovered_canvas_is_an_audit_error(tmp_path):
    from xds.audit import engine

    from .test_audit_kit import Case, rules_of

    c = Case(tmp_path)
    cache = c.write()
    covered = c.project()
    assert "UNCOVERED_CANVAS" not in rules_of(engine.run(covered, cache, "h"))
    bare = c.project()
    bare.slides[0].nodes = [n for n in bare.slides[0].nodes if n.layer != "ground"]
    found = rules_of(engine.run(bare, cache, "h"))["UNCOVERED_CANVAS"]
    assert found[0].severity == "error"


def test_migration_refreshes_agents_md(blank):
    _v2(blank, [{"id": "a", "background": "night", "nodes": []}])
    (blank / "AGENTS.md").write_text("# the v2 guide")
    rep = migrate.run(blank)
    bdir = (blank / rep["backup"]).parent
    assert (bdir / "AGENTS.md").read_text() == "# the v2 guide"
    assert (blank / "AGENTS.md").read_text() == (proj.RESOURCES / "template" / "AGENTS.md").read_text()
    assert migrate.run(blank)["changed"] is False  # nothing left to do
