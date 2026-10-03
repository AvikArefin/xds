"""One end-to-end run through the real browser: render, audit and export the example project."""

import json
import shutil
from pathlib import Path

import pytest

from xds import browser, export
from xds.api import STUDIO_DIST
from xds.models import SlideMeasure

EXAMPLE = Path(__file__).parent / "fixtures" / "example"

pytestmark = pytest.mark.skipif(not (STUDIO_DIST / "index.html").exists(),
                                reason="needs a built studio (npm run build)")


@pytest.fixture(scope="module")
def example(tmp_path_factory):
    root = tmp_path_factory.mktemp("render") / "example"
    shutil.copytree(EXAMPLE, root, ignore=shutil.ignore_patterns("cache", "export"))
    if not all((root / f["path"]).exists() for f in json.loads((root / "project.json").read_text())["fonts"]):
        from xds import fonts
        try:
            for family in ("Satoshi", "General Sans"):
                fonts.fetch(root, family)
        except Exception as e:  # offline
            pytest.skip(f"the example's fonts could not be downloaded: {e}")
    return root


def test_render_audit_export(example):
    result = browser.render(example)
    assert result.contact_sheet and result.contact_sheet.exists()
    for s in result.slides:
        assert s.png.exists()
        m = SlideMeasure.model_validate_json(s.measure.read_text())
        assert m.width > 0 and set(m.layers) == {"ground", "render", "image", "type"}
        assert all((result.cache_dir / p).exists() for p in m.layers.values())

    report = export.audit(example)
    assert set(report.slides) == {s.slide_id for s in result.slides}
    assert (result.cache_dir / "audit.json").exists()

    out = export.export(example, force=True)
    record = json.loads((Path(out["dir"]) / "export.json").read_text())
    assert record["sourceHash"] == result.hash and len(record["files"]) == len(result.slides)
