import json

import pytest
from PIL import Image

from xds import screens
from xds import project as proj
from xds.project import XdsError

from .conftest import edit


def test_devices_table():
    assert screens.DEVICES["iphone"] == {"width": 393, "height": 852, "scale": 3,
                                         "safeArea": {"top": 59, "right": 0, "bottom": 34, "left": 0}}
    assert set(screens.DEVICES) == {"iphone", "iphone-17-pro", "iphone-max", "android", "ipad", "macbook",
                                    "desktop"}


def test_add_registers_screen(blank):
    s = screens.add(blank, "app-home", device="android")
    assert s["width"] == 412 and s["scale"] == 2.625 and s["safeArea"]["top"] == 24
    assert (blank / "screens" / "app-home" / "partials" / "status-bar.html").exists()
    assert 'data-device="android"' in (blank / "screens" / "app-home" / "index.html").read_text()
    assert proj.load(blank).ok
    with pytest.raises(XdsError):
        screens.add(blank, "app-home", device="iphone")
    custom = screens.add(blank, "wide", width=800, height=600)
    assert custom["scale"] == 2 and "safeArea" not in custom


def test_page_building(blank, tmp_path):
    screens.add(blank, "s", device="iphone")
    page = blank / "screens" / "s" / "index.html"
    page.write_text('<html><head></head><body><xds-include src="mine"></xds-include>'
                    '<i data-lucide="bell" class="size-5 text-red-500"></i></body></html>')
    (blank / "screens" / "s" / "partials" / "mine.html").write_text(
        '<p class="text-[23px]">hi</p><xds-include src="home-indicator"></xds-include>')
    project = proj.load(blank).project
    html = screens.build_page(blank, project, project.screen("s"))
    assert "<svg" in html and "lucide-bell size-5 text-red-500" in html and "xds-include" not in html
    assert "--safe-top:59px" in html and 'data-device="iphone"' in html
    assert "font-size:23px" in html  # compiled for the classes used
    page.write_text('<i data-lucide="no-such-icon"></i>')
    with pytest.raises(XdsError):
        screens.build_page(blank, project, project.screen("s"))


def test_font_faces(blank):
    (blank / "fonts" / "X").mkdir(parents=True)
    (blank / "fonts" / "X" / "X-Bold.woff2").write_bytes(b"")
    edit(blank, lambda d: d.update(fonts=[{"family": "X", "path": "fonts/X/X-Bold.woff2", "weight": 700}]))
    css = screens.font_faces(proj.load(blank).project)
    assert 'font-family:"X"' in css and 'url("/fonts/X/X-Bold.woff2")' in css and "font-weight:700" in css


def test_render_and_ensure_rendered(blank, tmp_path):
    screens.add(blank, "app-home", device="iphone")
    out = screens.render(blank, "app-home", tmp_path / "a.png")
    img = Image.open(out)
    assert img.size == (393 * 3, 852 * 3)
    project = proj.load(blank).project
    cache = tmp_path / "cache"
    got = screens.ensure_rendered(blank, project, cache, ["app-home", "app-home", "missing"])
    assert list(got) == ["app-home"] and got["app-home"].exists()
    stamp = got["app-home"].stat().st_mtime_ns
    screens.ensure_rendered(blank, project, cache, ["app-home"])
    assert got["app-home"].stat().st_mtime_ns == stamp
