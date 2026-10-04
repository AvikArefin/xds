"""`xds migrate`: upgrade a project's `project.json` to the current schema (data-models §6).

Two passes: the explicit version steps (`migrate/steps/`), then the conform pass
(`migrate/conform.py`). Nothing is written when anything is unresolved, on `dry_run`, or when the
file is already canonical. Before writing, the old file is copied to
`.migrate-backup/<YYYYMMDD-HHMMSS>/project.json`.
"""

from __future__ import annotations

import difflib
import json
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

from ..models import SCHEMA_VERSION
from . import conform as conform_pass
from .conform import Report
from .steps import registry

BACKUP_DIR = ".migrate-backup"


def upgrade(doc: dict[str, Any], report: Report) -> dict[str, Any] | None:
    """Apply the explicit steps from the document's version up to SCHEMA_VERSION."""
    version = doc.get("schemaVersion", 1)
    if isinstance(version, str) and re.fullmatch(r"\d+(\.0+)?", version):
        version = int(float(version))  # v1 files say "1.0"
    if not isinstance(version, int) or version < 1:
        report.unresolve("schemaVersion", f"schemaVersion {version!r} is not a positive integer")
        return None
    if version > SCHEMA_VERSION:
        report.unresolve("schemaVersion", f"schemaVersion {version} is newer than this XDS "
                         f"({SCHEMA_VERSION}); update XDS instead")
        return None
    steps = registry()
    for target in range(version + 1, SCHEMA_VERSION + 1):
        if target not in steps:
            report.unresolve("schemaVersion", f"no migration step from version {target - 1} to "
                             f"{target} (support for v{target - 1} files is not implemented)")
            return None
        name, fn = steps[target]
        doc = fn(dict(doc), report)
        doc["schemaVersion"] = target
        report.steps.append(name)
    return doc


def run(root: Path, *, dry_run: bool = False, conform_only: bool = False) -> dict[str, Any]:
    """Migrate one project. Returns the report (see `Report.to_json`) plus `diff`, `backup`,
    `written`, `changed`, `fromVersion`, `toVersion`, `ok`."""
    from ..project import PROJECT_FILE, dumps, find_root, read_raw, write_atomic

    root = find_root(root)
    path = root / PROJECT_FILE
    before_text = path.read_text(encoding="utf-8")
    raw = read_raw(root)
    report = Report()
    from_version = raw.get("schemaVersion") if isinstance(raw, dict) else None

    doc: dict[str, Any] | None = raw if isinstance(raw, dict) else None
    if doc is None:
        report.unresolve("$", "project.json is not a JSON object")
    elif conform_only:
        if from_version != SCHEMA_VERSION:
            report.unresolve("schemaVersion", f"--conform needs schemaVersion {SCHEMA_VERSION}; "
                             f"this file is {from_version!r} (run a full migrate)")
            doc = None
    else:
        doc = upgrade(_with_side_files(root, doc), report)
    result = conform_pass.conform(doc, report) if doc is not None and not report.unresolved else None

    after_text = dumps(result) if result is not None else before_text
    changed = after_text != before_text
    diff = "".join(difflib.unified_diff(
        before_text.splitlines(keepends=True), after_text.splitlines(keepends=True),
        fromfile="project.json (before)", tofile="project.json (after)"))
    backup = None
    written = False
    if result is not None and changed and not dry_run:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        bdir = root / BACKUP_DIR / stamp
        k = 2
        while bdir.exists():
            bdir, k = root / BACKUP_DIR / f"{stamp}-{k}", k + 1
        bdir.mkdir(parents=True)
        shutil.copy2(path, bdir / PROJECT_FILE)
        write_atomic(path, after_text)
        for rel in report.retire:
            src = root / rel
            if src.is_file():
                (bdir / rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(src), bdir / rel)
        for rel, text in report.files.items():
            target = root / rel
            if target.exists():
                (bdir / rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(target, bdir / rel)
            write_atomic(target, text)
        backup, written = (bdir / PROJECT_FILE).relative_to(root).as_posix(), True
        _fetch_fonts(root, report)
    return {"root": str(root), "ok": not report.unresolved, "fromVersion": from_version,
            "toVersion": SCHEMA_VERSION if result is not None else from_version,
            "dryRun": dry_run, "changed": changed, "written": written, "backup": backup,
            **report.to_json(), "diff": diff}


def _with_side_files(root: Path, doc: dict[str, Any]) -> dict[str, Any]:
    """v1 kept the 3D scene in scene-data.json and the step may rewrite designs: hand both to the
    (pure) steps inside the document. Later versions keep everything in project.json."""
    version = doc.get("schemaVersion", 1)
    if version not in (1, "1", "1.0"):
        return doc
    scene_file = root / "scene-data.json"
    try:
        scene = json.loads(scene_file.read_text(encoding="utf-8")) if scene_file.is_file() else None
    except ValueError:
        scene = None
    designs = {p.stem: p.read_text(encoding="utf-8") for p in sorted((root / "designs").glob("*.svg"))}
    return {**doc, "__sceneData": scene, "__designs": designs}


def _fetch_fonts(root: Path, report: Report) -> None:
    """Download the families the roles name but the project has no files for (v1 loaded fonts
    from Fontshare at runtime; v2 renders from files). Failures are notes, not errors: the
    gate then reports UNKNOWN_FONT and `xds fonts fetch` can be retried."""
    from .. import fonts
    from ..project import XdsError, read_raw

    have = {f.get("family") for f in read_raw(root).get("fonts") or []}
    for family in report.fonts:
        if family in have:
            continue
        try:
            got = fonts.fetch(root, family)
            report.notes.append(f"fetched font '{family}' from Fontshare ({len(got)} styles)")
        except XdsError as e:
            report.notes.append(f"couldn't fetch font '{family}': {e.message} "
                                f"(retry with `xds fonts fetch . \"{family}\"`)")


def run_all(projects_dir: Path, **kw: Any) -> list[dict[str, Any]]:
    """Migrate every project directly under `projects_dir` (folders with a project.json)."""
    from ..project import PROJECT_FILE, XdsError

    out = []
    for d in sorted(Path(projects_dir).expanduser().iterdir()):
        if (d / PROJECT_FILE).is_file():
            try:
                out.append(run(d, **kw))
            except XdsError as e:  # e.g. invalid JSON: report it and carry on
                out.append({"root": str(d), "ok": False, "written": False,
                            "unresolved": [{"rule": e.code, "path": "$", "message": e.message}]})
    return out


__all__ = ["run", "run_all", "upgrade", "Report"]
