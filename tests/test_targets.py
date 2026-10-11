import json

import pytest

from xds import cli, project as proj, targets
from xds.api import STUDIO_DIST
from xds.project import XdsError

from .conftest import edit
from .test_variants import with_variants


def test_build_target_reflows_and_mirrors(blank):
    with_variants(blank)
    (blank / "assets").mkdir(exist_ok=True)
    (blank / "assets" / "logo.png").write_bytes(b"\x89PNG")
    t = targets.build(blank, "linkedin-landscape")
    troot = blank / "cache" / "targets" / "linkedin-landscape"
    assert t["root"] == str(troot) and t["orientation"] == "landscape"
    doc = json.loads((troot / "project.json").read_text())
    assert doc["format"] == {"preset": "linkedin-landscape", "width": 1200, "height": 627}
    assert doc["slides"][0]["nodes"][1]["variants"]["landscape"]["box"]["w"] == 30   # variants travel as-is
    assert (troot / "designs" / "solid.svg").is_file() and (troot / "fonts" / "Inter.woff2").is_file()
    assert (troot / "assets" / "logo.png").read_bytes() == b"\x89PNG"
    rec = targets.source_of(troot)
    assert rec["preset"] == "linkedin-landscape" and rec["sourceFormat"] == "instagram-portrait"
    assert rec["source"] == str(blank.resolve())
    # the target is a project of its own, valid, and shows the landscape variant
    loaded = proj.load(troot)
    assert loaded.ok, loaded.findings
    p = loaded.project
    assert p.orientation == "landscape" and p.effective_nodes(p.slides[0])[1].box.w == 30
    # the source is untouched
    assert json.loads((blank / "project.json").read_text())["format"]["preset"] == "instagram-portrait"
    # rebuilding refreshes the mirror (a stale file goes away)
    (troot / "assets" / "stale.png").write_bytes(b"x")
    targets.build(blank, "linkedin-landscape")
    assert not (troot / "assets" / "stale.png").exists()


def test_target_guards(blank):
    with pytest.raises(XdsError) as e:
        targets.build(blank, "instagram-portrait")
    assert e.value.code == "SAME_FORMAT"
    with pytest.raises(XdsError) as e:
        targets.build(blank, "nope")
    assert e.value.code == "UNKNOWN_FORMAT"
    t = targets.build(blank, "instagram-square")
    with pytest.raises(XdsError) as e:
        targets.build(t["root"], "instagram-story")
    assert e.value.code == "TARGET_OF_TARGET"


def test_source_hash_ignores_targets(blank):
    h = proj.source_hash(blank)
    targets.build(blank, "instagram-square")
    assert proj.source_hash(blank) == h


@pytest.mark.skipif(not (STUDIO_DIST / "index.html").exists(), reason="needs a built studio (npm run build)")
def test_export_target_lands_in_the_source(blank, capsys):
    with_variants(blank)
    code = cli.main(["--json", "export", str(blank), "--format", "instagram-square"])
    out = json.loads(capsys.readouterr().out)
    assert code == 0
    assert out["dir"].startswith(str(blank / "export")) and out["dir"].endswith("-instagram-square")
    assert out["record"]["format"] == "instagram-square" and out["record"]["sourceFormat"] == "instagram-portrait"


@pytest.mark.skipif(not (STUDIO_DIST / "index.html").exists(), reason="needs a built studio (npm run build)")
def test_fluidity_check(blank, capsys):
    with_variants(blank)
    code = cli.main(["--json", "reflow", str(blank), "--check", "--format", "instagram-square"])
    r = json.loads(capsys.readouterr().out)
    assert code in (0, 1)
    assert [t["preset"] for t in r["targets"]] == ["instagram-square"]
    assert r["orientation"] == "portrait" and {"errors", "warnings", "infos"} <= set(r["targets"][0])
