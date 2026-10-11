"""`xds fix`: apply the audit's structured fixes to project.json (design-rules §6.1).

Every finding that names a concrete field value carries it as `edits` next to its `fix` text:
a dotted path on a node (`box.y`, `data.size`, `layout.stack.gap`), on the slide (`camera.height`,
`lighting.brightness`) or on the project (`screens.0.scale`). This module applies them in report
order through one validated write, after the big-save snapshot. Findings whose node is gone, or
whose path can't be reached, are skipped and listed.
"""

from __future__ import annotations

import copy
from pathlib import Path
from typing import Any, Callable

from pydantic import ValidationError

from . import project as proj
from .models import AuditReport, Edit, Finding, Project
from .project import PROJECT_FILE, XdsError, dumps, write_atomic

SEVERITY_RANK = {"error": 0, "warn": 1, "info": 2}
Progress = Callable[[str], None]


def _find_node(doc: dict[str, Any], slide_id: str | None, node_id: str) -> dict[str, Any] | None:
    slides = [s for s in doc.get("slides", []) if slide_id is None or s.get("id") == slide_id]
    for s in slides:
        for n in s.get("nodes") or []:
            if n.get("id") == node_id:
                return n
    for n in (doc.get("master") or {}).get("nodes") or []:
        if n.get("id") == node_id:
            return n
    return None


def _find_slide(doc: dict[str, Any], slide_id: str) -> dict[str, Any] | None:
    return next((s for s in doc.get("slides", []) if s.get("id") == slide_id), None)


def target_of(doc: dict[str, Any], edit: Edit) -> dict[str, Any] | None:
    """The object an edit's path starts from: its node, its slide, or the project."""
    if edit.node_id:
        return _find_node(doc, edit.slide_id, edit.node_id)
    if edit.slide_id:
        return _find_slide(doc, edit.slide_id)
    return doc


def apply_edit(doc: dict[str, Any], edit: Edit) -> tuple[Any, Any] | None:
    """Write `edit.value` at its path (in place). Returns (old, new), or None when the target or
    an intermediate list index is missing. Missing intermediate objects are created; a value of
    None deletes the key."""
    target = target_of(doc, edit)
    if target is None:
        return None
    parts = edit.path.split(".")
    cur: Any = target
    for key in parts[:-1]:
        if isinstance(cur, list):
            if not key.isdigit() or int(key) >= len(cur):
                return None
            cur = cur[int(key)]
            continue
        if not isinstance(cur, dict):
            return None
        if key not in cur or cur[key] is None:
            cur[key] = {}
        cur = cur[key]
    last = parts[-1]
    if isinstance(cur, list):
        if not last.isdigit() or int(last) >= len(cur):
            return None
        old = cur[int(last)]
        cur[int(last)] = edit.value
        return old, edit.value
    if not isinstance(cur, dict):
        return None
    old = cur.get(last)
    if edit.value is None:
        cur.pop(last, None)
    else:
        cur[last] = edit.value
    return old, edit.value


def select(report: AuditReport, *, slide_ids: list[str] | None = None, rules: list[str] | None = None,
           severity: str = "warn") -> list[Finding]:
    """The open findings with edits that the filters keep, in report order."""
    rank = SEVERITY_RANK[severity]
    return [f for f in report.findings
            if f.status == "open" and f.edits and SEVERITY_RANK[f.severity] <= rank
            and (not slide_ids or f.slide_id in slide_ids) and (not rules or f.rule in rules)]


def apply_findings(doc: dict[str, Any], findings: list[Finding]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Apply every finding's edits to `doc` in place. Returns (applied, skipped) records."""
    applied: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for f in findings:
        for e in f.edits or []:
            r = apply_edit(doc, e)
            rec = {"rule": f.rule, "slideId": e.slide_id, "nodeId": e.node_id, "path": e.path}
            if r is None:
                skipped.append({**rec, "why": "the node is gone" if e.node_id else "the path can't be reached"})
            else:
                applied.append({**rec, "old": r[0], "new": r[1]})
    return applied, skipped


def run(path: str | Path, *, slide_ids: list[str] | None = None, rules: list[str] | None = None,
        severity: str = "warn", dry_run: bool = False, progress: Progress = lambda s: None) -> dict[str, Any]:
    """Audit (or reuse the cached report), apply the selected findings' edits, write project.json."""
    from . import export, snapshots

    if severity not in SEVERITY_RANK:
        raise XdsError("USAGE", "severity is error, warn or info", status=2)
    root = proj.find_root(path)
    report = export.audit(root, progress=progress)
    chosen = select(report, slide_ids=slide_ids, rules=rules, severity=severity)
    before = proj.read_raw(root)
    doc = copy.deepcopy(before)
    applied, skipped = apply_findings(doc, chosen)
    written = False
    if applied and not dry_run:
        try:
            project = Project.model_validate(doc)
        except ValidationError as e:
            raise XdsError("VALIDATION_FAILED", "the fixes would leave the project invalid", status=422,
                           details=[f.model_dump(mode="json", by_alias=True, exclude_none=True)
                                    for f in proj.schema_findings(e, doc)]) from e
        snapshots.before_save(root, before, doc)
        project.updated_at = proj.now()
        write_atomic(root / PROJECT_FILE, dumps(project.to_json()))
        written = True
    return {"root": str(root), "findings": len(chosen), "applied": applied, "skipped": skipped,
            "written": written, "dryRun": dry_run,
            "withoutEdits": sum(1 for f in report.findings if f.status == "open" and not f.edits
                                and SEVERITY_RANK[f.severity] <= SEVERITY_RANK[severity]
                                and (not slide_ids or f.slide_id in slide_ids) and (not rules or f.rule in rules))}


def text(r: dict[str, Any]) -> str:
    lines = []
    for a in r["applied"]:
        where = a["nodeId"] or a["slideId"] or "project"
        lines.append(f"{a['rule']:<22} {where:<16} {a['path']:<22} {a['old']!r} → {a['new']!r}")
    for sk in r["skipped"]:
        lines.append(f"{sk['rule']:<22} {sk['nodeId'] or sk['slideId'] or 'project':<16} {sk['path']:<22} skipped: {sk['why']}")
    state = ("dry run, nothing written" if r["dryRun"] else "written" if r["written"] else "nothing to apply")
    tail = f"{len(r['applied'])} edit(s) from {r['findings']} finding(s); {state}"
    if r["withoutEdits"]:
        tail += f"; {r['withoutEdits']} finding(s) have no structured fix (read their fix text)"
    return "\n".join(lines + [tail])
