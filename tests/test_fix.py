"""`xds fix`: structured fixes applied to project.json (design-rules §6.1)."""

from __future__ import annotations

import json

from xds import cli, fix, project as proj, snapshots
from xds.models import AuditReport, AuditSummary, Edit, Finding

from .conftest import edit as edit_file


def finding(rule: str, severity: str, edits: list[Edit], *, nodes: list[str] | None = None,
            status: str = "open") -> Finding:
    return Finding(rule=rule, family="spacing", severity=severity, status=status, slide_id="s1",
                   nodes=nodes or [], message=f"{rule} fires", fix="…", edits=edits)


def project_with_text(root):
    (root / "fonts" / "Inter").mkdir(parents=True, exist_ok=True)
    (root / "fonts" / "Inter" / "Inter.woff2").write_bytes(b"")

    def fn(d):
        d["fonts"] = [{"family": "Inter", "path": "fonts/Inter/Inter.woff2", "weight": 400}]
        d["brand"]["typography"]["body"] = {"level": "body", "font": "Inter"}
        d["slides"][0]["nodes"].append({
            "id": "t1", "layer": "type", "box": {"x": 5, "y": 10, "w": 50, "h": 6},
            "layout": {"stack": {"below": "t0", "gap": 2}},
            "data": {"text": "Hi", "role": "body", "size": 30}})
    return edit_file(root, fn)


def test_apply_edit_node_slide_project_and_delete(blank):
    doc = project_with_text(blank)
    assert fix.apply_edit(doc, Edit(slide_id="s1", node_id="t1", path="box.y", value=12.5)) == (10, 12.5)
    assert fix.apply_edit(doc, Edit(slide_id="s1", node_id="t1", path="layout.stack.gap", value=3)) == (2, 3)
    assert fix.apply_edit(doc, Edit(slide_id="s1", node_id="t1", path="data.size")) == (30, None)
    assert "size" not in doc["slides"][0]["nodes"][-1]["data"]
    assert fix.apply_edit(doc, Edit(slide_id="s1", path="camera.height", value=48.0)) == (None, 48.0)
    assert doc["slides"][0]["camera"] == {"height": 48.0}
    assert fix.apply_edit(doc, Edit(slide_id="s1", path="lighting.brightness", value=-0.3)) == (None, -0.3)
    doc["screens"] = [{"id": "home", "path": "screens/home/index.html", "width": 390, "height": 844}]
    assert fix.apply_edit(doc, Edit(path="screens.0.scale", value=3)) == (None, 3)
    assert fix.apply_edit(doc, Edit(path="screens.4.scale", value=3)) is None
    assert fix.apply_edit(doc, Edit(slide_id="s1", node_id="gone", path="box.y", value=1)) is None
    assert fix.apply_edit(doc, Edit(slide_id="s9", path="camera.height", value=1)) is None


def test_select_filters(blank):
    report = AuditReport(source_hash="h", format="f", slides=["s1"], summary=AuditSummary(), findings=[
        finding("A", "error", [Edit(node_id="t1", path="box.y", value=1)]),
        finding("B", "warn", [Edit(node_id="t1", path="box.y", value=2)]),
        finding("C", "info", [Edit(node_id="t1", path="box.y", value=3)]),
        finding("D", "error", []),
        finding("E", "error", [Edit(node_id="t1", path="box.y", value=5)], status="waived"),
    ])
    assert [f.rule for f in fix.select(report)] == ["A", "B"]
    assert [f.rule for f in fix.select(report, severity="error")] == ["A"]
    assert [f.rule for f in fix.select(report, severity="info")] == ["A", "B", "C"]
    assert [f.rule for f in fix.select(report, rules=["B"])] == ["B"]
    assert fix.select(report, slide_ids=["s2"]) == []


def _cached_report(root, findings):
    loaded = proj.load(root)
    assert loaded.ok, loaded.findings
    report = AuditReport(source_hash=loaded.hash, format="instagram-portrait", slides=["s1"],
                         summary=AuditSummary(), findings=findings)
    cache = root / "cache" / loaded.hash
    cache.mkdir(parents=True)
    (cache / "audit.json").write_text(report.model_dump_json(by_alias=True, exclude_none=True))


def test_run_applies_and_skips(blank, capsys):
    project_with_text(blank)
    _cached_report(blank, [
        finding("SPACING_OFF_SCALE", "info", [Edit(slide_id="s1", node_id="t1", path="layout.stack.gap", value=3)]),
        finding("TEXT_TOO_SMALL", "error", [Edit(slide_id="s1", node_id="t1", path="data.size", value=33.0)]),
        finding("ALIGN_NEAR_MISS", "warn", [Edit(slide_id="s1", node_id="gone", path="box.x", value=7)]),
    ])
    r = fix.run(blank, dry_run=True)
    assert r["dryRun"] and not r["written"] and [a["path"] for a in r["applied"]] == ["data.size"]
    assert r["skipped"][0]["why"] == "the node is gone"
    assert json.loads((blank / "project.json").read_text())["slides"][0]["nodes"][-1]["data"]["size"] == 30

    r = fix.run(blank, severity="info")
    assert r["written"] and [a["path"] for a in r["applied"]] == ["layout.stack.gap", "data.size"]
    node = json.loads((blank / "project.json").read_text())["slides"][0]["nodes"][-1]
    assert node["data"]["size"] == 33.0 and node["layout"]["stack"]["gap"] == 3
    assert "written" in fix.text(r) and "skipped: the node is gone" in fix.text(r)

    # the file changed, so the report is stale: the next fix audits again (no browser here → error)
    code = cli.main(["--json", "fix", str(blank), "--rule", "NOPE"])
    assert code in (1, 2)
    capsys.readouterr()


def test_run_snapshots_a_big_fix(blank):
    project_with_text(blank)
    doc = json.loads((blank / "project.json").read_text())
    edits = [Edit(slide_id="s1", node_id=n["id"], path="box.y", value=20.0) for n in doc["slides"][0]["nodes"]]
    _cached_report(blank, [finding("MARGIN_NEAR_MISS", "info", edits)])
    r = fix.run(blank, severity="info")
    assert r["written"] and len(r["applied"]) == 2
    kept = snapshots.list_snapshots(blank)
    assert len(kept) == 1 and kept[0]["reason"].startswith("auto: ")


def test_cli_dry_run_text(blank, capsys):
    project_with_text(blank)
    _cached_report(blank, [finding("TEXT_TOO_SMALL", "error", [Edit(slide_id="s1", node_id="t1", path="data.size", value=33.0)])])
    code = cli.main(["fix", str(blank), "--dry-run"])
    out = capsys.readouterr().out
    assert code == 0 and "TEXT_TOO_SMALL" in out and "30 → 33.0" in out and "dry run" in out
    code = cli.main(["--json", "fix", str(blank), "--severity", "error"])
    r = json.loads(capsys.readouterr().out)
    assert code == 0 and r["written"] and r["applied"][0]["new"] == 33.0
