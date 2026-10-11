import json

from fastapi.testclient import TestClient

from xds import cli, project as proj, snapshots
from xds.api import create_app

from .conftest import edit


def node(i: int) -> dict:
    return {"id": f"t{i}", "layer": "type", "box": {"x": 5, "y": 5 + i * 8, "w": 50, "h": 6},
            "data": {"text": f"Line {i}", "role": "body"}}


def with_nodes(root, n: int) -> dict:
    def fn(d):
        d["brand"]["typography"]["body"] = {"level": "body", "font": "Inter"}
        d["slides"][0]["nodes"] += [node(i) for i in range(n)]
    return edit(root, fn)


def test_big_change_reasons():
    base = {"format": {"preset": "a"}, "slides": [{"id": "s1", "nodes": [node(i) for i in range(8)]}]}
    assert snapshots.big_change(base, base) is None
    assert snapshots.big_change(base, {**base, "format": {"preset": "b"}}) == "format changed"
    assert snapshots.big_change(base, {**base, "slides": base["slides"] + [{"id": "s2"}]}) == "1 slide added"
    assert snapshots.big_change(base, {**base, "slides": []}) == "1 slide removed"
    one = json.loads(json.dumps(base))
    one["slides"][0]["nodes"][0]["data"]["text"] = "edited"
    assert snapshots.big_change(base, one) is None            # 1 of 8: an ordinary edit
    many = json.loads(json.dumps(base))
    for n in many["slides"][0]["nodes"][:3]:
        n["data"]["text"] = "edited"
    assert snapshots.big_change(base, many) == "3 nodes changed"
    grown = json.loads(json.dumps(base))
    grown["slides"][0]["nodes"] += [node(8), node(9), node(10)]
    del grown["slides"][0]["nodes"][0]
    assert snapshots.big_change(base, grown) == "3 nodes added, 1 node removed"
    assert snapshots.big_change(None, base) is None


def test_take_list_restore_delete(blank):
    doc = with_nodes(blank, 4)
    rec = snapshots.take(blank, label="First cut")
    assert rec["id"].endswith("-first-cut") and rec["label"] == "First cut" and rec["reason"] == "manual"
    assert rec["summary"] == {"name": "Test", "schemaVersion": 3, "format": doc["format"], "slides": 1, "nodes": 5}
    assert (blank / ".snapshots" / rec["id"] / "project.json").is_file()
    assert (blank / ".snapshots" / rec["id"] / "designs" / "solid.svg").is_file()
    assert proj.source_hash(blank) == proj.source_hash(blank)   # .snapshots is not a source dir

    edit(blank, lambda d: d.update(name="Renamed"))
    (blank / "designs" / "solid.svg").write_text((blank / "designs" / "solid.svg").read_text() + "\n<!-- x -->")
    r = snapshots.restore(blank, rec["id"])
    assert json.loads((blank / "project.json").read_text())["name"] == "Test"
    assert "<!-- x -->" not in (blank / "designs" / "solid.svg").read_text()
    assert r["safety"]["reason"] == f"before restore of {rec['id']}" and r["files"] >= 2
    listed = snapshots.list_snapshots(blank)
    assert [x["id"] for x in listed] == [r["safety"]["id"], rec["id"]]   # newest first
    assert json.loads((blank / "project.json").read_text())["name"] == "Test"
    snapshots.restore(blank, r["safety"]["id"])
    assert json.loads((blank / "project.json").read_text())["name"] == "Renamed"

    snapshots.delete(blank, rec["id"])
    assert rec["id"] not in [x["id"] for x in snapshots.list_snapshots(blank)]


def test_unknown_snapshot(blank):
    try:
        snapshots.restore(blank, "../../etc")
    except proj.XdsError as e:
        assert e.code == "UNKNOWN_SNAPSHOT"
    else:
        raise AssertionError


def test_big_save_snapshots_first(blank):
    with_nodes(blank, 4)
    loaded = proj.load(blank)
    doc = loaded.raw
    doc["name"] = "small edit"
    r = proj.save(blank, doc, loaded.file_hash)
    assert "snapshot" not in r and snapshots.list_snapshots(blank) == []
    doc["format"] = {"preset": "instagram-square", "width": 1080, "height": 1080}
    r = proj.save(blank, doc, r["fileHash"])
    assert r["snapshot"]["reason"] == "auto: format changed"
    kept = snapshots.list_snapshots(blank)
    assert len(kept) == 1 and kept[0]["summary"]["format"]["preset"] == "instagram-portrait"   # the state before


def test_prune_keeps_labelled_and_manual(blank, monkeypatch):
    ids = []
    for i in range(4):
        rec = snapshots.take(blank, reason="auto: test")
        (blank / ".snapshots" / rec["id"] / "snapshot.json").write_text(
            json.dumps({**rec, "createdAt": f"2026-01-0{i + 1}T00:00:00"}))
        ids.append(rec["id"])
    manual = snapshots.take(blank)
    labelled = snapshots.take(blank, label="keep", reason="auto: test")
    gone = snapshots.prune(blank, keep=2)
    assert sorted(gone) == sorted(ids[:2])
    left = {x["id"] for x in snapshots.list_snapshots(blank)}
    assert manual["id"] in left and labelled["id"] in left and set(ids[2:]) <= left


def test_migrate_backups_are_listed(blank):
    d = blank / ".migrate-backup" / "20260101-120000"
    d.mkdir(parents=True)
    (d / "project.json").write_text((blank / "project.json").read_text())
    items = snapshots.list_snapshots(blank)
    assert items[0]["id"] == "20260101-120000" and items[0]["reason"] == "migrate" and items[0]["migrateBackup"]
    assert items[0]["createdAt"] == "2026-01-01T12:00:00"
    try:
        snapshots.delete(blank, "20260101-120000")
    except proj.XdsError as e:
        assert e.code == "MIGRATE_BACKUP"
    else:
        raise AssertionError


def test_cli_and_api(blank, capsys):
    code = cli.main(["--json", "snapshot", str(blank), "--label", "Cut one"])
    rec = json.loads(capsys.readouterr().out)["snapshot"]
    assert code == 0 and rec["label"] == "Cut one"
    code = cli.main(["snapshot", str(blank), "--list"])
    assert code == 0 and "Cut one" in capsys.readouterr().out
    code = cli.main(["--json", "restore", str(blank), rec["id"]])
    assert code == 0 and json.loads(capsys.readouterr().out)["restored"]["id"] == rec["id"]
    code = cli.main(["--json", "snapshot", str(blank), "--delete", rec["id"]])
    assert code == 0

    with TestClient(create_app(blank, watch=False, serve_studio=False)) as c:
        r = c.post("/api/snapshots", json={"label": "api"}).json()
        assert r["ok"] and r["snapshot"]["label"] == "api"
        sid = r["snapshot"]["id"]
        assert sid in [x["id"] for x in c.get("/api/snapshots").json()["snapshots"]]
        r = c.post("/api/snapshots/restore", json={"id": sid}).json()
        assert r["ok"] and r["restored"]["id"] == sid and r["safety"]["id"]
        assert c.delete(f"/api/snapshots/{sid}").json() == {"ok": True, "deleted": sid}
        assert c.post("/api/snapshots/restore", json={"id": "nope"}).status_code == 404
