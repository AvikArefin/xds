"""The expression family (design-rules §8) on synthetic cases: coherence, not taste."""

from __future__ import annotations

from tests.test_audit_kit import Case, rules_of
from xds.audit.rules.expression import angle_family


def big_word(c: Case, id: str = "shift", y: int = 150, **kw) -> None:
    c.text(id, 64, y, [id.upper()], size=240, level="expressive", widths=[900], **kw)


# --- the expressive level ----------------------------------------------------------------

def test_expressive_relaxes_measure_and_rag(tmp_path):
    c = Case(tmp_path)
    # one very long line and a one-word last line: LINE_LENGTH, WIDOW and BAD_RAG would fire for a headline
    c.text("shift", 64, 150, ["SHIFT YOUR WHOLE PERSPECTIVE TODAY", "NOW"], size=200, level="expressive",
           widths=[900, 120])
    found = rules_of(c.run())
    assert not {"LINE_LENGTH", "WIDOW", "BAD_RAG"} & set(found), set(found)
    assert "TEXT_TOO_LARGE" not in found  # 200 px sits inside the expressive band (81–540 at s = 1080)


def test_angle_family():
    assert angle_family(12) == angle_family(-12) == angle_family(102) == angle_family(-78) == 12


# --- angles and skews ----------------------------------------------------------------------

def test_angle_families_without_a_system(tmp_path):
    c = Case(tmp_path)
    big_word(c, "a", 100, rotation=-12)
    big_word(c, "b", 400, rotation=102)     # the same family as -12
    big_word(c, "c", 700, rotation=30)      # a second family: allowed
    assert "ANGLE_OFF_SYSTEM" not in rules_of(c.run())
    big_word(c, "d", 1000, rotation=45)     # a third
    f = rules_of(c.run())["ANGLE_OFF_SYSTEM"][0]
    assert f.severity == "warn" and f.measured["angleFamilies"] == [12, 30, 45]


def test_angle_off_declared_system(tmp_path):
    c = Case(tmp_path)
    c.expression = {"angles": [12]}
    big_word(c, "a", 100, rotation=-12)
    big_word(c, "b", 500, rotation=20)
    found = rules_of(c.run())["ANGLE_OFF_SYSTEM"]
    assert [f.nodes for f in found] == [["b"]] and "box.rotation to 12" in found[0].fix


def test_skew_mixed(tmp_path):
    c = Case(tmp_path)
    big_word(c, "a", 100, treat={"skew": 12})
    big_word(c, "b", 500, treat={"skew": 13})    # within tolerance
    assert "SKEW_MIXED" not in rules_of(c.run())
    big_word(c, "c", 900, treat={"skew": -25})
    assert rules_of(c.run())["SKEW_MIXED"][0].measured["skews"] == [12, 25]
    c.expression = {"skews": [12]}
    assert rules_of(c.run())["SKEW_MIXED"][0].nodes == ["c"]


# --- strokes, extrusions, radii -------------------------------------------------------------

def test_stroke_scale_and_count(tmp_path):
    c = Case(tmp_path)
    big_word(c, "a", 100, treat={"fill": "none", "stroke": {"width": 0.5}})
    c.shape("star", 700, 700, 64, 64, stroke=0.5)
    assert "STROKE_OFF_SCALE" not in rules_of(c.run())
    c.shape("ring", 800, 900, 96, 96, "ring", stroke=0.6)          # off the quarter-unit scale
    f = rules_of(c.run())["STROKE_OFF_SCALE"][0]
    assert f.nodes == ["ring"] and "to 0.5" in f.fix
    c.shape("lens", 100, 1100, 128, 64, "lens", stroke=1)
    c.shape("arc", 400, 1100, 128, 128, "arc", stroke=2)
    assert any(f.measured.get("strokeWidths") == [0.5, 0.6, 1, 2] for f in rules_of(c.run())["STROKE_OFF_SCALE"])
    c.expression = {"strokeWidths": [0.5, 1]}
    found = rules_of(c.run())["STROKE_OFF_SCALE"]
    assert sorted(n for f in found for n in f.nodes) == ["arc", "ring"]


