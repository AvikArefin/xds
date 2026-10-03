"""Rule-level tests on synthetic measurements and pixels (no browser)."""

from __future__ import annotations

import numpy as np

from tests.test_audit_kit import Case, rules_of


def clean_case(tmp_path) -> Case:
    c = Case(tmp_path)
    c.text("title", 64, 96, ["Fresh every", "morning"], size=72, level="headline", widths=[440, 300], group="top")
    c.text("sub", 64, 96 + 2 * 79 + 32, ["Cold brew, delivered"], size=40, level="subhead",
           widths=[420], weight=500, group="top")
    c.product(340, 520, 400, 640, color="#c0602a")
    return c


def test_clean_slide_has_no_findings(tmp_path):
    report = clean_case(tmp_path).run()
    assert report.findings == [], [(f.rule, f.message) for f in report.findings]


# --- collision ---------------------------------------------------------------------------------

def test_text_overlap(tmp_path):
    c = Case(tmp_path)
    c.text("title", 64, 200, ["Big title"], size=72, widths=[400])
    c.text("price", 100, 230, ["$9 only"], size=40, level="subhead", widths=[200], weight=500)
    found = rules_of(c.run())
    f = found["TEXT_OVERLAP"][0]
    assert f.severity == "error" and set(f.nodes) == {"title", "price"}
    assert "'Title'" in f.message and "box.y" in f.fix
    assert f.region is not None and f.measured["overlapPx"] > 0


def test_text_crowded(tmp_path):
    c = Case(tmp_path)
    c.text("title", 64, 200, ["Big title"], size=72, widths=[400])  # line box 200..279.2
    c.text("sub", 64, 285, ["Small print"], size=40, level="subhead", widths=[300], weight=500)
    found = rules_of(c.run())
    assert "TEXT_CROWDED" in found and "TEXT_OVERLAP" not in found
    f = found["TEXT_CROWDED"][0]
    assert f.measured["gapPx"] < f.expected["gapPxMin"]


def test_in_safe_zone_story(tmp_path):
    c = Case(tmp_path, width=1080, height=1920, preset="instagram-story")
    c.text("title", 64, 120, ["Under the UI"], size=72, widths=[480])
    f = rules_of(c.run())["IN_SAFE_ZONE"][0]
    assert f.severity == "error" and f.nodes == ["title"] and "top UI" in f.message
    assert "box.y to" in f.fix


def test_outside_margin(tmp_path):
    c = Case(tmp_path)
    c.text("title", 20, 300, ["Edge"], size=72, widths=[200])
    f = rules_of(c.run())["OUTSIDE_MARGIN"][0]
    assert f.severity == "warn" and f.measured["outsidePx"] == 44
    assert "box.x" in f.fix


def test_text_clipped(tmp_path):
    c = Case(tmp_path)
    c.text("title", 64, 300, ["Too long for its box"], size=72, widths=[700], overflow=True)
    assert rules_of(c.run())["TEXT_CLIPPED"][0].severity == "error"


def test_text_over_subject_tiers(tmp_path):
    c = Case(tmp_path)
    c.product(300, 400, 500, 700)
    c.text("big", 350, 600, ["ON IT"], size=120, level="display", widths=[300], color="#ffffff")
    f = rules_of(c.run())["TEXT_OVER_SUBJECT"][0]
    assert f.severity == "error" and "bottle" in f.nodes


def test_subject_masked_and_text_over_image(tmp_path):
    c = Case(tmp_path)
    c.product(300, 400, 500, 700)
    c.image("photo", 280, 380, 400, 500)  # image layer is above render by default
    c.text("cap", 300, 420, ["Photo credit here"], size=40, level="subhead", widths=[340], color="#ffffff",
           weight=500)
    found = rules_of(c.run())
    assert found["SUBJECT_MASKED"][0].severity == "error"
    assert "photo" in found["SUBJECT_MASKED"][0].nodes
    assert found["TEXT_OVER_IMAGE"][0].severity == "error"


def test_subject_cropped(tmp_path):
    c = Case(tmp_path)
    c.product(300, 600, 500, 750, box=(300, 600, 500, 800))  # 50 px of 800 below the canvas
    f = rules_of(c.run())["SUBJECT_CROPPED"][0]
    assert f.severity == "warn" and f.measured["edges"] == ["bottom"] and f.measured["cropPct"] < 25


# --- spacing -----------------------------------------------------------------------------------

def test_align_near_miss(tmp_path):
    c = Case(tmp_path)
    c.text("title", 64, 200, ["Aligned title"], size=72, widths=[460], group="g")
    c.text("sub", 67, 300, ["Nearly aligned"], size=40, level="subhead", widths=[333], weight=500, group="g")
    f = rules_of(c.run())["ALIGN_NEAR_MISS"][0]
    assert f.measured["edge"] == "left" and f.measured["offsetPx"] == 3
    assert "box.x" in f.fix


