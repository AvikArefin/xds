"""`xds`: the stable automation interface (architecture §3.2).

Every command calls the same functions as the HTTP API, reads the saved source only, and accepts
`--json` for machine-readable output. Exit status: 0 success, 1 failure or open errors, 2 usage.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import webbrowser
from pathlib import Path
from typing import Any

from . import formats, project as proj
from .project import XdsError

REPO = Path(__file__).resolve().parent.parent


class Out:
    """Prints either human text or one JSON document."""

    def __init__(self, as_json: bool):
        self.as_json = as_json

    def emit(self, data: Any, text: str | None = None) -> None:
        if self.as_json:
            print(json.dumps({"ok": True, **data} if isinstance(data, dict) else data,
                             indent=2, ensure_ascii=False, default=str))
        elif text is not None:
            print(text)

    def line(self, text: str) -> None:
        """Progress: stderr, so `--json` output stays a single document on stdout."""
        print(text, file=sys.stderr, flush=True)


def dump(model: Any) -> Any:
    return model.model_dump(mode="json", by_alias=True, exclude_none=True)


def findings_text(findings: list[dict[str, Any]]) -> str:
    lines = []
    for f in findings:
        where = f.get("slideId") or f.get("path") or ""
        status = " (waived)" if f.get("status") == "waived" else ""
        lines.append(f"  {f['severity']:<5} {f['rule']:<24} {where}{status}")
        lines.append(f"        {f['message']}")
        if f.get("fix"):
            lines.append(f"        fix: {f['fix']}")
        if f.get("waiver"):
            lines.append(f"        reason: {f['waiver'].get('reason')}")
    return "\n".join(lines)


# --- commands ----------------------------------------------------------------------------------

def cmd_init(a: argparse.Namespace, out: Out) -> int:
    size = None
    if a.size:
        if a.format:
            raise XdsError("USAGE", "Give --format or --size, not both.", status=2)
        try:
            size = formats.parse_size(a.size)
        except ValueError as e:
            raise XdsError("USAGE", str(e), status=2) from e
    root = proj.init(a.project, name=a.name, preset=a.format or "instagram-portrait", size=size)
    fmt = proj.read_raw(root)["format"]
    text = (f"created {root} ({fmt.get('preset') or 'custom'} {fmt['width']}×{fmt['height']}, "
            f"{formats.aspect_label(fmt['width'], fmt['height'])})")
    data: dict[str, Any] = {"root": str(root), "format": fmt}
    if a.layout:
        from . import fonts, layouts

        # The template has no font. A family already in the font library is registered offline;
        # otherwise the new roles name Satoshi and the report says to fetch it.
        known = next(iter(fonts.library_families().values()), None)
        if known:
            fonts.fetch(root, known["name"])
        report = layouts.apply_project(root, a.layout, slide="s1", mode="replace", add_roles=True,
                                       font_fallback="Satoshi")
        data["layout"] = report
        text += "\n" + layouts.report_text(report)
    out.emit(data, text)
    return 0


AGENTS_MD_NOTE = ("note: this project's AGENTS.md is from an older xds and misses newer commands; "
                  "`xds migrate .` updates it (the old one goes to .migrate-backup/). Then read it again.")


def agents_md_current(root: Path) -> bool:
    from .migrate import agents_md_current as current

    return current(root)


def cmd_check(a: argparse.Namespace, out: Out) -> int:
    loaded = proj.load(a.project)
    findings = [dump(f) for f in loaded.findings]
    text = (f"ok: {loaded.root} ({loaded.hash})" + (f", {len(findings)} warning(s)\n" + findings_text(findings)
                                                      if findings else "")) if loaded.ok else (
        f"{len(findings)} problem(s) in {loaded.root}\n" + findings_text(findings))
    current = agents_md_current(loaded.root)
    if not current:
        text += "\n" + AGENTS_MD_NOTE
    out.emit({"valid": loaded.ok, "hash": loaded.hash, "findings": findings, "agentsMdCurrent": current}, text)
    return 0 if loaded.ok else 1


def cmd_guide(a: argparse.Namespace, out: Out) -> int:
    loaded = proj.load(a.project, deep=False)
    project = loaded.require()
    sets = project.rules.set if project.rules else None
    guide = formats.derive(project.format, sets)
    from .audit.thresholds import Thresholds

    t = Thresholds(guide, sets)
    data: dict[str, Any] = {"guide": {**guide.to_json(), "aspect": formats.aspect_label(guide.width, guide.height),
                                      "contrast": t.contrast_bands()}}
    expression = project.brand.expression
    if expression is not None:
        data["guide"]["expression"] = expression.model_dump(mode="json", by_alias=True, exclude_none=True)
    text = formats.format_guide_text(guide, t.contrast_text(),
                                     formats.expression_text(expression) if expression else None)
    if a.slide:
        measured = slide_measured(loaded.root, project, a.slide, guide, out)
        data["slide"] = measured
        text += "\n\nslide " + a.slide + "\n" + "\n".join(
            f"  {m['name']:<20} {m['level'] or '?':<9} size {m['size']:<6} target {m['target']}"
            f"{'  ← outside' if m['outside'] else ''}" for m in measured["type"])
        if measured.get("subjectHeight") is not None:
            text += f"\n  subject height {measured['subjectHeight']}% (target 30–75%)"
    if not agents_md_current(loaded.root):
        data["agentsMdCurrent"] = False
        text += "\n\n" + AGENTS_MD_NOTE
    out.emit(data, text)
    return 0


def slide_measured(root: Path, project: Any, slide_id: str, guide: formats.Guide, out: Out) -> dict[str, Any]:
    from . import browser
    from .models import SlideMeasure

    result = browser.render(root, slide_ids=[slide_id], progress=out.line, sheet=False)
    measure = SlideMeasure.model_validate_json(result.slides[0].measure.read_text())
    slide = project.slide(slide_id)
    names = {n.id: n.name or n.id for n in slide.nodes}
    rows = []
    for n in measure.nodes:
        if n.layer != "type" or not n.style:
            continue
        band = guide.bands.get(n.level or "")
        size = round(n.style.size, 1)
        rows.append({"id": n.id, "name": names.get(n.id, n.id), "level": n.level, "size": size,
                     "target": f"{band.min}–{band.max} (default {band.default})" if band else "?",
                     "outside": bool(band and not band.min <= size <= band.max)})
    subject = round(100 * measure.subject.bounds.h / measure.height, 1) if measure.subject else None
    return {"type": rows, "subjectHeight": subject}


def cmd_measure(a: argparse.Namespace, out: Out) -> int:
    from . import layout

    report = layout.measure(a.project, slide_ids=a.slide or None, progress=out.line)
    out.emit(report, layout.text(report))
    return 0


def cmd_rules(a: argparse.Namespace, out: Out) -> int:
    from .audit import registry
    from .models import Format

    sets = None
    if a.project:
        p = proj.load(a.project, deep=False).require()
        sets = p.rules.set if p.rules else None
        guide = formats.derive(p.format, sets)
    else:
        guide = formats.derive(Format(preset="instagram-portrait", width=1080, height=1350))
    rules = registry.catalog(guide, sets)
    text = []
    for r in rules:
        text.append(f"{r['rule']:<26} {r['family']:<12} {r['severity']:<10} {r['principle']}")
        if r.get("thresholds"):
            text.append(" " * 51 + ", ".join(f"{t['key']}={t['value']}" for t in r["thresholds"]))
    out.emit({"format": guide.preset, "rules": rules, "thresholdKeys": sorted(registry.threshold_keys())},
             "\n".join(text))
    return 0


def cmd_render(a: argparse.Namespace, out: Out) -> int:
    from . import browser

    result = browser.render(a.project, slide_ids=[a.slide] if a.slide else None, progress=out.line)
    text = "\n".join(str(s.png) for s in result.slides)
    if result.contact_sheet:
        text += f"\ncontact sheet: {result.contact_sheet}"
    out.emit(result.to_json(), text)
    return 0


def cmd_audit(a: argparse.Namespace, out: Out) -> int:
    from . import export

    report = export.audit(a.project, slide_ids=[a.slide] if a.slide else None, progress=out.line)
    data = dump(report)
    root = proj.find_root(a.project)
    cache = root / "cache" / report.source_hash
    s = report.summary
    text = (f"{s.errors} error(s), {s.warnings} warning(s), {s.infos} info, {s.waived} waived\n"
            + findings_text(data["findings"])
            + f"\nreport: {cache / 'audit.json'}\nannotated: {cache / 'annotated'}")
    out.emit({"report": data, "cacheDir": str(cache)}, text)
    return 1 if export.open_errors(report) else 0


def cmd_fix(a: argparse.Namespace, out: Out) -> int:
    from . import fix

    r = fix.run(a.project, slide_ids=a.slide or None, rules=a.rule or None, severity=a.severity,
                dry_run=a.dry_run, progress=out.line)
    out.emit(r, fix.text(r))
    return 0 if r["applied"] else 1


def cmd_export(a: argparse.Namespace, out: Out) -> int:
    from . import export

    result = export.export(a.project, out=a.out, force=a.force, format="pdf" if a.pdf else "png",
                           progress=out.line)
    forced = " (forced past open errors)" if result["record"]["forced"] else ""
    out.emit(result, f"exported {len(result['files'])} file(s) to {result['dir']}{forced}")
    return 0


def cmd_migrate(a: argparse.Namespace, out: Out) -> int:
    from . import migrate

    if a.all:
        reports = migrate.run_all(projects_dir(), dry_run=a.dry_run, conform_only=a.conform)
    else:
        if not a.project:
            raise XdsError("USAGE", "give a PROJECT or --all", status=2)
        reports = [migrate.run(proj.find_root(a.project), dry_run=a.dry_run, conform_only=a.conform)]
    text = "\n\n".join(migrate_text(r, show_diff=a.dry_run) for r in reports)
    out.emit({"reports": reports}, text)
    return 1 if any(r.get("unresolved") for r in reports) else 0


def migrate_text(r: dict[str, Any], *, show_diff: bool) -> str:
    state = ("written, backup " + r["backup"]) if r.get("written") else (
        "unchanged" if not r.get("changed") else "not written")
    lines = [f"{r['root']}: {r.get('fromVersion')} → {r.get('toVersion')} ({state})"]
    for key in ("steps", "renamed", "defaulted", "dropped", "unresolved", "notes"):
        for item in r.get(key) or []:
            lines.append(f"  {key:<10} {json.dumps(item, ensure_ascii=False, default=str)}")
    if show_diff and r.get("diff"):
        lines.append(r["diff"])
    return "\n".join(lines)


def cmd_model(a: argparse.Namespace, out: Out) -> int:
    from . import models3d

    if a.model_cmd == "inspect":
        info = models3d.inspect(Path(a.file))
        out.emit({"model": info}, model_size_text(info) + "\n" + json.dumps(info, indent=2, default=str))
        return 0
    if a.model_cmd == "library":
        from . import library

        items = library.models()
        out.emit({"models": items}, "\n".join(
            f"{m['id']:<16} {m['name']}  ({m['bytes'] / 1e6:.1f} MB)\n{'':<16} {m['description']}\n"
            f"{'':<16} screens: " + ", ".join(f"{k} → --device {v['device']}" for k, v in m["screens"].items())
            for m in items))
        return 0
    root = proj.find_root(a.project)
    if a.model_cmd == "vendor":
        result = models3d.vendor(root, a.id)
        out.emit({"result": result}, f"copied {result['from']} to {result['path']}")
        return 0
    if bool(a.file) == bool(a.library):
        raise proj.XdsError("USAGE", "Give a FILE or --library ID (one of them).", status=2)
    if a.library and (a.front or a.height or a.scale or a.ground):
        raise proj.XdsError("USAGE", "Library models already follow the conventions; --front, "
                            "--height, --scale and --ground are for your own files.", status=2)
    if a.library:
        result = models3d.add_library(root, a.library, id=a.id, name=a.name, slide=a.slide,
                                      screen=a.screen, replace=a.replace)
        out.emit({"result": result}, f"added library model '{a.library}' as '{result['id']}'"
                 + (f" on {a.slide} (node {result['node']})" if result["node"] else ""))
        return 0
    if not a.id:
        raise proj.XdsError("USAGE", "--id is required when adding a file.", status=2)
    if a.screen:
        raise proj.XdsError("USAGE", "--screen works with --library; for a file, set the node's "
                            "data.screens in project.json.", status=2)
    front = a.front or ("+z" if a.ground else None)  # --ground alone: no turn, no scale
    result = models3d.add(root, Path(a.file), id=a.id, name=a.name, slide=a.slide, replace=a.replace,
                          front=front, height=a.height, scale=a.scale)
    warnings = result.get("warnings") or []
    norm = result.get("normalized")
    text = f"added model '{a.id}'" + (
        f" (turned from {norm['front']} to face +Z, scaled ×{norm['scale']:g}, origin at the bottom center)"
        if norm else "") + "\n  " + model_size_text(result["inspection"]) + "".join(
        f"\n  warn {w.get('code', '')}: {w.get('message', w)}" if isinstance(w, dict) else f"\n  warn {w}"
        for w in warnings)
    out.emit({"result": result}, text)
    return 0


FRONT_WORDS = {"forward": "+z", "back": "-z", "backward": "-z", "right": "+x", "left": "-x",
               "up": "+y", "down": "-y"}


def front_axis(text: str) -> str:
    v = text.strip().lower()
    v = FRONT_WORDS.get(v, v if v[:1] in "+-" else "+" + v)
    if v not in ("+z", "-z", "+x", "-x", "+y", "-y"):
        raise argparse.ArgumentTypeError(f"'{text}': use back, left, right, up, down or forward "
                                         "(or an axis: --front=-z)")
    return v


def model_size_text(info: dict[str, Any]) -> str:
    b = info.get("bounds")
    if not b:
        return "size: no geometry"
    w, h, d = b["size"]
    return (f"size {w:.3g} × {h:.3g} × {d:.3g} m (w × h × d), lowest point y = {b['min'][1]:.3g}. "
            "Is that the real product? If not, or if its front doesn't face +Z, re-add it with "
            "--height <real height in m> and --front <where it faces now: back, left, right, up, down>.")


def cmd_screen(a: argparse.Namespace, out: Out) -> int:
    from . import screens

    root = proj.find_root(a.project)
    if a.screen_cmd == "add":
        orientation = f"landscape-{a.landscape}" if a.landscape else None
        result = screens.add(root, a.id, device=a.device, width=a.width, height=a.height, scale=a.scale,
                             orientation=orientation)
        out.emit({"screen": result}, f"created screens/{a.id}/index.html ({result['width']:g}×{result['height']:g}"
                 + (f", {orientation}: turn the device with pose rotation z = "
                    f"{90 if a.landscape == 'left' else -90}" if orientation else "") + ")")
        return 0
    loaded = proj.load(root, deep=False)
    dest = root / "cache" / loaded.hash / "screens" / f"{a.id}.png"
    dest.parent.mkdir(parents=True, exist_ok=True)
    png = screens.render(root, a.id, dest)
    out.emit({"png": str(png)}, str(png))
    return 0


def cmd_design(a: argparse.Namespace, out: Out) -> int:
    from . import designs

    design_id = designs.add_starter(proj.find_root(a.project), a.starter)
    out.emit({"id": design_id}, f"added designs/{design_id}.svg")
    return 0


def cmd_fonts(a: argparse.Namespace, out: Out) -> int:
    from . import fonts

    if a.fonts_cmd == "library":
        fams = sorted(fonts.library_families().values(), key=lambda f: f["name"])
        out.emit({"families": fams}, "\n".join(
            f"{f['name']:<24} {len(f['files'])} styles" for f in fams) or "(no fonts yet)")
        return 0
    if a.fonts_cmd == "vendor":
        copied = fonts.vendor(proj.find_root(a.project), a.family)
        out.emit({"copied": copied}, "\n".join(copied) or "nothing to copy")
        return 0
    added = fonts.fetch(proj.find_root(a.project), a.family)
    out.emit({"fonts": added}, "\n".join(f"{f['family']} {f['weight']}{' italic' if f.get('italic') else ''}"
                                          f"  {f['path']}" for f in added))
    return 0


def cmd_logo(a: argparse.Namespace, out: Out) -> int:
    from . import library

    if a.logo_cmd == "library":
        items = library.brands()
        out.emit({"brands": items}, "\n".join(
            f"{b['name']}: {b['description']}\n"
            + (f"  colors: {', '.join(f'{k} {v}' for k, v in b['colors'].items())}\n" if b["colors"] else "")
            + "\n".join(f"  {l['id']:<34} {l['width']:g}×{l['height']:g}  {l['description']}"
                        if l["width"] else f"  {l['id']:<34} {l['description']}" for l in b["logos"])
            for b in items) or "(no logos)")
        return 0
    result = library.add_logo(proj.find_root(a.project), a.logo, id=a.id)
    out.emit({"result": result}, f"{'registered' if result['added'] else 'already registered as'} "
                                 f"asset '{result['id']}' → {result['path']}")
    return 0


def cmd_grid(a: argparse.Namespace, out: Out) -> int:
    from . import grid

    result = grid.grid(proj.find_root(a.project), a.file, step=a.step)
    out.emit(result, f"{result['png']}  ({result['width']}×{result['height']} px, lines every {a.step:g} %)")
    return 0


def cmd_formats(a: argparse.Namespace, out: Out) -> int:
    cat = formats.catalog_json()
    out.emit({"formats": cat}, "\n".join(
        f"{f['key']:<24} {f['width']}×{f['height']:<6} {f['aspect']:<17} {f['group']:<7} {f['label']}"
        for f in cat)
        + f"\n{'(no preset)':<24} any          {'':<17} Custom  `xds init --size WxH`: shown 1:1")
    return 0


def cmd_schema(a: argparse.Namespace, out: Out) -> int:
    from . import schema

    if a.check:
        current = schema.check()
        out.emit({"current": current}, "types are current" if current else
                 f"{schema.GENERATED} is out of date; run `xds schema --emit-types`")
        return 0 if current else 1
    cwd = Path.cwd().resolve()
    if cwd != REPO and REPO not in cwd.parents:
        raise XdsError("NOT_IN_XDS_SOURCE", "`xds schema --emit-types` rewrites xds's own TypeScript "
                       f"types in {schema.GENERATED.relative_to(REPO)}. It's for developing xds and runs "
                       f"only inside the xds checkout ({REPO}); a project never needs it.", status=2)
    path = schema.emit()
    out.emit({"path": str(path)}, f"wrote {path}")
    return 0


def cmd_reflow(a: argparse.Namespace, out: Out) -> int:
    from . import reflow
    from .models import Format

    if bool(a.format) == bool(a.size):
        raise XdsError("USAGE", "Give --format PRESET or --size WxH.", status=2)
    if a.format:
        p = formats.CATALOG[a.format]
        target = Format(preset=p.key, width=p.width, height=p.height)
    else:
        try:
            w, h = formats.parse_size(a.size)
        except ValueError as e:
            raise XdsError("USAGE", str(e), status=2) from e
        target = Format(width=w, height=h)
    r = reflow.reflow_project(proj.find_root(a.project), target, dry_run=a.dry_run)
    out.emit(r, reflow.report_text(r))
    return 0


def cmd_layout(a: argparse.Namespace, out: Out) -> int:
    from . import layouts

    if a.layout_cmd == "list":
        items = layouts.list_layouts()
        out.emit({"layouts": items}, "\n".join(f"{i['id']:<20} {i['name']:<24} {i['intent']}" for i in items))
        return 0
    if a.layout_cmd == "show":
        d = layouts.load_layout(a.id)
        out.emit({"layout": d}, layouts.layout_text(d))
        return 0
    report = layouts.apply_project(proj.find_root(a.project), a.id, slide=a.slide, mode=a.mode,
                                   add_roles=a.add_roles, dry_run=a.dry_run)
    out.emit(report, layouts.report_text(report))
    return 0


def cmd_snapshot(a: argparse.Namespace, out: Out) -> int:
    from . import snapshots

    root = proj.find_root(a.project)
    if a.delete:
        r = snapshots.delete(root, a.delete)
        out.emit(r, f"deleted snapshot {a.delete}")
        return 0
    if a.list:
        items = snapshots.list_snapshots(root)
        out.emit({"snapshots": items}, snapshots_text(items))
        return 0
    rec = snapshots.take(root, label=a.label)
    out.emit({"snapshot": rec}, f"snapshot {rec['id']} ({rec['dir']})")
    return 0


def snapshots_text(items: list[dict[str, Any]]) -> str:
    if not items:
        return "no snapshots"
    lines = []
    for r in items:
        s = r.get("summary") or {}
        fmt = s.get("format") or {}
        size = f"{fmt.get('width')}×{fmt.get('height')}" if fmt.get("width") else ""
        what = r.get("label") or r.get("reason") or ""
        lines.append(f"{r['id']:<34} {str(r.get('createdAt', ''))[:19]:<20} {what:<40} "
                     f"{s.get('slides', '?')} slides · {s.get('nodes', '?')} nodes · {fmt.get('preset') or size}")
    return "\n".join(lines)


def cmd_restore(a: argparse.Namespace, out: Out) -> int:
    from . import snapshots

    r = snapshots.restore(proj.find_root(a.project), a.snapshot)
    out.emit(r, f"restored {a.snapshot} ({r['files']} files); the state before is snapshot {r['safety']['id']}")
    return 0


def cmd_clean(a: argparse.Namespace, out: Out) -> int:
    root = proj.find_root(a.project)
    cache = root / "cache"
    existed = cache.exists()
    if existed:
        shutil.rmtree(cache)
    out.emit({"deleted": str(cache) if existed else None}, f"deleted {cache}" if existed else "no cache")
    return 0


def projects_dir() -> Path:
    from .api import projects_dir as pd

    return pd()


def cmd_open(a: argparse.Namespace, out: Out) -> int:
    """Start the API (and Vite for hot reload when the workspace has it) and open a browser tab."""
    import uvicorn

    from .api import STUDIO_DIST, create_app

    root = proj.find_root(a.project) if a.project else None
    app = create_app(root)
    vite = None
    url = f"http://127.0.0.1:{a.port}"
    studio = REPO / "apps" / "studio"
    if not a.no_vite and (studio / "package.json").exists() and (REPO / "node_modules").exists() \
            and shutil.which("npm"):
        vite = subprocess.Popen(["npm", "run", "dev", "-w", "@xds/studio", "--", "--port", "5173", "--strictPort"],
                                cwd=REPO, env={**os.environ, "XDS_API_PORT": str(a.port)})
        url = "http://localhost:5173"
    elif not (STUDIO_DIST / "index.html").exists():
        out.line("warning: the studio is not built (npm run build) and Vite is not available")
    out.line(f"XDS studio: {url}  (API on :{a.port}){'  project: ' + str(root) if root else ''}")
    if not a.no_open:
        def open_later() -> None:
            time.sleep(1.5 if vite else 0.5)
            webbrowser.open(url)

        import threading
        threading.Thread(target=open_later, daemon=True).start()
    try:
        uvicorn.run(app, host="127.0.0.1", port=a.port, log_level="warning")
    finally:
        if vite:
            vite.terminate()
    return 0


# --- argument parsing ----------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    top = argparse.ArgumentParser(add_help=False)
    top.add_argument("--json", action="store_true", help="machine-readable output")
    # on subcommands the flag defaults to unset, so `xds --json check .` keeps the top-level one
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--json", action="store_true", default=argparse.SUPPRESS,
                        help="machine-readable output")

    p = argparse.ArgumentParser(prog="xds", description="XDS: design social-media graphics from files.",
                                parents=[top])
    sub = p.add_subparsers(dest="cmd", required=True, metavar="COMMAND")

    def add(name: str, fn: Any, help: str) -> argparse.ArgumentParser:
        sp = sub.add_parser(name, help=help, parents=[common], description=help)
        sp.set_defaults(fn=fn)
        return sp

    sp = add("init", cmd_init, "create a new project from the blank template")
    sp.add_argument("project")
    sp.add_argument("--name")
    sp.add_argument("--format", choices=sorted(formats.CATALOG),
                    help="a preset from `xds formats` (default instagram-portrait)")
    sp.add_argument("--size", metavar="WxH", help="a custom size with no platform preset, e.g. 1440x1080")
    sp.add_argument("--layout", metavar="ID", help="seed the first slide from a library layout (`xds layout list`)")

    sp = add("open", cmd_open, "open the studio editor")
    sp.add_argument("project", nargs="?")
    sp.add_argument("--port", type=int, default=8765)
    sp.add_argument("--no-open", action="store_true", help="don't open a browser tab")
    sp.add_argument("--no-vite", action="store_true", help="serve the built studio instead of Vite")

    sp = add("check", cmd_check, "schema + references + designs (no browser)")
    sp.add_argument("project")

    sp = add("guide", cmd_guide, "the design numbers for this format")
    sp.add_argument("project")
    sp.add_argument("--slide", help="also show this slide's measured values")

    sp = add("measure", cmd_measure, "text layout only (no 3D): lines, heights, stacks, text checks")
    sp.add_argument("project")
    sp.add_argument("--slide", action="append", help="only this slide (repeatable)")

    sp = add("rules", cmd_rules, "every audit rule with its principle and thresholds")
    sp.add_argument("--project", help="use this project's format and rule overrides")

    sp = add("render", cmd_render, "slide PNGs + contact sheet into cache/<hash>/")
    sp.add_argument("project")
    sp.add_argument("--slide")

    sp = add("audit", cmd_audit, "render + measure + rules → audit.json + annotated PNGs")
    sp.add_argument("project")
    sp.add_argument("--slide")

    sp = add("fix", cmd_fix, "apply the audit's structured fixes (findings' `edits`) to project.json")
    sp.add_argument("project")
    sp.add_argument("--slide", action="append", help="only this slide (repeatable)")
    sp.add_argument("--rule", action="append", help="only this rule (repeatable)")
    sp.add_argument("--severity", choices=["error", "warn", "info"], default="warn",
                    help="apply findings of this severity and above (default warn: errors and warnings)")
    sp.add_argument("--dry-run", action="store_true", help="show the edits without writing")

    sp = add("export", cmd_export, "audit gate → export/<stamp>/")
    sp.add_argument("project")
    sp.add_argument("--out")
    sp.add_argument("--pdf", action="store_true", help="the deck as one PDF instead of a PNG per slide")
    sp.add_argument("--force", action="store_true", help="export despite open errors (recorded)")

    sp = add("migrate", cmd_migrate, "upgrade project files to the current schema")
    sp.add_argument("project", nargs="?")
    sp.add_argument("--all", action="store_true", help="every project in the projects directory")
    sp.add_argument("--dry-run", action="store_true")
    sp.add_argument("--conform", action="store_true", help="only run the conform pass")

    sp = add("model", cmd_model, "add or inspect a 3D model")
    msub = sp.add_subparsers(dest="model_cmd", required=True)
    m = msub.add_parser("add", parents=[common],
                        help="register a .glb/.gltf/.dae file, or a library model by reference")
    m.add_argument("project")
    m.add_argument("file", nargs="?")
    m.add_argument("--library", metavar="MODEL", help="a model from `xds model library` (not copied)")
    m.add_argument("--id", help="asset/object id (required for a file; defaults to the library id)")
    m.add_argument("--name")
    m.add_argument("--slide")
    m.add_argument("--screen", help="with --library and --slide: show this screen on the model")
    m.add_argument("--replace", action="store_true")
    m.add_argument("--front", type=front_axis, metavar="DIR",
                   help="where the model's front faces now: back (-Z), left (-X), right (+X), up (+Y), "
                        "down (-Y) or forward (+Z); it is turned to face +Z")
    m.add_argument("--height", type=float, metavar="M", help="scale the model to this real height in meters")
    m.add_argument("--scale", type=float, metavar="F", help="scale the model by this factor")
    m.add_argument("--ground", action="store_true",
                   help="put the origin at the bottom center (implied by --front/--height/--scale)")
    m = msub.add_parser("library", parents=[common], help="the device models xds ships")
    m = msub.add_parser("vendor", parents=[common], help="copy a library model into the project")
    m.add_argument("project")
    m.add_argument("id", help="the asset id")
    m = msub.add_parser("inspect", parents=[common], help="parts, clips, screen meshes, warnings")
    m.add_argument("file")

    sp = add("screen", cmd_screen, "device screens (HTML UI on a model's screen mesh)")
    ssub = sp.add_subparsers(dest="screen_cmd", required=True)
    s = ssub.add_parser("add", parents=[common], help="create screens/<id>/index.html")
    s.add_argument("project")
    s.add_argument("id")
    s.add_argument("--device")
    s.add_argument("--width", type=float)
    s.add_argument("--height", type=float)
    s.add_argument("--scale", type=float)
    s.add_argument("--landscape", nargs="?", const="left", choices=["left", "right"],
                   help="a landscape page for the device on its side: its top on the left (default, "
                        "pose rotation z = 90) or on the right (z = -90)")
    s = ssub.add_parser("render", parents=[common], help="render the screen page to PNG")
    s.add_argument("project")
    s.add_argument("id")

    sp = add("design", cmd_design, "background designs")
    dsub = sp.add_subparsers(dest="design_cmd", required=True)
    d = dsub.add_parser("add", parents=[common], help="copy a starter design into designs/")
    d.add_argument("project")
    d.add_argument("starter")

    sp = add("fonts", cmd_fonts, "font files")
    fsub = sp.add_subparsers(dest="fonts_cmd", required=True)
    f = fsub.add_parser("fetch", parents=[common],
                        help="use a Fontshare family (downloaded once into the xds font library)")
    f.add_argument("project")
    f.add_argument("family")
    f = fsub.add_parser("library", parents=[common], help="the families in the xds font library")
    f = fsub.add_parser("vendor", parents=[common], help="copy library fonts into the project")
    f.add_argument("project")
    f.add_argument("family", nargs="?")

    sp = add("logo", cmd_logo, "brand logos that ship with xds")
    lsub = sp.add_subparsers(dest="logo_cmd", required=True)
    lg = lsub.add_parser("library", parents=[common], help="the brands and logos in the xds library")
    lg = lsub.add_parser("add", parents=[common],
                         help="register a library logo as an svg asset (by reference, not copied)")
    lg.add_argument("project")
    lg.add_argument("logo", help="a logo id from `xds logo library`, e.g. cortextech/full-logomark")
    lg.add_argument("--id", help="the asset id (default: <brand>-<logo>)")

    sp = add("grid", cmd_grid, "a copy of an image with a labeled percent grid, to read positions off it")
    sp.add_argument("project")
    sp.add_argument("file", help="an image in the project (assets/…, screens/…, or a rendered slide in cache/)")
    sp.add_argument("--step", type=float, default=10, help="grid spacing in %% (default 10)")

    add("formats", cmd_formats, "the format catalog")

    sp = add("schema", cmd_schema, "xds development: TypeScript types from the Pydantic models")
    g = sp.add_mutually_exclusive_group(required=True)
    g.add_argument("--emit-types", action="store_true")
    g.add_argument("--check", action="store_true")

    sp = add("reflow", cmd_reflow, "retarget the project to another format: boxes relative to the margins, "
             "type sizes to the new bands")
    sp.add_argument("project")
    sp.add_argument("--format", choices=sorted(formats.CATALOG), help="a preset from `xds formats`")
    sp.add_argument("--size", metavar="WxH", help="a custom size, e.g. 1440x1080")
    sp.add_argument("--dry-run", action="store_true", help="report what would move without writing")

    sp = add("layout", cmd_layout, "slide layouts written in relations: list, show, apply to a slide")
    lsub = sp.add_subparsers(dest="layout_cmd", required=True)
    lsub.add_parser("list", parents=[common], help="the layouts xds ships, with their intent")
    l = lsub.add_parser("show", parents=[common], help="a layout's slots, relations and variants")
    l.add_argument("id")
    l = lsub.add_parser("apply", parents=[common],
                        help="apply a layout to a slide (fill: re-place its text by level; replace: its 2D nodes; "
                             "new: a slide after it)")
    l.add_argument("project")
    l.add_argument("id")
    l.add_argument("--slide", help="the slide (default: the first)")
    l.add_argument("--mode", choices=("fill", "replace", "new"), default="fill")
    l.add_argument("--add-roles", action="store_true",
                   help="add a type role for each level the layout needs and the brand lacks")
    l.add_argument("--dry-run", action="store_true", help="report without writing")

    sp = add("snapshot", cmd_snapshot, "save a snapshot of the project's sources into .snapshots/")
    sp.add_argument("project")
    sp.add_argument("--label", help="a name for it (labelled snapshots are never pruned)")
    sp.add_argument("--list", action="store_true", help="list the snapshots (and migrate backups), newest first")
    sp.add_argument("--delete", metavar="ID", help="delete one snapshot")

    sp = add("restore", cmd_restore, "put a snapshot back (the current state is snapshotted first)")
    sp.add_argument("project")
    sp.add_argument("snapshot", metavar="ID", help="a snapshot id from `xds snapshot --list`")

    sp = add("clean", cmd_clean, "delete cache/")
    sp.add_argument("project")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    out = Out(args.json)
    try:
        return args.fn(args, out)
    except XdsError as e:
        if out.as_json:
            print(json.dumps({"ok": False, "error": e.to_json()}, indent=2, default=str))
        else:
            print(f"error: {e.code}: {e.message}", file=sys.stderr)
            if isinstance(e.details, list) and e.details and isinstance(e.details[0], dict) and "rule" in e.details[0]:
                print(findings_text(e.details), file=sys.stderr)
            elif e.details:
                print(json.dumps(e.details, indent=2, default=str), file=sys.stderr)
        return 2 if e.status == 2 else 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
