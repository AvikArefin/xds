"""Treated or rotated text is masked by its ink polygon (data-models §5.1), not its line rects."""

import numpy as np

from xds.audit.measured import MeasuredSlide
from xds.audit.thresholds import build
from xds.models import SlideMeasure

from .test_audit_kit import Case, rules_of


def slide_of(c: Case) -> MeasuredSlide:
    project = c.project()
    cache = c.write()
    measure = SlideMeasure.model_validate_json((cache / "measure" / "s1.json").read_text())
    return MeasuredSlide(project, project.slides[0], measure, cache, build(project), 1)


def test_polygon_ink_bounds_and_mask(tmp_path):
    c = Case(tmp_path)
    c.text("word", 100, 100, ["SHIFT"], size=120, level="expressive", widths=[400], rotation=90)
    # a diamond around the glyphs: the renderer reported the rotated ink's corners
    c.measured[-1].update(treated=True, inkPolygon=[[300, 50], [400, 200], [300, 350], [200, 200]])
    s = slide_of(c)
    n = s.text_nodes[0]
    ink = s.ink(n)
    assert (ink.x, ink.y, ink.x1, ink.y1) == (200, 50, 400, 350)
    mask = s.text_ink_mask(n)
    assert mask.shape == (1350, 1080)
    # the polygon ∩ the type alpha: the kit painted the line rect (100..500 × 100..250) only
    assert mask[200, 300] and not mask[60, 300]        # inside the diamond and the painted rect / outside the rect
    assert not mask[200, 150]                          # painted, but outside the diamond
    # a block without a polygon keeps the line-rect path
    c2 = Case(tmp_path / "plain")
    c2.text("plain", 100, 100, ["Hello"], size=70, widths=[300])
    s2 = slide_of(c2)
    assert s2.text_ink_mask(s2.text_nodes[0])[120, 200]
    assert s2.ink(s2.text_nodes[0]).x == 100


def test_polygon_without_points_falls_back(tmp_path):
    c = Case(tmp_path)
    c.text("word", 100, 100, ["SHIFT"], size=120, level="expressive", widths=[400])
    c.measured[-1].update(treated=True)
    s = slide_of(c)
    n = s.text_nodes[0]
    assert s.ink(n).x == 100
    assert s.text_ink_mask(n).any()


def test_collision_rules_use_the_polygon(tmp_path):
    """Two blocks whose line rects overlap but whose polygons do not are not a TEXT_OVER_* hit."""
    c = Case(tmp_path)
    c.text("a", 100, 100, ["SHIFT"], size=120, level="expressive", widths=[600])
    c.text("b", 100, 100, ["YOUR"], size=120, level="expressive", widths=[600])
    c.measured[-2].update(treated=True, inkPolygon=[[100, 100], [380, 100], [380, 220], [100, 220]])
    c.measured[-1].update(treated=True, inkPolygon=[[420, 100], [700, 100], [700, 220], [420, 220]])
    found = rules_of(c.run())
    assert "TEXT_OVERLAP" not in found
    assert not np.logical_and(
        slide_of(c).text_ink_mask(slide_of(c).text_nodes[0]), slide_of(c).text_ink_mask(slide_of(c).text_nodes[1])
    ).any()