def test_spacing_inconsistent_and_off_scale(tmp_path):
    c = Case(tmp_path)
    for i, y in enumerate([200, 270, 380]):  # gaps 70-58=12 … 110-58=52
        c.text(f"item{i}", 64, y, [f"List item {i}"], size=40, level="body", widths=[300], group="list")
    found = rules_of(c.run())
    assert "SPACING_INCONSISTENT" in found


def test_grouping_ambiguous(tmp_path):
    c = Case(tmp_path)
    c.text("a", 64, 200, ["Group A one"], size=40, level="subhead", widths=[300], group="A", weight=500)
    c.text("b", 64, 200 + 48 + 40, ["Group A two"], size=40, level="subhead", widths=[300], group="A", weight=500)
    c.text("c", 64, 200 + 2 * 48 + 40 + 44, ["Group B"], size=40, level="subhead", widths=[300], weight=500)
    f = rules_of(c.run())["GROUPING_AMBIGUOUS"][0]
    assert f.measured["innerGapPx"] > f.expected["innerGapPxMax"]


# --- typography --------------------------------------------------------------------------------

def test_text_too_small(tmp_path):
    c = Case(tmp_path)
    c.text("title", 64, 200, ["Tiny headline"], size=40, widths=[300])
    f = rules_of(c.run())["TEXT_TOO_SMALL"][0]
    assert f.severity == "error"
    assert f.fix == "Set data.size to 54 (headline min)"


def test_hierarchy_weak(tmp_path):
    c = Case(tmp_path)
    c.text("title", 64, 200, ["Title"], size=60, widths=[200])
    c.text("sub", 64, 400, ["Sub"], size=52, level="subhead", widths=[150], weight=500)
    found = rules_of(c.run())
    f = found["HIERARCHY_WEAK"][0]
    assert f.measured["ratio"] < 1.25 and "SIZE_NEAR_MISS" not in found
    assert "data.size" in f.fix


def test_size_near_miss(tmp_path):
    c = Case(tmp_path)
    c.text("title", 64, 200, ["Title"], size=72, widths=[200])
    c.text("title2", 64, 400, ["Other"], size=70, widths=[200])
    found = rules_of(c.run())
    assert "SIZE_NEAR_MISS" in found and "HIERARCHY_WEAK" not in found


def test_widow(tmp_path):
    c = Case(tmp_path)
    c.text("body", 64, 300, ["Our beans are roasted every morning in small", "batches."], size=37,
           level="body", widths=[800, 130], source="Our beans are roasted every morning in small batches.")
    f = rules_of(c.run())["WIDOW"][0]
    assert f.measured["lastLineWords"] == 1


def test_widow_explicit_break_is_deliberate(tmp_path):
    c = Case(tmp_path)
    c.text("body", 64, 300, ["Our beans are roasted every morning in small", "batches."], size=37,
           level="body", widths=[800, 130])
    assert "WIDOW" not in rules_of(c.run())


def test_typography_misc(tmp_path):
    c = Case(tmp_path)
    c.text("caps", 64, 200, ["SMALL CAPS LABEL"], size=40, level="subhead", widths=[400], uppercase=True,
           weight=500)
    lines = ["This centered paragraph keeps going on", "and on for far too many lines to", "read with ease when",
             "every line starts in a new place"]
    c.text("para", 64, 500, lines, size=37, level="body", align="center", widths=[700, 640, 420, 650])
    found = rules_of(c.run())
    assert "CAPS_UNTRACKED" in found and "CENTERED_LONG_TEXT" in found
    assert found["CAPS_UNTRACKED"][0].fix.startswith("Set data.letterSpacing")


def test_too_many_words(tmp_path):
    c = Case(tmp_path)
    words = "word " * 40
    c.text("body", 64, 300, [words[i * 60:(i + 1) * 60] for i in range(4)], size=37, level="body",
           widths=[900] * 4, source=words)
    assert rules_of(c.run())["TOO_MANY_WORDS"][0].measured["words"] == 40


# --- contrast ----------------------------------------------------------------------------------

def test_low_contrast_dark_on_dark(tmp_path):
    c = Case(tmp_path, background="#1a1a1a")
    c.text("title", 64, 200, ["Hidden"], size=72, widths=[300], color="#2a2a2a")
    f = rules_of(c.run())["LOW_CONTRAST"][0]
    assert f.severity == "error" and f.measured["lc"] < 45 and f.expected["lcMin"] == 45
    assert "data.color to 'paper'" in f.fix
    assert f.measured["displayedPx"] == round(72 * 390 / 1080, 1)


def test_low_contrast_uses_displayed_size(tmp_path):
    # 37 px body displays at ~13 px → needs Lc 75; mid-gray on white is ~Lc 63.
    c = Case(tmp_path)
    c.text("body", 64, 300, ["Body copy that reads at a small size"], size=37, level="body",
           widths=[700], color="#888888", weight=400)
    f = rules_of(c.run())["LOW_CONTRAST"][0]
    assert f.expected["lcMin"] == 75 and 60 < f.measured["lc"] < 66


