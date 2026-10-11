"""Snapshots: copies of a project's source text under `.snapshots/`, to restore from.

A snapshot holds `project.json` and the text sources that go with it (`designs/`, `screens/`),
never the assets, fonts or models (those are referenced and rarely change). One is taken:

- by hand: `xds snapshot PROJECT --label "before the big rewrite"`;
- automatically, before a **big save** replaces project.json: a format change, a slide added or
  removed, or more than a quarter of the nodes changed (`AUTO_KEEP` of those are kept; labelled
  ones stay until deleted);
- before a restore, so a restore is itself reversible.

`xds restore PROJECT ID` puts one back. Migrate backups (`.migrate-backup/`) are listed next to
them, so an older project can be brought back the same way.
"""

from __future__ import annotations

import json
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

SNAPSHOT_DIR = ".snapshots"
MIGRATE_BACKUP_DIR = ".migrate-backup"
RECORD_FILE = "snapshot.json"
COPIED_DIRS = ("designs", "screens")
AUTO_KEEP = 20
BIG_NODE_SHARE = 0.25


# --- what counts as big -----------------------------------------------------------------------

def summarize(doc: Any) -> dict[str, Any]:
    """The few numbers a list shows: name, format, slides, nodes."""
    if not isinstance(doc, dict):
        return {}
    fmt = doc.get("format") if isinstance(doc.get("format"), dict) else {}
    slides = doc.get("slides") if isinstance(doc.get("slides"), list) else []
    nodes = sum(len(s.get("nodes") or []) for s in slides if isinstance(s, dict))
    return {
        "name": doc.get("name"),
        "schemaVersion": doc.get("schemaVersion"),
        "format": {k: fmt.get(k) for k in ("preset", "width", "height") if fmt.get(k) is not None},
        "slides": len(slides),
        "nodes": nodes,
    }


def _nodes(doc: Any) -> dict[str, str]:
    out: dict[str, str] = {}
    if not isinstance(doc, dict):
        return out
    for s in doc.get("slides") or []:
        if not isinstance(s, dict):
            continue
        for n in s.get("nodes") or []:
            if isinstance(n, dict) and isinstance(n.get("id"), str):
                out[n["id"]] = json.dumps(n, sort_keys=True)
    return out


def big_change(before: Any, after: Any) -> str | None:
    """Why a save is big (one short phrase), or None when it is an ordinary edit."""
    if not isinstance(before, dict) or not isinstance(after, dict):
        return None
    if before.get("format") != after.get("format"):
        return "format changed"
    a = len(before.get("slides") or [])
    b = len(after.get("slides") or [])
    if b > a:
        return f"{b - a} slide{'s' if b - a > 1 else ''} added"
    if b < a:
        return f"{a - b} slide{'s' if a - b > 1 else ''} removed"
    old, new = _nodes(before), _nodes(after)
    changed = sum(1 for k, v in old.items() if new.get(k) != v) + sum(1 for k in new if k not in old)
    total = max(len(old), 1)
    if old and changed / total > BIG_NODE_SHARE:
        return f"{changed} of {len(old)} nodes changed"
    return None


# --- records -----------------------------------------------------------------------------------

