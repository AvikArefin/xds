"""Targets: one source, several formats (data-models §2.5c, design-rules §1.4).

A target is the source project reflowed to another preset (`reflow.reflow`), written as a project
of its own under `cache/targets/<preset>/`: a `project.json`, a `target.json` record, and the
source's `designs/`, `screens/`, `assets/` and `fonts/` mirrored by hard link (copied when the
file system refuses), so every path stays valid. Render, audit and export then run on that root
exactly as on any project, the orientation's variants apply at render time, and an export lands
in the **source's** `export/<stamp>-<preset>/` with the record naming the source format.

`fluidity()` is the plan's success measure: reflow to one preset per orientation class the
source is not in, run the text-only rules on each, and report how well the deck survives.
"""

from __future__ import annotations

import json
import os
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from . import formats, project as proj
from .models import Format, orientation_of
from .project import PROJECT_FILE, SOURCE_DIRS, XdsError

TARGETS_DIR = "targets"
RECORD_FILE = "target.json"

# One preset per orientation class, for the fluidity check.
CLASS_PRESETS: dict[str, str] = {
    "portrait": "instagram-portrait",
    "square": "instagram-square",
    "landscape": "linkedin-landscape",
    "story": "instagram-story",
}

Progress = Callable[[str], None]


def preset_format(preset: str) -> Format:
    p = formats.CATALOG.get(preset)
    if p is None:
        raise XdsError("UNKNOWN_FORMAT", f"'{preset}' is not a format preset",
                       status=422, details={"presets": sorted(formats.CATALOG)})
    return Format(preset=p.key, width=p.width, height=p.height)


def target_root(root: Path, preset: str) -> Path:
    return root / "cache" / TARGETS_DIR / preset


def _link(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.unlink(missing_ok=True)
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def _mirror(src_dir: Path, dst_dir: Path) -> int:
    """Mirror a source directory into the target by hard links; stale files are dropped."""
    if dst_dir.exists():
        shutil.rmtree(dst_dir)
    n = 0
    for f in sorted(src_dir.rglob("*")):
        if f.is_file() and not f.name.startswith("."):
            _link(f, dst_dir / f.relative_to(src_dir))
            n += 1
    return n


def source_of(root: Path) -> dict[str, Any] | None:
    """The target record when `root` is a target, else None."""
    rec = root / RECORD_FILE
    if not rec.is_file():
        return None
    try:
        return json.loads(rec.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def build(path: str | Path, preset: str, *, progress: Progress = lambda s: None) -> dict[str, Any]:
    """Materialize the target for `preset` and return `{root, preset, format, orientation, report}`."""
    from . import reflow

    root = proj.find_root(path)
    if source_of(root):
        raise XdsError("TARGET_OF_TARGET", "a target can't be retargeted; use the source project", status=400)
    loaded = proj.load(root)
    project = loaded.require()
    fmt = preset_format(preset)
    if project.format.preset == preset and (project.format.width, project.format.height) == (fmt.width, fmt.height):
        raise XdsError("SAME_FORMAT", f"the project is already {preset}", status=400)
    progress(f"target {preset}: reflow")
    new, report = reflow.reflow(loaded.raw, fmt)
    troot = target_root(root, preset)
    troot.mkdir(parents=True, exist_ok=True)
    proj.write_atomic(troot / PROJECT_FILE, proj.dumps(new))
    files = 0
    for d in SOURCE_DIRS:
        if (root / d).is_dir():
            files += _mirror(root / d, troot / d)
    record = {
        "source": str(root), "sourceHash": loaded.hash, "preset": preset,
        "sourceFormat": project.format.preset or f"{project.format.width}x{project.format.height}",
        "orientation": orientation_of(fmt.width, fmt.height),
        "createdAt": datetime.now().isoformat(timespec="seconds"), "files": files,
    }
    (troot / RECORD_FILE).write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    progress(f"target {preset}: {troot}")
    return {"root": str(troot), "preset": preset, "format": fmt.model_dump(mode="json", exclude_none=True),
            "orientation": record["orientation"], "report": report}


def fluidity(path: str | Path, *, presets: list[str] | None = None,
             progress: Progress = lambda s: None) -> dict[str, Any]:
    """Reflow to one preset per orientation class the source is not in and run the text-only
    rules (`xds measure`) on each. Returns per target: preset, orientation, counts, findings."""
    from . import layout

    root = proj.find_root(path)
    project = proj.load(root).require()
    current = orientation_of(project.format.width, project.format.height)
    wanted = presets or [p for o, p in CLASS_PRESETS.items() if o != current]
    targets = []
    for preset in wanted:
        t = build(root, preset, progress=progress)
        progress(f"target {preset}: measure")
        report = layout.measure(t["root"], progress=progress)
        findings = [f for s in report["slides"] for f in s["findings"]]
        counts = {"errors": sum(f["severity"] == "error" for f in findings),
                  "warnings": sum(f["severity"] == "warn" for f in findings),
                  "infos": sum(f["severity"] == "info" for f in findings)}
        targets.append({"preset": preset, "orientation": t["orientation"], "root": t["root"],
                        **counts, "findings": findings})
    score = {"errors": sum(t["errors"] for t in targets), "warnings": sum(t["warnings"] for t in targets)}
    return {"root": str(root), "source": project.format.preset or f"{project.format.width}x{project.format.height}",
            "orientation": current, "targets": targets, "total": score}


def fluidity_text(r: dict[str, Any]) -> str:
    lines = [f"{r['source']} ({r['orientation']}) reflowed to {len(r['targets'])} target(s): "
             f"{r['total']['errors']} error(s), {r['total']['warnings']} warning(s) in all",
             f"{'preset':<22} {'class':<10} {'err':>4} {'warn':>5} {'info':>5}  first findings"]
    for t in r["targets"]:
        first = "; ".join(f"{f['rule']}: {f['message']}" for f in t["findings"][:3]) or "—"
        lines.append(f"{t['preset']:<22} {t['orientation']:<10} {t['errors']:>4} {t['warnings']:>5} {t['infos']:>5}  {first}")
    return "\n".join(lines)
