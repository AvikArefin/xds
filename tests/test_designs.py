import json
import math
from pathlib import Path

import pytest

from .conftest import edit
from xds import designs
from xds import project as proj

FIXTURE = Path(__file__).parent / "fixtures" / "design-expressions.json"


def _fixture_scope(extra: dict) -> dict:
    ctx = json.loads(FIXTURE.read_text())["context"]
    scope = {"width": ctx["width"], "height": ctx["height"]}
    scope |= {f"subject.{k}": v for k, v in ctx["subject"].items()}
    scope |= {f"brand.{k}": v for k, v in ctx["brand"].items()}
    return scope | ctx["params"] | extra


CASES = json.loads(FIXTURE.read_text())["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["expr"] or "<empty>" for c in CASES])
def test_shared_expression_cases(case):
    scope = _fixture_scope(case.get("names", {}))
    problem = designs.check_expression(case["expr"], set(scope))
    assert (problem is None) == case["ok"], problem
    if not case["ok"]:
        want = {"syntax": "DESIGN_BAD_EXPRESSION", "name": "DESIGN_UNKNOWN_PARAM"}[case["error"]]
        assert problem[0] == want, problem
    if "value" in case:
        got = designs.evaluate(case["expr"], scope)
        if isinstance(case["value"], (int, float)) and not isinstance(case["value"], bool):
            assert not isinstance(got, bool) and math.isclose(got, case["value"], abs_tol=1e-9)
        else:
            assert got == case["value"]


def test_fixture_is_documented():
    doc = json.loads(FIXTURE.read_text())
    assert doc["_doc"] and doc["context"] and len(doc["cases"]) > 50


@pytest.mark.parametrize("name", designs.starters())
def test_starters_pass_the_checker(name):
    d = designs.parse_design(name, (designs.STARTERS_DIR / f"{name}.svg").read_text())
    assert d.error is None
    assert designs.manifest_findings(d, set()) == []
    assert 1 <= len(d.manifest.variants or []) <= 3
    assert 'viewBox="0 0 {{width}} {{height}}"' in d.svg
    # every variant resolves to well-formed SVG
    for v in [None] + [v.name for v in d.manifest.variants]:
        scope = designs.default_context(1080, 1350) | designs.effective_values(d.manifest, v)
        out = designs.resolve(d.svg, scope)
        assert "{{" not in out and 'viewBox="0 0 1080 1350"' in out


def test_seven_starters():
    assert designs.starters() == sorted(
        ["solid", "sweep", "spotlight", "aurora", "grain-solid", "split-tone", "vignette-dark"])


def test_repeat_expands_with_loop_variables():
    svg = ('<svg xmlns="http://www.w3.org/2000/svg"><metadata id="xds-design">'
           '{"params":[{"name":"k","type":"number","default":3}]}</metadata>'
           '<g><circle data-xds-repeat="i" data-xds-count="{{k}}" cx="{{i * 10}}" r="{{n}}"/></g></svg>')
    d = designs.parse_design("x", svg)
    assert designs.manifest_findings(d, set()) == []
    out = designs.resolve(svg, designs.default_context(100, 100) | {"k": 3})
    assert out.count("<circle") == 3 and 'cx="20"' in out and 'r="3"' in out
    assert "data-xds" not in out


def test_loop_variable_outside_loop_is_unknown():
    svg = ('<svg xmlns="http://www.w3.org/2000/svg"><rect x="{{i}}"/>'
           '<g data-xds-repeat="i" data-xds-count="{{3}}"><rect x="{{i}}"/></g></svg>')
    codes = [c for c, _ in designs.manifest_findings(designs.parse_design("x", svg), set())]
    assert codes == ["DESIGN_UNKNOWN_PARAM"]


def test_bad_manifest_and_loop_syntax():
    bad_json = '<svg xmlns="http://www.w3.org/2000/svg"><metadata id="xds-design">{nope</metadata></svg>'
    assert designs.parse_design("x", bad_json).error
    dupes = ('<svg xmlns="http://www.w3.org/2000/svg"><metadata id="xds-design">'
             '{"params":[{"name":"a","type":"number","default":1},'
             '{"name":"a","type":"number","default":2}]}</metadata></svg>')
    assert "duplicate" in designs.parse_design("x", dupes).error
    loop = '<svg xmlns="http://www.w3.org/2000/svg"><g data-xds-repeat="width" data-xds-count="2"/></svg>'
    codes = [c for c, _ in designs.manifest_findings(designs.parse_design("x", loop), set())]
    assert codes.count("DESIGN_BAD_EXPRESSION") == 2


def test_value_problems():
    p = designs.DesignParam(name="g", type="number", default=0.5, min=0, max=1)
    assert designs.value_problem(p, 0.2, set()) is None
    assert "above" in designs.value_problem(p, 2, set())
    assert designs.value_problem(p, True, set())
    c = designs.DesignParam(name="c", type="color", default="#ffffff")
    assert designs.value_problem(c, "paper", {"paper"}) is None
    assert designs.value_problem(c, "nope", {"paper"})
    s = designs.DesignParam(name="s", type="select", default="a", options=["a", "b"])
    assert designs.value_problem(s, "c", set())


def _ground(doc, **data):
    doc["slides"][0]["nodes"].append({"id": "g", "name": "Ground", "layer": "ground",
                                      "box": {"x": 0, "y": 0, "w": 100, "h": 100},
                                      "data": {"design": "sweep", **data}})


def test_gate_checks_nodes_against_the_manifest(blank):
    assert designs.add_starter(blank, "sweep") == "sweep"
    assert designs.add_starter(blank, "sweep") == "sweep-2"
    edit(blank, lambda d: _ground(d, variant="graphite", values={"grain": 0.05, "wall": "paper"}))
    assert proj.load(blank).ok

    edit(blank, lambda d: d["slides"][0]["nodes"][1]["data"].update(
        variant="neon", values={"grain": 0.5, "wall": "brandless", "depth": 1}))
    found = {(f.rule, f.path) for f in proj.load(blank).findings}
    np_ = "slides[0].nodes[1].data"  # nodes[0] is the template's background
    assert ("DESIGN_UNKNOWN_PARAM", f"{np_}.variant") in found
    assert ("DESIGN_VALUE_TYPE", f"{np_}.values.grain") in found
    assert ("DESIGN_VALUE_TYPE", f"{np_}.values.wall") in found
    assert ("DESIGN_UNKNOWN_PARAM", f"{np_}.values.depth") in found


def test_gate_reports_bad_expressions_in_the_file(blank):
    designs.add_starter(blank, "sweep")
    f = blank / "designs" / "sweep.svg"
    f.write_text(f.read_text().replace("{{wall}}", "{{wal + }}", 1))
    edit(blank, lambda d: _ground(d))
    rules = [x.rule for x in proj.load(blank).findings]
    assert "DESIGN_BAD_EXPRESSION" in rules


def test_brand_token_names_are_checked_against_the_project(blank):
    designs.add_starter(blank, "sweep")
    f = blank / "designs" / "sweep.svg"
    f.write_text(f.read_text().replace("{{wall}}", "{{brand.paper}}", 1))
    edit(blank, lambda d: _ground(d))
    assert proj.load(blank).ok
    f.write_text(f.read_text().replace("{{brand.paper}}", "{{brand.ink}}", 1))
    assert any(x.rule == "DESIGN_UNKNOWN_PARAM" for x in proj.load(blank).findings)


def test_load_all(blank):
    designs.add_starter(blank, "aurora")
    (blank / "designs" / "broken.svg").write_text("<svg")
    info = designs.load_all(blank)
    assert info["aurora"]["manifest"]["name"] == "Aurora" and "error" not in info["aurora"]
    assert info["broken"]["manifest"] is None and info["broken"]["error"]


def test_unknown_starter(blank):
    with pytest.raises(proj.XdsError):
        designs.add_starter(blank, "nope")


def test_stretched_designs_and_unused_params_are_warnings(blank):
    stretched = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none">
  <metadata id="xds-design">{"params": [{"name": "line", "type": "color", "default": "paper"},
    {"name": "cells", "type": "number", "default": 11}]}</metadata>
  <circle cx="50" cy="50" r="30" fill="{{line}}"/></svg>"""
    (blank / "designs" / "lattice.svg").write_text(stretched)
    edit(blank, lambda d: d["slides"][0]["nodes"][0]["data"].update(design="lattice", values={}))
    loaded = proj.load(blank)
    assert loaded.ok  # warnings don't block
    found = {f.rule: f for f in loaded.findings}
    assert found["DESIGN_STRETCHED"].severity == "warn" and "0.80×" in found["DESIGN_STRETCHED"].message
    assert found["DESIGN_UNUSED_PARAM"].severity == "warn" and "'cells'" in found["DESIGN_UNUSED_PARAM"].message
    assert "line" not in found["DESIGN_UNUSED_PARAM"].message.split("'cells'")[0]
    edit(blank, lambda d: d["format"].update(preset="instagram-square", width=1080, height=1080))
    assert "DESIGN_STRETCHED" not in {f.rule for f in proj.load(blank).findings}


@pytest.mark.parametrize("name", designs.starters())
def test_starters_have_no_warnings(name):
    text = (designs.STARTERS_DIR / f"{name}.svg").read_text()
    d = designs.parse_design(name, text)
    for w, h in ((1080, 1350), (1440, 1080), (1080, 1920)):
        assert designs.design_warnings(d, w, h) == []
