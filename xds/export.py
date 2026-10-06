"""Audit and export: render → measure → rules, then the gate that writes deliverables.

The deliverables are one PNG per slide, or with `format="pdf"` the deck as one PDF, a page per
slide (what LinkedIn takes for a carousel document post).

`audit()` reuses the report already in cache/<hash>/ when it covers every slide, so
`xds audit` followed by `xds export` renders and audits once.
"""

from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from . import browser, project as proj
from .models import AuditReport, ExportRecord, Finding
from .project import XdsError


def _structural_report(loaded: proj.Loaded) -> XdsError:
    return XdsError("CHECK_FAILED", f"{len(loaded.findings)} structural problem(s); fix them first "
                    "(`xds check`)", status=422,
                    details=[f.model_dump(mode="json", by_alias=True, exclude_none=True)
                             for f in loaded.findings])


def audit(path: str | Path, *, slide_ids: list[str] | None = None,
          progress: browser.Progress = lambda s: None) -> AuditReport:
    """check → render (cached) → rules → cache/<hash>/audit.json + annotated PNGs."""
    from .audit import engine

    progress("check")
    loaded = proj.load(path)
    if not loaded.ok:
        raise _structural_report(loaded)
    project = loaded.require()
    cache = loaded.root / "cache" / loaded.hash
    report_path = cache / "audit.json"
    if slide_ids is None and report_path.exists():
        cached = AuditReport.model_validate_json(report_path.read_text())
        if set(cached.slides) == {s.id for s in project.slides}:
            progress("audit: reusing the report for this source hash")
            return cached

    browser.render(loaded.root, slide_ids=slide_ids, progress=progress)
    progress("rules")
    report = engine.run(project, cache, loaded.hash, slide_ids=slide_ids, progress=progress)
    return report


def open_errors(report: AuditReport) -> list[Finding]:
    return [f for f in report.findings if f.severity == "error" and f.status == "open"]


def _write_pdf(pngs: list[Path], dest: Path) -> None:
    """The slides as one PDF, a page per slide at the slide's pixel size (JPEG q95 inside)."""
    from PIL import Image

    pages = [Image.open(p).convert("RGB") for p in pngs]
    try:
        pages[0].save(dest, "PDF", save_all=True, append_images=pages[1:], quality=95,
                      title=dest.stem)
    finally:
        for page in pages:
            page.close()


def export(path: str | Path, *, out: str | Path | None = None, force: bool = False,
           format: Literal["png", "pdf"] = "png", progress: browser.Progress = lambda s: None) -> dict[str, Any]:
    """The audit gate, then write the rendered slides to export/<stamp>/ (as PNGs, or as one PDF)
    with export.json."""
    loaded = proj.load(path, deep=False)
    root = loaded.root
    report = audit(root, progress=progress)
    errors = open_errors(report)
    if errors and not force:
        raise XdsError("EXPORT_BLOCKED", f"{len(errors)} open error(s) block the export; fix them, "
                       "waive them with a reason, or pass --force", status=409,
                       details=[f.model_dump(mode="json", by_alias=True, exclude_none=True) for f in errors])

    project = proj.load(root, deep=False).require()
    cache = root / "cache" / report.source_hash
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = Path(out).expanduser().resolve() if out else root / "export" / stamp
    dest.mkdir(parents=True, exist_ok=True)
    pngs = []
    for i, slide in enumerate(project.slides, start=1):
        src = cache / "slides" / browser.slide_png_name(i, slide.id)
        if not src.exists():
            raise XdsError("RENDER_MISSING", f"no rendered PNG for slide '{slide.id}'", status=500)
        pngs.append(src)
    if format == "pdf":
        files = [f"{project.id}.pdf"]
        _write_pdf(pngs, dest / files[0])
    else:
        files = [src.name for src in pngs]
        for src in pngs:
            shutil.copy2(src, dest / src.name)
    for name in files:
        progress(f"export {name}")

    record = ExportRecord(
        source_hash=report.source_hash,
        format=project.format.preset or f"{project.format.width}x{project.format.height}",
        files=files,
        audit={"errors": report.summary.errors, "warnings": report.summary.warnings,
               "infos": report.summary.infos, "waived": report.summary.waived},
        forced=bool(force and errors),
    )
    (dest / "export.json").write_text(
        json.dumps(record.model_dump(mode="json", by_alias=True), indent=2) + "\n")
    return {"dir": str(dest), "files": [str(dest / f) for f in files],
            "record": record.model_dump(mode="json", by_alias=True)}


def list_exports(root: Path) -> list[dict[str, Any]]:
    base = root / "export"
    out = []
    if base.is_dir():
        for d in sorted(base.iterdir(), reverse=True):
            rec = d / "export.json"
            if d.is_dir() and rec.exists():
                record = json.loads(rec.read_text())
                out.append({"stamp": d.name, "dir": str(d), "record": record,
                            "files": [f"/api/files/export/{d.name}/{f}" for f in record.get("files", [])]})
    return out
