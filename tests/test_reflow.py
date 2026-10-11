import json

from fastapi.testclient import TestClient

from xds import cli, formats, project as proj, reflow, snapshots
from xds.api import create_app
from xds.models import Format

from .conftest import edit

PORTRAIT = Format(preset="instagram-portrait", width=1080, height=1350)
LANDSCAPE = Format(preset="linkedin-landscape", width=1200, height=627)


def setup(root):
    """A portrait post: a headline on the top-left margin, a square logo, a scaled body, a stack."""
    g = formats.derive(PORTRAIT)
    mx, my = 100 * g.m / 1080, 100 * g.m / 1350

    def fn(d):
        d["brand"]["typography"] = {
            "headline": {"level": "headline", "font": "Inter", "size": 70},
            "body": {"level": "body", "font": "Inter", "scale": 1.1},
        }
        d["assets"] = [{"id": "logo", "path": "assets/logo.png", "kind": "image"}]
        d["slides"][0]["nodes"] += [
            {"id": "h1", "layer": "type", "box": {"x": mx, "y": my, "w": 60, "h": 10},
             "data": {"text": "Hi", "role": "headline", "size": 84}},
            {"id": "sub", "layer": "type", "box": {"x": mx, "y": my + 12, "w": 60, "h": 6},
             "data": {"text": "Sub", "role": "body", "scale": 0.9, "stack": {"below": "h1", "gap": 3}}},
            {"id": "logo", "layer": "image", "box": {"x": mx, "y": 80, "w": 20, "h": 16},
             "data": {"asset": "logo", "fit": "contain"}},
        ]
    (root / "assets").mkdir(exist_ok=True)
    (root / "assets" / "logo.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    return edit(root, fn)


def node(doc, nid):
    return next(n for n in doc["slides"][0]["nodes"] if n["id"] == nid)


def test_reflow_keeps_the_margin_aspect_and_relative_sizes(blank):
    doc = setup(blank)
    new, report = reflow.reflow(doc, LANDSCAPE)
    assert doc["format"]["preset"] == "instagram-portrait"          # the input is untouched
    assert new["format"] == {"preset": "linkedin-landscape", "width": 1200, "height": 627}
    g = formats.derive(LANDSCAPE)
    h1 = node(new, "h1")["box"]
    assert abs(h1["x"] * 1200 / 100 - g.m) < 0.05 and abs(h1["y"] * 627 / 100 - g.m) < 0.05   # still on the margin
    # the logo was 216×216 px: it stays square
    logo = node(new, "logo")["box"]
    assert abs(logo["w"] * 1200 - logo["h"] * 627) < 1
    # px sizes follow the band ratio, scales and gaps do not move
    ratio = g.bands["headline"].default / formats.derive(PORTRAIT).bands["headline"].default
    assert node(new, "h1")["data"]["size"] == round(84 * ratio)
    assert new["brand"]["typography"]["headline"]["size"] == round(70 * ratio)
    assert new["brand"]["typography"]["body"] == {"level": "body", "font": "Inter", "scale": 1.1}
    assert node(new, "sub")["data"]["scale"] == 0.9 and node(new, "sub")["data"]["stack"]["gap"] == 3
    # the full-canvas background stays full
    back = next(n for n in new["slides"][0]["nodes"] if n["layer"] == "ground")
    assert {k: back["box"][k] for k in ("x", "y", "w", "h")} == {"x": 0, "y": 0, "w": 100, "h": 100}
    assert report["summary"]["boxes"] == 3 and report["summary"]["sizes"] == 1 and report["summary"]["roles"] == 1


def test_reflow_round_trip_is_near_identity_for_text(blank):
    """Text boxes come back where they were; an image's box shrinks to its aspect on the way
    (contain), so only its aspect is promised."""
    doc = setup(blank)
    there, _ = reflow.reflow(doc, LANDSCAPE)
    back, _ = reflow.reflow(there, PORTRAIT)
    logo = node(back, "logo")["box"]
    assert abs(logo["w"] * 1080 - logo["h"] * 1350) < 2   # 0.001 % rounding ≈ 1 px
    for nid in ("h1", "sub"):
        a, b = node(doc, nid)["box"], node(back, nid)["box"]
        for k in ("x", "y", "w", "h"):
            assert abs(a[k] - b[k]) < 0.05, (nid, k, a, b)


def test_cli_dry_run_then_write_snapshots_first(blank, capsys):
    setup(blank)
    code = cli.main(["--json", "reflow", str(blank), "--format", "linkedin-landscape", "--dry-run"])
    r = json.loads(capsys.readouterr().out)
    assert code == 0 and r["dryRun"] and not r["written"]
    assert proj.read_raw(blank)["format"]["preset"] == "instagram-portrait"
    code = cli.main(["reflow", str(blank), "--size", "1600x900"])
    text = capsys.readouterr().out
    assert code == 0 and "written, run the audit" in text
    assert proj.read_raw(blank)["format"] == {"width": 1600, "height": 900}
    snaps = snapshots.list_snapshots(blank)
    assert len(snaps) == 1 and snaps[0]["reason"] == "auto: format changed"
    assert cli.main(["--json", "reflow", str(blank)]) == 2


def test_api_reflow_is_pure(blank):
    doc = setup(blank)
    with TestClient(create_app(blank, watch=False, serve_studio=False)) as c:
        r = c.post("/api/reflow", json={"project": doc, "format": {"preset": "instagram-square", "width": 1080, "height": 1080}})
        assert r.status_code == 200
        body = r.json()
        assert body["project"]["format"]["preset"] == "instagram-square" and body["report"]["summary"]["boxes"] == 3
        assert proj.read_raw(blank)["format"]["preset"] == "instagram-portrait"
        assert c.post("/api/reflow", json={"project": doc}).status_code == 422
