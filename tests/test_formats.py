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
