"""Run every audit rule over the measured slides and write the report (design-rules §2, §6, §7).

The browser has already rendered and measured each slide into `cache_dir` (browser.py); this
module only reads those files.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable

import numpy as np

from ..models import AuditReport, AuditSummary, Finding, Project, SlideMeasure
from ..project import XdsError
from . import registry
from .annotate import annotate
from .measured import MeasuredSlide
from .thresholds import Thresholds, build

SEVERITY_ORDER = {"error": 0, "warn": 1, "info": 2}


def _waivers(slide, finding: Finding) -> str | None:
    """The reason a finding is waived: an exception on one of its nodes or on the slide."""
    by_id = {n.id: n for n in slide.nodes}
    sources = [by_id[i] for i in finding.nodes if i in by_id] + [slide]
    for src in sources:
        for e in src.exceptions or []:
            if e.rule == finding.rule:
                return e.reason
    return None


def _plain(v: Any) -> Any:
    """`v` with numpy scalars and arrays turned into Python values, so the report serializes."""
    if isinstance(v, (np.generic, np.ndarray)):
        return v.tolist()
    if isinstance(v, dict):
        return {k: _plain(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_plain(x) for x in v]
    return v


def audit_slide(ms: MeasuredSlide, t: Thresholds, off: set[str]) -> list[Finding]:
    out: list[Finding] = []
    for spec in registry.RULES.values():
        if spec.id in off:
            continue
        for hit in spec.fn(ms, t):
            severity = hit.severity or spec.severity
            f = Finding(
                rule=spec.id, family=spec.family, severity=severity, slide_id=ms.id,
                nodes=list(dict.fromkeys(hit.nodes)),
                region=hit.region.to_model() if hit.region else None,
                message=hit.message, measured=_plain(hit.measured), expected=_plain(hit.expected),
                fix=hit.fix, principle=spec.principle,
            )
            reason = _waivers(ms.slide, f)
            if reason:
                f.status = "waived"
                f.waiver = {"reason": reason}
            out.append(f)
    out.sort(key=lambda f: SEVERITY_ORDER[f.severity])  # stable: rule order within a severity
    return out


def load_measure(cache_dir: Path, slide_id: str) -> SlideMeasure:
    path = cache_dir / "measure" / f"{slide_id}.json"
    if not path.exists():
        raise XdsError("NOT_MEASURED", f"No measurements for slide '{slide_id}' ({path}); render it first.",
                       status=409)
    return SlideMeasure.model_validate(json.loads(path.read_text()))


def run(project: Project, cache_dir: Path, source_hash: str, *, slide_ids: list[str] | None = None,
        progress: Callable[[str], None] = lambda s: None) -> AuditReport:
    cache_dir = Path(cache_dir)
    t = build(project)
    off = set(project.rules.off) if project.rules else set()
    chosen = [(i + 1, s) for i, s in enumerate(project.slides) if slide_ids is None or s.id in slide_ids]

    findings: list[Finding] = []
    per_slide: list[tuple[int, MeasuredSlide, list[Finding]]] = []
    for position, slide in chosen:
        progress(f"audit {position}/{len(project.slides)} {slide.id}")
        ms = MeasuredSlide(project, slide, load_measure(cache_dir, slide.id), cache_dir, t, position)
        slide_findings = audit_slide(ms, t, off)
        findings += slide_findings
        per_slide.append((position, ms, slide_findings))

    summary = AuditSummary(
        errors=sum(f.status == "open" and f.severity == "error" for f in findings),
        warnings=sum(f.status == "open" and f.severity == "warn" for f in findings),
        infos=sum(f.status == "open" and f.severity == "info" for f in findings),
        waived=sum(f.status == "waived" for f in findings),
    )
    fmt = project.format
    report = AuditReport(
        source_hash=source_hash, format=fmt.preset or f"{fmt.width}x{fmt.height}",
        slides=[s.id for _, s in chosen], summary=summary, findings=findings,
    )

    numbers = {id(f): i + 1 for i, f in enumerate(findings)}
    for position, ms, slide_findings in per_slide:
        base = cache_dir / ms.measure.slide_png if ms.measure.slide_png else None
        out = cache_dir / "annotated" / f"{position}-{ms.id}.png"
        annotate(base, t.guide, [(numbers[id(f)], f) for f in slide_findings], out)

    (cache_dir / "audit.json").write_text(
        json.dumps(report.model_dump(mode="json", by_alias=True, exclude_none=True), indent=2) + "\n")
    progress(f"audit done: {summary.errors} errors, {summary.warnings} warnings, "
             f"{summary.infos} infos, {summary.waived} waived")
    return report
