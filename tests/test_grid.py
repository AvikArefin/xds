import pytest
from PIL import Image

from xds import grid
from xds.project import XdsError


def test_grid_writes_a_labeled_copy(blank):
    Image.new("RGB", (612, 408), "#336699").save(blank / "assets" / "photo.jpg")
    res = grid.grid(blank, "assets/photo.jpg", step=5)
    out = Image.open(res["png"])
    assert res["png"].endswith("cache/grid/photo-grid.png") and (res["width"], res["height"]) == (612, 408)
    assert out.size[0] / out.size[1] == pytest.approx(612 / 408, rel=0.01)
    assert len(out.convert("RGB").getcolors(maxcolors=1 << 20)) > 2  # lines and labels over the dimmed photo


def test_grid_refuses_outside_paths_and_non_images(blank, tmp_path):
    with pytest.raises(XdsError):
        grid.grid(blank, "../elsewhere.png")
    (blank / "assets" / "notes.txt").write_text("hi")
    with pytest.raises(XdsError):
        grid.grid(blank, "assets/notes.txt")
    with pytest.raises(XdsError):
        grid.grid(blank, "assets/missing.png")
