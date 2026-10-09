from xds import formats
from xds.models import Format


def guide(preset):
    p = formats.CATALOG[preset]
    return formats.derive(Format(preset=preset, width=p.width, height=p.height))


def test_portrait_numbers_match_the_docs():
    g = guide("instagram-portrait")
    assert (g.s, g.u, g.m) == (1080, 8, 64)
    assert round(g.k, 3) == 0.361
    b = g.bands
    assert (b["display"].default, b["display"].min, b["display"].max) == (119, 81, 216)
    assert (b["headline"].default, b["headline"].min, b["headline"].max) == (70, 54, 97)
    assert (b["subhead"].default, b["subhead"].min, b["subhead"].max) == (45, 35, 54)
    assert (b["body"].default, b["body"].min, b["body"].max) == (37, 33, 43)
    assert (b["caption"].default, b["caption"].min, b["caption"].max) == (31, 28, 35)
    assert g.content == {"x0": 64, "x1": 1016, "y0": 64, "y1": 1286}


def test_story_safe_zones_widen_the_margins():
    g = guide("instagram-story")
    assert g.margins["top"] == 250 and g.margins["bottom"] == 340
    assert [z.name for z in g.safe_zones] == ["top UI", "bottom UI"]


def test_band_defaults_never_below_readable():
    g = guide("linkedin-landscape")
    for b in g.bands.values():
        assert b.min <= b.default <= b.max


def test_custom_size_uses_generic_screen():
    g = formats.derive(Format(width=800, height=800))
    assert g.preset == formats.GENERIC and g.k == 1


def test_margin_override():
    g = formats.derive(Format(preset="instagram-portrait", width=1080, height=1350), {"margin": 0.045})
    assert g.m == 48


def test_three_by_four_and_four_by_three_presets():
    assert (formats.CATALOG["instagram-portrait-3x4"].width, formats.CATALOG["instagram-portrait-3x4"].height) == (1080, 1440)
    assert (formats.CATALOG["linkedin-document-4x3"].width, formats.CATALOG["linkedin-document-4x3"].height) == (1440, 1080)
    assert formats.CATALOG["presentation-4x3"].group == "Screen"
    assert {f["key"]: f["aspect"] for f in formats.catalog_json()}["instagram-portrait-3x4"] == "3:4 portrait"


def test_aspect_labels_and_size_parsing():
    assert formats.aspect_label(1440, 1080) == "4:3 landscape"
    assert formats.aspect_label(1080, 1080) == "1:1 square"
    assert formats.aspect_label(1200, 627) == "1.91:1 landscape"
    assert formats.parse_size("1440x1080") == (1440, 1080) == formats.parse_size(" 1440 × 1080 ")
    for bad in ("1440", "0x10", "axb"):
        try:
            formats.parse_size(bad)
        except ValueError:
            continue
        raise AssertionError(bad)


def test_guide_names_the_contrast_cutoffs_in_this_formats_px():
    from xds.audit.thresholds import Thresholds

    custom = Thresholds(formats.derive(Format(width=1440, height=1080)))
    assert custom.contrast_text().startswith("text size > 24 px: Lc ≥ 45 · 16–24 px: Lc ≥ 60")
    assert custom.lc_band(24, 400) == (60, "size 16–24 px") and custom.lc_band(25, 400)[0] == 45
    phone = Thresholds(guide("instagram-portrait"))  # k = 390 / 1080
    assert "> 66.5 px: Lc ≥ 45" in phone.contrast_text() and "(= 16 and 24 px on screen)" in phone.contrast_text()
    text = formats.format_guide_text(custom.guide, custom.contrast_text())
    assert "4:3 landscape" in text and "custom size, shown 1:1" in text and "text size > 24 px" in text