def test_extrude_direction(tmp_path):
    c = Case(tmp_path)
    big_word(c, "a", 100, treat={"extrude": {"depth": 2, "angle": 135}})
    big_word(c, "b", 500, treat={"repeat": {"count": 3, "dx": 1, "dy": 1}})   # 45°: a different direction
    f = rules_of(c.run())["EXTRUDE_DIRECTION_MIXED"][0]
    assert set(f.nodes) == {"a", "b"} and f.measured["angles"] == [135, 45]
    c.expression = {"extrudeAngle": 135}
    assert rules_of(c.run())["EXTRUDE_DIRECTION_MIXED"][0].nodes == ["b"]


def test_extrude_against_light(tmp_path):
    c = Case(tmp_path)
    c.product(340, 900, 400, 400)
    c.lighting = {"angle": 115}     # yaw 25 (default camera) + 90: the key comes from the right
    big_word(c, "a", 100, treat={"extrude": {"depth": 2, "angle": 0}})     # falls to the right, into the light
    f = rules_of(c.run())["EXTRUDE_AGAINST_LIGHT"][0]
    assert f.severity == "info" and f.nodes == ["a"] and "right" in f.message
    c.nodes[-1]["data"]["extrude"]["angle"] = 180
    assert "EXTRUDE_AGAINST_LIGHT" not in rules_of(c.run())


def test_radius_off_system(tmp_path):
    c = Case(tmp_path)
    c.text("tag", 64, 1200, ["SKEW-0003"], size=40, level="caption", widths=[300],
           treat={"plate": {"padding": 2, "radius": 1, "stroke": {"width": 0.5}}})
    c.shape("box1", 100, 700, 200, 80, "rect", params={"radius": 2})
    c.shape("box2", 400, 700, 200, 80, "rect", params={"radius": 3})
    assert rules_of(c.run())["RADIUS_OFF_SYSTEM"][0].measured["radii"] == [1, 2, 3]
    c.expression = {"radii": [1]}
    assert sorted(n for f in rules_of(c.run())["RADIUS_OFF_SYSTEM"] for n in f.nodes) == ["box1", "box2"]


# --- ornaments ------------------------------------------------------------------------------

def test_ornament_families_and_scale(tmp_path):
    c = Case(tmp_path)
    c.shape("s1", 700, 700, 64, 64, "star-8")
    c.shape("s2", 800, 900, 32, 32, "sparkle")
    assert not {"ORNAMENT_FAMILY_MIXED", "MOTIF_SCALE_OFF"} & set(rules_of(c.run()))
    c.shape("r1", 100, 1100, 100, 100, "ring")      # another family, and 100 px is off the 8 px scale
    found = rules_of(c.run())
    assert found["ORNAMENT_FAMILY_MIXED"][0].measured["families"] == ["rings", "stars"]
    f = found["MOTIF_SCALE_OFF"][0]
    assert f.nodes == ["r1"] and f.expected["multipleOf"] == 8 and "box.w" in f.fix
    c.expression = {"ornaments": ["star-8", "sparkle"]}
    assert rules_of(c.run())["ORNAMENT_FAMILY_MIXED"][0].nodes == ["r1"]


def test_too_many_motif_sizes(tmp_path):
    c = Case(tmp_path)
    for i, size in enumerate((32, 64, 96, 128)):
        c.shape(f"s{i}", 100 + 200 * i, 800, size, size, "star-4")
    f = rules_of(c.run())["MOTIF_SCALE_OFF"][0]
    assert f.measured["sizes"] == [32, 64, 96, 128] and f.severity == "info"


# --- budget and readability ---------------------------------------------------------------

