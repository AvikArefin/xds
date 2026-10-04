"""The shared font library: projects reference `xds:fonts/...` instead of keeping copies."""

import json

import pytest

from xds import fonts, library, screens
from xds import project as proj
from xds.models import Project


@pytest.fixture
def lib(tmp_path, monkeypatch):
    """A font library with Satoshi already downloaded (no network in these tests)."""
    d = tmp_path / "library"
    (d / "models").mkdir(parents=True)
    fam = d / "fonts" / "Satoshi"
    fam.mkdir(parents=True)
    for f in ("Satoshi-Regular.woff2", "Satoshi-Bold.woff2"):
        (fam / f).write_bytes(b"wOF2")
    (fam / "family.json").write_text(json.dumps({"name": "Satoshi", "slug": "satoshi", "files": [
        {"file": "Satoshi-Regular.woff2", "weight": 400, "italic": False},
        {"file": "Satoshi-Bold.woff2", "weight": 700, "italic": False}]}))
    monkeypatch.setattr(library, "DIR", d)
    monkeypatch.setattr(fonts.httpx, "Client", lambda *a, **k: pytest.fail("network used"))
    return d


def test_fetch_reuses_the_library(blank, lib):
    entries = fonts.fetch(blank, "satoshi")  # any casing
    assert [e["path"] for e in entries] == ["xds:fonts/Satoshi/Satoshi-Regular.woff2",
                                            "xds:fonts/Satoshi/Satoshi-Bold.woff2"]
    assert not (blank / "fonts" / "Satoshi").exists()  # nothing copied into the project
    assert proj.load(blank).ok
    assert "Satoshi" in fonts.library_families()["satoshi"]["name"]


def test_screen_fonts_resolve_in_the_library(blank, lib):
    fonts.fetch(blank, "Satoshi")
    p = Project.model_validate(proj.read_raw(blank))
    assert 'url("/xds:fonts/Satoshi/Satoshi-Bold.woff2")' in screens.font_faces(p)
    assert proj.resolve_asset(blank, "xds:fonts/Satoshi/Satoshi-Bold.woff2").is_file()


def test_missing_library_font_says_how_to_fix(blank, lib):
    fonts.fetch(blank, "Satoshi")
    (lib / "fonts" / "Satoshi" / "Satoshi-Bold.woff2").unlink()
    found = [f for f in proj.load(blank).findings if f.rule == "MISSING_FILE"]
    assert len(found) == 1 and "xds fonts fetch" in found[0].message


def test_vendor_copies_fonts_into_the_project(blank, lib):
    fonts.fetch(blank, "Satoshi")
    copied = fonts.vendor(blank)
    assert copied == ["fonts/Satoshi/Satoshi-Regular.woff2", "fonts/Satoshi/Satoshi-Bold.woff2"]
    assert all((blank / c).read_bytes() == b"wOF2" for c in copied)
    assert proj.load(blank).ok and fonts.vendor(blank) == []