def _slug(text: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", text.lower())).strip("-")[:40]


def _read(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _record_of(root: Path, d: Path) -> dict[str, Any] | None:
    """The record of a snapshot or migrate-backup directory, or None when it holds no project."""
    pj = d / "project.json"
    if not pj.is_file():
        return None
    rec = _read(d / RECORD_FILE) if (d / RECORD_FILE).is_file() else None
    if not isinstance(rec, dict):
        stamp = d.name[:15]
        try:
            created = datetime.strptime(stamp, "%Y%m%d-%H%M%S").isoformat(timespec="seconds")
        except ValueError:
            created = datetime.fromtimestamp(pj.stat().st_mtime).isoformat(timespec="seconds")
        rec = {"id": d.name, "createdAt": created, "label": None,
               "reason": "migrate" if d.parent.name == MIGRATE_BACKUP_DIR else "manual",
               "summary": summarize(_read(pj))}
    rec["id"] = d.name
    rec["dir"] = d.relative_to(root).as_posix()
    rec["migrateBackup"] = d.parent.name == MIGRATE_BACKUP_DIR
    return rec


def list_snapshots(root: Path) -> list[dict[str, Any]]:
    """Every snapshot (and migrate backup), newest first."""
    out: list[dict[str, Any]] = []
    for base in (root / SNAPSHOT_DIR, root / MIGRATE_BACKUP_DIR):
        if not base.is_dir():
            continue
        for d in base.iterdir():
            if d.is_dir():
                rec = _record_of(root, d)
                if rec:
                    out.append(rec)
    # Same-second snapshots (a restore's safety copy right after a take) order by creation.
    return sorted(out, key=lambda r: (r.get("createdAt") or "", (root / r["dir"]).stat().st_mtime_ns),
                  reverse=True)


def _find(root: Path, snapshot_id: str) -> Path:
    from .project import XdsError

    if not snapshot_id or "/" in snapshot_id or snapshot_id in (".", ".."):
        raise XdsError("UNKNOWN_SNAPSHOT", f"no snapshot '{snapshot_id}'", status=404)
    for base in (root / SNAPSHOT_DIR, root / MIGRATE_BACKUP_DIR):
        d = base / snapshot_id
        if (d / "project.json").is_file():
            return d
    raise XdsError("UNKNOWN_SNAPSHOT", f"no snapshot '{snapshot_id}'", status=404)


# --- take / restore / delete -------------------------------------------------------------------

def take(root: Path, *, label: str | None = None, reason: str = "manual") -> dict[str, Any]:
    """Copy project.json, designs/ and screens/ into a new snapshot directory and return its record."""
    from .project import PROJECT_FILE, XdsError, find_root

    root = find_root(root)
    src = root / PROJECT_FILE
    if not src.is_file():
        raise XdsError("NO_PROJECT", f"no {PROJECT_FILE} in {root}", status=404)
    label = (label or "").strip() or None
    now = datetime.now()
    stamp = now.strftime("%Y%m%d-%H%M%S")
    base = root / SNAPSHOT_DIR
    base.mkdir(exist_ok=True)
    name = f"{stamp}-{_slug(label)}" if label and _slug(label) else stamp
    d, k = base / name, 2
    while d.exists():
        d, k = base / f"{name}-{k}", k + 1
    d.mkdir()
    shutil.copy2(src, d / PROJECT_FILE)
    for sub in COPIED_DIRS:
        if (root / sub).is_dir():
            shutil.copytree(root / sub, d / sub, ignore=shutil.ignore_patterns(".*"))
    rec = {"id": d.name, "createdAt": now.isoformat(timespec="seconds"), "label": label,
           "reason": reason, "summary": summarize(_read(src))}
    (d / RECORD_FILE).write_text(json.dumps(rec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    if reason.startswith("auto"):
        prune(root)
    return _record_of(root, d) or rec


def prune(root: Path, keep: int | None = None) -> list[str]:
    """Drop the oldest automatic snapshots past `keep` (default `AUTO_KEEP`). Labelled, manual and
    safety ones stay."""
    keep = AUTO_KEEP if keep is None else keep
    auto = [r for r in list_snapshots(root)
            if not r["migrateBackup"] and str(r.get("reason", "")).startswith("auto") and not r.get("label")]
    gone = []
    for r in auto[keep:]:
        shutil.rmtree(root / SNAPSHOT_DIR / r["id"], ignore_errors=True)
        gone.append(r["id"])
    return gone


def restore(root: Path, snapshot_id: str) -> dict[str, Any]:
    """Put a snapshot back (project.json, designs/, screens/), after snapshotting the current state."""
    from .project import PROJECT_FILE, find_root, project_file_hash, source_hash, write_atomic

    root = find_root(root)
    d = _find(root, snapshot_id)
    rec = _record_of(root, d) or {"id": snapshot_id}
    safety = take(root, label=None, reason=f"before restore of {snapshot_id}")
    write_atomic(root / PROJECT_FILE, (d / PROJECT_FILE).read_text(encoding="utf-8"))
    files = 1
    for sub in COPIED_DIRS:
        if (d / sub).is_dir():
            for f in (d / sub).rglob("*"):
                if f.is_file():
                    target = root / sub / f.relative_to(d / sub)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(f, target)
                    files += 1
    return {"restored": rec, "safety": safety, "files": files,
            "hash": source_hash(root), "fileHash": project_file_hash(root)}


def delete(root: Path, snapshot_id: str) -> dict[str, Any]:
    from .project import XdsError, find_root

    root = find_root(root)
    d = _find(root, snapshot_id)
    if d.parent.name == MIGRATE_BACKUP_DIR:
        raise XdsError("MIGRATE_BACKUP", "migrate backups are kept; delete the folder by hand if you must",
                       status=400)
    shutil.rmtree(d)
    return {"deleted": snapshot_id}


def before_save(root: Path, before: Any, after: Any) -> dict[str, Any] | None:
    """Snapshot the current file when `after` is a big change over `before`. Returns the record."""
    why = big_change(before, after)
    if not why:
        return None
    return take(root, reason=f"auto: {why}")