def test_too_many_treatments(tmp_path):
    c = Case(tmp_path)
    big_word(c, "a", 100, rotation=12, treat={"skew": 12})
    assert "TOO_MANY_TREATMENTS" not in rules_of(c.run())
    c.shape("star", 700, 1100, 64, 64, "star-8")
    f = rules_of(c.run())["TOO_MANY_TREATMENTS"][0]
    assert f.measured["treatments"] == ["ornaments", "rotation", "skew"] and f.expected["treatmentsMax"] == 2
    c.expression = {"maxTreatments": 3}
    assert "TOO_MANY_TREATMENTS" not in rules_of(c.run())
    assert "TOO_MANY_TREATMENTS" not in rules_of(c.run(rules={"set": {"expression.maxTreatments": 3}}))


def test_expressive_unreadable_cover(tmp_path):
    c = Case(tmp_path)
    big_word(c, "shift", 150)                                   # 900 × 216 px of lettering
    c.text("over", 64, 160, ["Half of it is covered by this"], size=72, level="headline", widths=[900])
    found = rules_of(c.run())
    f = found["EXPRESSIVE_UNREADABLE"][0]
    assert f.severity == "error" and f.nodes == ["shift", "over"] and f.measured["coveredPct"] > 30
    assert "TEXT_OVERLAP" in found      # the collision rule still fires
    c.nodes[1]["data"]["decorative"] = True
    assert "EXPRESSIVE_UNREADABLE" not in rules_of(c.run())


def test_expressive_unreadable_copies(tmp_path):
    c = Case(tmp_path)
    big_word(c, "shift", 150, treat={"repeat": {"count": 4, "dx": 30, "dy": 0}})   # 240 px steps, 216 px lines
    f = rules_of(c.run())["EXPRESSIVE_UNREADABLE"][0]
    assert f.measured["stepPx"] == 240 and "data.repeat" in f.fix
    c.nodes[-1]["data"] = {**c.nodes[-1]["data"], "repeat": {"count": 4, "dx": 2, "dy": 0}}
    assert "EXPRESSIVE_UNREADABLE" not in rules_of(c.run())


def test_guide_prints_the_expressive_band_and_the_system(blank, capsys):
    import json

    from tests.conftest import edit
    from xds import cli

    assert cli.main(["--json", "guide", str(blank)]) == 0
    guide = json.loads(capsys.readouterr().out)["guide"]
    assert guide["bands"]["expressive"]["default"] == 173 and "expression" not in guide   # 0.16 × 1080
    edit(blank, lambda d: d["brand"].update(expression={"angles": [12, 90], "strokeWidths": [0.5], "maxTreatments": 3}))
    assert cli.main(["guide", str(blank)]) == 0
    text = capsys.readouterr().out
    assert "expressive 173" in text
    assert "expression   angles 12°/90° · strokes 0.5u · ≤ 3 treatments per slide" in text
    assert cli.main(["--json", "guide", str(blank)]) == 0
    assert json.loads(capsys.readouterr().out)["guide"]["expression"] == {
        "angles": [12, 90], "strokeWidths": [0.5], "maxTreatments": 3}


def test_clean_expressive_poster(tmp_path):
    """A coherent system passes: one angle, one stroke, one family, two treatments."""
    c = Case(tmp_path)
    c.expression = {"angles": [12], "strokeWidths": [0.5], "ornaments": ["star-4", "star-8", "sparkle"]}
    big_word(c, "shift", 120, rotation=-12)
    big_word(c, "your", 420, rotation=102)
    c.shape("s1", 760, 160, 64, 64, "star-8")
    c.shape("s2", 120, 760, 32, 32, "sparkle")
    found = rules_of(c.run())
    assert not [r for r in found if r.startswith(("ANGLE", "SKEW", "STROKE", "EXTRUDE", "ORNAMENT", "MOTIF",
                                                  "RADIUS", "TOO_MANY_TREATMENTS", "EXPRESSIVE"))], found.keys()