def test_busy_background(tmp_path):
    c = Case(tmp_path)
    rng = np.random.default_rng(1)
    c.bg[180:300, 40:600] = (rng.random((120, 560, 1)) * 255).astype(np.uint8)
    c.text("title", 64, 200, ["Noisy"], size=72, widths=[300], color="#ffffff")
    assert "BUSY_BACKGROUND" in rules_of(c.run())


def test_decorative_invisible(tmp_path):
    c = Case(tmp_path)
    c.text("deco", 64, 600, ["BIG"], size=200, level="display", widths=[400], color="#fafafa", decorative=True)
    found = rules_of(c.run())
    assert "DECORATIVE_INVISIBLE" in found and "LOW_CONTRAST" not in found


# --- composition -------------------------------------------------------------------------------

def test_competing_headlines_and_order(tmp_path):
    c = Case(tmp_path)
    c.text("note", 64, 100, ["A small note first"], size=37, level="body", widths=[400])
    c.text("h1", 64, 500, ["First"], size=72, widths=[250])
    c.text("h2", 64, 800, ["Second"], size=72, widths=[280])
    found = rules_of(c.run())
    assert "COMPETING_HEADLINES" in found
    assert found["HIERARCHY_ORDER"][0].nodes == ["note", "h1"]


def test_kicker_is_not_hierarchy_order(tmp_path):
    c = Case(tmp_path)
    c.text("kicker", 64, 400, ["NEW"], size=37, level="body", widths=[100], group="h")
    c.text("h1", 64, 400 + 53.65 + 16, ["Headline"], size=72, widths=[350], group="h")
    assert "HIERARCHY_ORDER" not in rules_of(c.run())


def test_crowded_and_too_many_elements(tmp_path):
    c = Case(tmp_path)
    c.image("photo", 64, 64, 952, 1100)
    for i in range(7):
        c.text(f"t{i}", 64, 64 + i * 150, [f"Label {i}"], size=40, level="subhead", widths=[200], weight=500)
    found = rules_of(c.run())
    assert "CROWDED" in found and "TOO_MANY_ELEMENTS" in found


def test_attention_on_background(tmp_path):
    c = Case(tmp_path)
    rng = np.random.default_rng(0)
    c.bg[900:1300, 50:500] = (rng.random((400, 450, 1)) * 255).astype(np.uint8)
    c.text("title", 64, 96, ["Fresh every"], size=72, widths=[440])
    c.product(600, 520, 300, 500, color="#c0c0c0")
    assert "ATTENTION_ON_BACKGROUND" in rules_of(c.run())


# --- subject -----------------------------------------------------------------------------------

def test_subject_too_small(tmp_path):
    c = Case(tmp_path)
    c.product(480, 600, 120, 200, camera={"mode": "frame", "height": 20})
    f = rules_of(c.run())["SUBJECT_TOO_SMALL"][0]
    assert f.measured["heightPct"] < 30 and f.fix.startswith("Set camera.height")


def test_subject_too_large(tmp_path):
    c = Case(tmp_path)
    c.product(300, 100, 480, 1150)
    assert "SUBJECT_TOO_LARGE" in rules_of(c.run())


def test_subject_overexposed(tmp_path):
    c = Case(tmp_path, background="#404040")
    c.product(340, 400, 400, 600, color="#ffffff")
    f = rules_of(c.run())["SUBJECT_OVEREXPOSED"][0]
    assert "lighting.brightness to -0.3" in f.fix


def test_subject_underexposed(tmp_path):
    c = Case(tmp_path, background="#e0e0e0")
    c.product(340, 400, 400, 600, color="#000000")
    assert "SUBJECT_UNDEREXPOSED" in rules_of(c.run())


def test_subject_low_separation(tmp_path):
    c = Case(tmp_path, background="#808080")
    c.product(340, 400, 400, 600, color="#828282")
    assert "SUBJECT_LOW_SEPARATION" in rules_of(c.run())


def test_subject_close_to_text(tmp_path):
    c = Case(tmp_path)
    c.product(340, 500, 400, 600)
    c.text("title", 340, 500 - 79.2 - 4, ["Close"], size=72, widths=[250])
    assert "SUBJECT_CLOSE_TO_TEXT" in rules_of(c.run())


def test_screen_rules(tmp_path):
    c = Case(tmp_path)
    c.product(440, 500, 200, 400)
    c.project_screens.append({"id": "app", "path": "screens/app/index.html", "width": 393, "height": 852,
                              "scale": 1})
    c.screens.append({"screenId": "app", "objectId": "bottle", "mesh": "Screen",
                      "rect": {"x": 450, "y": 510, "w": 180, "h": 380}, "displayedWidth": 600})
    c.screens[0]["displayedWidth"] = 180
    found = rules_of(c.run())
    assert "SCREEN_DETAIL_TOO_SMALL" in found  # 16 px × 180/393 ≈ 7 px < readable(9) ≈ 25 px
    c.screens[0]["displayedWidth"] = 700
    c.screens[0]["rect"]["w"] = 700
    found = rules_of(c.run())
    assert found["SCREEN_LOW_RES"][0].fix == "Set screens[0].scale to 2.7"
