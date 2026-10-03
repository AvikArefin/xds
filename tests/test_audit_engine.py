"""Engine-level tests: exceptions, rules.off, rules.set, report, annotations, registry."""

from __future__ import annotations

import json

import numpy as np
import pytest

from tests.test_audit_kit import Case, rules_of
from xds.audit import registry
from xds.audit.contrast import apca_lc, hex_to_rgb, wcag_ratio
from xds.formats import derive
from xds.models import AuditReport, Format


def overlap_case(tmp_path, **text_kw) -> Case:
    c = Case(tmp_path)
    c.text("title", 64, 200, ["Big title"], size=72, widths=[400], **text_kw)
    c.text("price", 100, 230, ["$9 only"], size=40, level="subhead", widths=[200], weight=500)
    return c


def test_node_exception_waives(tmp_path):
    c = overlap_case(tmp_path, exceptions=[{"rule": "TEXT_OVERLAP", "reason": "Price stamp on purpose"}])
    report = c.run()
    f = rules_of(report, status="waived")["TEXT_OVERLAP"][0]
    assert f.waiver == {"reason": "Price stamp on purpose"}
    assert report.summary.waived >= 1 and report.summary.errors == 0


def test_slide_exception_waives(tmp_path):
    c = Case(tmp_path)
    c.text("title", 64, 200, ["Tiny"], size=40, widths=[200])
    report = c.run(slide_exceptions=[{"rule": "TEXT_TOO_SMALL", "reason": "Fine print"}])
    assert "TEXT_TOO_SMALL" in rules_of(report, status="waived")
    assert report.summary.errors == 0


def test_rules_off(tmp_path):
    report = overlap_case(tmp_path).run(rules={"off": ["TEXT_OVERLAP"]})
    assert "TEXT_OVERLAP" not in rules_of(report, status=None)


def test_rules_set_overrides(tmp_path):
    c = Case(tmp_path)
    words = "word " * 40
    c.text("body", 64, 300, [words[i * 60:(i + 1) * 60] for i in range(4)], size=37, level="body",
           widths=[900] * 4, source=words)
    assert "TOO_MANY_WORDS" in rules_of(c.run())
    assert "TOO_MANY_WORDS" not in rules_of(c.run(rules={"set": {"wordsPerSlide": 50}}))


def test_rules_set_subject_height(tmp_path):
    c = Case(tmp_path)
    c.product(480, 600, 120, 300)  # 22 % of the height
    assert "SUBJECT_TOO_SMALL" in rules_of(c.run())
    assert "SUBJECT_TOO_SMALL" not in rules_of(c.run(rules={"set": {"subject.height": [20, 85]}}))


def test_rules_set_margin_scales(tmp_path):
    c = Case(tmp_path)
    c.text("title", 40, 300, ["Edge"], size=72, widths=[200])
    assert "OUTSIDE_MARGIN" in rules_of(c.run())
    assert "OUTSIDE_MARGIN" not in rules_of(c.run(rules={"set": {"margin": 0.03}}))


def test_report_written_and_ordered(tmp_path):
    c = Case(tmp_path)
    c.text("title", 64, 200, ["Big title"], size=72, widths=[400])
    c.text("price", 100, 230, ["$9 only"], size=40, level="subhead", widths=[200], weight=500)
    c.text("tiny", 64, 900, ["Small headline"], size=50, widths=[300])
    report = c.run()
    sev = [f.severity for f in report.findings]
    assert sev == sorted(sev, key={"error": 0, "warn": 1, "info": 2}.get)
    assert report.slides == ["s1"] and report.source_hash == "hash123"
    assert report.format == "instagram-portrait"
    cache = tmp_path / "cache"
    data = json.loads((cache / "audit.json").read_text())
    assert AuditReport.model_validate(data).summary == report.summary
    assert data["findings"][0]["slideId"] == "s1" and "principle" in data["findings"][0]
    png = cache / "annotated" / "1-s1.png"
    assert png.exists() and png.stat().st_size > 0
    for f in report.findings:
        assert f.message and f.fix and f.principle and f.family


def test_slide_ids_filter(tmp_path):
    c = overlap_case(tmp_path)
    from xds.audit import engine

    report = engine.run(c.project(), c.write(), "h", slide_ids=[])
    assert report.findings == [] and report.slides == []


def test_registry_catalog_and_keys():
    names = registry.rule_names()
    assert {"TEXT_OVERLAP", "LOW_CONTRAST", "SUBJECT_TOO_SMALL", "WIDOW"} <= names
    assert "SCREEN_ASPECT_MISMATCH" not in names  # structural, checked by models3d
    keys = registry.threshold_keys()
    assert {"margin", "unit", "wordsPerSlide", "subject.height", "body.size"} <= keys
    guide = derive(Format(preset="instagram-portrait", width=1080, height=1350))
    cat = registry.catalog(guide)
    assert len(cat) == len(names)
    for entry in cat:
        assert entry["principle"] and entry["family"]
        for th in entry["thresholds"]:
            assert th["key"] in keys and th["why"]
    words = next(e for e in cat if e["rule"] == "TOO_MANY_WORDS")
    assert words["thresholds"][0]["value"] == 35
    small = next(e for e in cat if e["rule"] == "TEXT_TOO_SMALL")
    assert {"key": "headline.size", "value": [54, 97]}.items() <= next(
        t for t in small["thresholds"] if t["key"] == "headline.size").items()


def test_every_rule_family_documented():
    assert {s.family for s in registry.RULES.values()} == {
        "collision", "spacing", "type", "contrast", "composition", "subject"}


@pytest.mark.parametrize(("text", "bg", "lc"), [
    ("#888888", "#ffffff", 63.06), ("#ffffff", "#888888", -68.54),
    ("#000000", "#ffffff", 106.04), ("#ffffff", "#000000", -107.88),
])
def test_apca_reference_values(text, bg, lc):
    assert float(apca_lc(hex_to_rgb(text), hex_to_rgb(bg))) == pytest.approx(lc, abs=0.01)


def test_wcag_ratio():
    assert float(wcag_ratio(hex_to_rgb("#000000"), hex_to_rgb("#ffffff"))) == pytest.approx(21)
    assert float(wcag_ratio(np.array([0.5, 0.5, 0.5]), np.array([0.5, 0.5, 0.5]))) == pytest.approx(1)


def test_registry_import_is_cheap():
    import subprocess
    import sys

    code = "import sys; import xds.audit.registry; print('cv2' in sys.modules)"
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True)
    assert out.stdout.strip() == "False"
