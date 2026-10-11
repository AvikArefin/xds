"""The layouts library (docs/layouts.md): slide layouts written in the relations vocabulary, so a
person or an agent starts a slide from intent instead of coordinates.

A layout file (`xds/library/layouts/<id>.json`, shipped with xds) holds ordinary 2D nodes that
carry a `slot` (`headline`, `subhead`, `cta`, …) and a `level` instead of a role, plus optional
`groups`, a `subject` placement hint for the slide's first 3D object, and an `expression` system
for the brand. Everything in it is a relation (pins, stacks, aligns, fit, groups) or a number in
spacing units; the only percentages are widths a relation does not decide. Nodes may carry
`variants` per orientation, and a group's `variants` are resolved here for the project's format.

`apply` maps every slot to the project's role of that level (the first declared one; a missing
level is reported with the exact role to add, or added with `add_roles`), gives the nodes
project-unique ids, remaps the relations between them, and writes the result onto a slide:

- `new`: a slide after the given one, with the previous slide's background;
- `replace`: the slide's text, image and shape nodes are replaced (its background and 3D stay);
- `fill`: the slide's text nodes keep their words and take the slot layout of their level;
  slots nobody fills are created with placeholder text; other nodes stay where they are.
"""

from __future__ import annotations

import copy
import json
import re
from pathlib import Path
from typing import Any

from . import library
from .models import LEVELS, Project
from .project import XdsError

DIR = library.DIR / "layouts"
MODES = ("fill", "replace", "new")
SLOTS = ("kicker", "headline", "subhead", "body", "cta", "caption", "logo", "subject", "ornament")
PLACEHOLDER = {
    "kicker": "New",
    "headline": "Headline goes here",
    "subhead": "A subhead that says why it matters",
    "body": "Body copy goes here. Two or three sentences at most, in the voice of the brand.",
    "cta": "Learn more →",
    "caption": "Caption",
}
# Slots that take a type role, and the level they default to when the layout names none.
SLOT_LEVEL = {"kicker": "caption", "headline": "headline", "subhead": "subhead", "body": "body",
              "cta": "body", "caption": "caption"}


# --- the library ------------------------------------------------------------------------------

def _read(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def list_layouts() -> list[dict[str, Any]]:
    """Every shipped layout: id, name, intent, description and slots."""
    out = []
    for f in sorted(DIR.glob("*.json")) if DIR.is_dir() else []:
        d = _read(f)
        out.append({k: d.get(k) for k in ("id", "name", "intent", "description", "slots")})
    return out


def load_layout(layout_id: str) -> dict[str, Any]:
    f = DIR / f"{layout_id}.json"
    if not re.fullmatch(r"[a-z0-9-]+", layout_id or "") or not f.is_file():
        raise XdsError("UNKNOWN_LAYOUT", f"No layout '{layout_id}'. Run `xds layout list`.", status=404,
                       details={"layouts": [d["id"] for d in list_layouts()]})
    return _read(f)


# --- helpers ----------------------------------------------------------------------------------

def orientation(fmt: dict[str, Any]) -> str:
    """The format's orientation class (data-models §2.5c)."""
    w, h = float(fmt.get("width") or 1), float(fmt.get("height") or 1)
    ratio = h / w
    if ratio >= 1.7:
        return "story"
    if ratio > 1.05:
        return "portrait"
    if ratio >= 1 / 1.05:
        return "square"
    return "landscape"


def _merge(base: Any, over: Any) -> Any:
    if isinstance(base, dict) and isinstance(over, dict):
        out = dict(base)
        for k, v in over.items():
            if v is None:
                out.pop(k, None)
            else:
                out[k] = _merge(out.get(k), v)
        return out
    return copy.deepcopy(over)


def _fresh_id(base: str, taken: set[str]) -> str:
    clean = re.sub(r"-\d+$", "", re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", base.lower()))) or "node"
    id, i = clean, 2
    while id in taken:
        id, i = f"{clean}-{i}", i + 1
    taken.add(id)
    return id


def _all_node_ids(doc: dict[str, Any]) -> set[str]:
    ids = {n["id"] for s in doc.get("slides", []) for n in s.get("nodes", []) if isinstance(n, dict)}
    ids |= {n["id"] for n in (doc.get("master") or {}).get("nodes", []) if isinstance(n, dict)}
    return ids


def _roles_by_level(doc: dict[str, Any]) -> dict[str, str]:
    """level → the first declared role with that level."""
    out: dict[str, str] = {}
    for name, role in (doc.get("brand", {}).get("typography") or {}).items():
        lvl = role.get("level")
        if lvl and lvl not in out:
            out[lvl] = name
    return out


def _role_level(doc: dict[str, Any], role: str | None) -> str | None:
    r = (doc.get("brand", {}).get("typography") or {}).get(role or "")
    return r.get("level") if r else None


def _remap_relations(layout_spec: dict[str, Any] | None, ids: dict[str, str]) -> dict[str, Any] | None:
    if not layout_spec:
        return layout_spec
    out = copy.deepcopy(layout_spec)
    stack = out.get("stack")
    if stack:
        for key in ("below", "above", "rightOf", "leftOf"):
            if stack.get(key) in ids:
                stack[key] = ids[stack[key]]
    for a in out.get("align") or []:
        if a.get("node") in ids:
            a["node"] = ids[a["node"]]
    return out


def _remap_variants(variants: dict[str, Any] | None, ids: dict[str, str]) -> dict[str, Any] | None:
    if not variants:
        return variants
    out = copy.deepcopy(variants)
    for v in out.values():
        if isinstance(v, dict) and v.get("layout"):
            v["layout"] = _remap_relations(v["layout"], ids)
    return out


def _is_logo_asset(doc: dict[str, Any], asset_id: str) -> bool:
    a = next((a for a in doc.get("assets", []) if a.get("id") == asset_id), None)
    return bool(a) and ("logo" in asset_id.lower() or "logo" in str(a.get("path", "")).lower())


# --- apply --------------------------------------------------------------------------------------

def apply(doc: dict[str, Any], slide_id: str, layout_id: str, *, mode: str = "fill",
          add_roles: bool = False, font_fallback: str | None = None) -> tuple[dict[str, Any], dict[str, Any]]:
    """Apply a layout to a slide of a raw project document. Returns (new doc, report); raises
    `XdsError` MISSING_ROLES (with the roles to add) unless `add_roles`, NO_FONTS when roles
    must be added and the project has no font (unless `font_fallback` names the family to use,
    which the gate then asks to fetch), UNKNOWN_SLIDE, BAD_MODE."""
    if mode not in MODES:
        raise XdsError("BAD_MODE", f"mode must be one of {', '.join(MODES)}", status=422)
    layout = load_layout(layout_id)
    doc = copy.deepcopy(doc)
    slides = doc.setdefault("slides", [])
    ref_index = next((i for i, s in enumerate(slides) if s.get("id") == slide_id), None)
    if ref_index is None:
        raise XdsError("UNKNOWN_SLIDE", f"No slide '{slide_id}'.", status=404,
                       details={"slides": [s.get("id") for s in slides]})
    orient = orientation(doc.get("format", {}))
    report: dict[str, Any] = {"layout": layout_id, "mode": mode, "orientation": orient, "slide": slide_id,
                              "added": [], "filled": [], "replaced": [], "kept": [], "addedRoles": {},
                              "notes": []}

    # --- roles -------------------------------------------------------------------------------
    roles = _roles_by_level(doc)
    fonts = doc.get("fonts") or []
    needed_levels = []
    for n in layout["nodes"]:
        if n["layer"] == "type":
            lvl = n.get("level") or SLOT_LEVEL.get(n.get("slot", ""), "body")
            if lvl not in needed_levels:
                needed_levels.append(lvl)
    slide = slides[ref_index]
    existing_text = [n for n in slide.get("nodes", []) if n.get("layer") == "type"] if mode == "fill" else []
    # levels an existing text node will cover in fill mode need no role of their own
    covered = {_role_level(doc, n["data"].get("role")) for n in existing_text}
    missing = [lvl for lvl in needed_levels if lvl not in roles and lvl not in covered]
    if missing:
        family = fonts[0].get("family") if fonts else None
        suggested = {lvl: {"level": lvl, "font": family or "<a family from xds fonts library>"} for lvl in missing}
        if not add_roles:
            raise XdsError("MISSING_ROLES",
                           f"The layout needs a type role for level(s) {', '.join(missing)}. Add them to "
                           f"brand.typography (or pass --add-roles).", status=422,
                           details={"missingRoles": [{"level": lvl, "suggested": {lvl: suggested[lvl]}} for lvl in missing]})
        if not family and font_fallback:
            family = font_fallback
            report["notes"].append(f"The project has no font: the new roles name '{family}'. Run "
                                   f"`xds fonts fetch . {family}` to register it.")
        if not family:
            raise XdsError("NO_FONTS", "The project has no font to give the new roles. Run `xds fonts fetch` "
                           "(or `xds fonts library`) first.", status=422)
        typography = doc.setdefault("brand", {}).setdefault("typography", {})
        for lvl in missing:
            name = lvl if lvl not in typography else _fresh_id(lvl, set(typography))
            typography[name] = {"level": lvl, "font": family}
            roles[lvl] = name
            report["addedRoles"][name] = typography[name]

    # --- the target slide ----------------------------------------------------------------------
    if mode == "new":
        taken_slides = {s.get("id") for s in slides}
        n = len(slides) + 1
        new_id = f"s{n}"
        while new_id in taken_slides:
            n += 1
            new_id = f"s{n}"
        background = None
        master_bg = any(_covers(nd) for nd in (doc.get("master") or {}).get("nodes", []))
        if not master_bg:
            background = next((nd for nd in slide.get("nodes", []) if _covers(nd)), None)
        target: dict[str, Any] = {"id": new_id, "name": f"Slide {len(slides) + 1}", "nodes": []}
        if background:
            bg = copy.deepcopy(background)
            bg["id"] = _fresh_id(f"{new_id}-background", _all_node_ids(doc))
            bg["name"] = background.get("name") or "Background"
            target["nodes"].append(bg)
        slides.insert(ref_index + 1, target)
        report["slide"] = new_id
    elif mode == "replace":
        target = slide
        removed = [nd for nd in target.get("nodes", []) if nd.get("layer") in ("type", "image")]
        report["replaced"] = [nd["id"] for nd in removed]
        target["nodes"] = [nd for nd in target.get("nodes", []) if nd.get("layer") not in ("type", "image")]
        groups = target.get("groups") or {}
        still = {nd.get("layout", {}).get("group") for nd in target["nodes"] if isinstance(nd.get("layout"), dict)}
        target["groups"] = {k: v for k, v in groups.items() if k in still}
        if not target["groups"]:
            target.pop("groups", None)
    else:
        target = slide

    taken = _all_node_ids(doc)
    ids: dict[str, str] = {}          # layout id → id on the slide
    out_nodes: list[dict[str, Any]] = []
    matched_existing: set[str] = set()
    existing_images = [nd for nd in target.get("nodes", []) if nd.get("layer") == "image"] if mode == "fill" else []

    # groups: resolve their variants for this orientation, rename on collision
    group_ids: dict[str, str] = {}
    layout_groups = layout.get("groups") or {}
    if layout_groups:
        slide_groups = target.setdefault("groups", {})
        for name, spec in layout_groups.items():
            spec = copy.deepcopy(spec)
            variants = spec.pop("variants", None) or {}
            if orient in variants:
                spec = _merge(spec, variants[orient])
            new_name = name if name not in slide_groups else _fresh_id(name, set(slide_groups))
            slide_groups[new_name] = spec
            group_ids[name] = new_name

    for n in layout["nodes"]:
        n = copy.deepcopy(n)
        slot = n.pop("slot", None)
        level = n.pop("level", None) or SLOT_LEVEL.get(slot or "", "body")
        node_id = n["id"]
        existing: dict[str, Any] | None = None
        if n["layer"] == "type":
            if mode == "fill":
                existing = next((e for e in existing_text if e["id"] not in matched_existing
                                 and _role_level(doc, e["data"].get("role")) == level), None)
            data = dict(n.get("data", {}))
            if existing:
                matched_existing.add(existing["id"])
                data["text"] = existing["data"].get("text", "")
                data["role"] = existing["data"]["role"]
                if existing["data"].get("color"):
                    data["color"] = existing["data"]["color"]
                n["id"] = existing["id"]
                n["name"] = existing.get("name") or ""
                report["filled"].append({"node": existing["id"], "slot": slot})
            else:
                data.setdefault("text", PLACEHOLDER.get(slot or "", "Text"))
                data["role"] = roles[level]
                n["id"] = _fresh_id(node_id, taken)
                n.setdefault("name", (slot or node_id).capitalize())
                report["added"].append(n["id"])
            n["data"] = data
        elif n["layer"] == "image" and n.get("data", {}).get("asset") == "@logo":
            asset = None
            if mode == "fill":
                existing = next((e for e in existing_images if e["id"] not in matched_existing
                                 and "asset" in e.get("data", {}) and _is_logo_asset(doc, e["data"]["asset"])), None)
            if existing:
                matched_existing.add(existing["id"])
                asset = existing["data"]["asset"]
                n["id"] = existing["id"]
                n["name"] = existing.get("name") or "Logo"
                report["filled"].append({"node": existing["id"], "slot": slot})
            else:
                asset = next((a["id"] for a in doc.get("assets", []) if _is_logo_asset(doc, a["id"])), None)
                if not asset:
                    report["notes"].append("No logo asset in the project: the logo slot was left out. "
                                           "Run `xds logo add` and apply the layout again.")
                    continue
                n["id"] = _fresh_id(node_id, taken)
                n.setdefault("name", "Logo")
                report["added"].append(n["id"])
            n["data"] = {**n["data"], "asset": asset}
        else:
            n["id"] = _fresh_id(node_id, taken)
            n.setdefault("name", (slot or node_id).capitalize())
            report["added"].append(n["id"])
        ids[node_id] = n["id"]
        if n.get("layout", {}).get("group") in group_ids:
            n["layout"]["group"] = group_ids[n["layout"]["group"]]
        out_nodes.append((n, existing))  # type: ignore[arg-type]

    nodes = target.setdefault("nodes", [])
    for n, existing in out_nodes:  # type: ignore[misc]
        n["layout"] = _remap_relations(n.get("layout"), ids)
        if n["layout"] is None:
            n.pop("layout", None)
        if n.get("variants"):
            n["variants"] = _remap_variants(n["variants"], ids)
        if existing is not None:
            idx = next(i for i, e in enumerate(nodes) if e["id"] == existing["id"])
            keep = {k: existing[k] for k in ("hidden", "exceptions") if k in existing}
            nodes[idx] = {**n, **keep}
        else:
            nodes.append(n)
    if mode == "fill":
        report["kept"] = [e["id"] for e in existing_text if e["id"] not in matched_existing]

    # --- the subject -----------------------------------------------------------------------------
    subject = layout.get("subject")
    if subject:
        place = subject.get("place")
        variants = subject.get("variants") or {}
        if orient in variants and variants[orient].get("place"):
            place = _merge(place or {}, variants[orient]["place"])
        render = next((nd for nd in target.get("nodes", []) if nd.get("layer") == "render"), None)
        if render is not None and place:
            render.setdefault("data", {})["place"] = place
            report["subject"] = {"node": render["id"], "place": place}
        elif place:
            report["notes"].append(f"The layout places a product at {place}; add a model to this slide "
                                   f"(`xds model add . --library iphone-17-pro --slide {report['slide']}`) "
                                   "and apply the layout again, or set data.place by hand.")

    # --- the expression system -------------------------------------------------------------------
    if layout.get("expression") and not doc.get("brand", {}).get("expression"):
        doc["brand"]["expression"] = copy.deepcopy(layout["expression"])
        report["expression"] = doc["brand"]["expression"]

    Project.model_validate(doc)  # a ValidationError here is a bug in the layout or in this module
    return doc, report


def _covers(n: dict[str, Any]) -> bool:
    b = n.get("box") or {}
    return (n.get("layer") == "ground" and not n.get("hidden") and b.get("x", 1) <= 0 and b.get("y", 1) <= 0
            and b.get("x", 0) + b.get("w", 0) >= 100 and b.get("y", 0) + b.get("h", 0) >= 100)


def apply_project(root: Path, layout_id: str, *, slide: str | None = None, mode: str = "fill",
                  add_roles: bool = False, dry_run: bool = False, font_fallback: str | None = None) -> dict[str, Any]:
    """`xds layout apply`: apply to a project on disk through the validated save path (a big change
    snapshots the file first). Returns the report plus `written` and the gate's findings."""
    from . import project as proj

    root = proj.find_root(root)
    loaded = proj.load(root, deep=False)
    doc = loaded.raw
    if not isinstance(doc, dict) or not isinstance(doc.get("slides"), list):
        raise XdsError("INVALID_PROJECT", "project.json is not a valid project", status=422,
                       details=[f.model_dump(mode="json", by_alias=True) for f in loaded.findings])
    slide_id = slide or (doc["slides"][0]["id"] if doc["slides"] else "")
    new_doc, report = apply(doc, slide_id, layout_id, mode=mode, add_roles=add_roles, font_fallback=font_fallback)
    findings = proj.check_references(root, Project.model_validate(new_doc), deep=False)
    report["findings"] = [f.model_dump(mode="json", by_alias=True, exclude_none=True) for f in findings]
    report["dryRun"] = dry_run
    report["written"] = False
    if not dry_run:
        proj.save(root, new_doc, loaded.file_hash)
        report["written"] = True
    return report


def report_text(r: dict[str, Any]) -> str:
    lines = [f"{r['layout']} → slide {r['slide']} ({r['mode']}, {r['orientation']})"
             + ("" if r.get("written") else " (not written)")]
    for item in r.get("filled", []):
        lines.append(f"  filled     {item['node']} ← {item['slot']}")
    for id in r.get("added", []):
        lines.append(f"  added      {id}")
    for id in r.get("replaced", []):
        lines.append(f"  replaced   {id}")
    for id in r.get("kept", []):
        lines.append(f"  kept       {id} (no slot for its level; still where it was)")
    for name, role in (r.get("addedRoles") or {}).items():
        lines.append(f"  role       {name}: {json.dumps(role)}")
    if r.get("subject"):
        lines.append(f"  subject    {r['subject']['node']} place {json.dumps(r['subject']['place'])}")
    if r.get("expression"):
        lines.append(f"  expression {json.dumps(r['expression'])}")
    for note in r.get("notes", []):
        lines.append(f"  note       {note}")
    for f in r.get("findings", []):
        lines.append(f"  {f['severity']:<7}    {f['rule']} {f.get('path', '')}: {f['message']}")
    return "\n".join(lines)


def layout_text(d: dict[str, Any]) -> str:
    """`xds layout show`."""
    lines = [f"{d['id']}: {d['name']}", f"  {d['intent']}", f"  {d['description']}", f"  slots: {', '.join(d['slots'])}"]
    for n in d.get("nodes", []):
        parts = [f"{n['layer']}"]
        if n.get("level"):
            parts.append(n["level"])
        lay = n.get("layout") or {}
        if lay.get("pin"):
            parts.append("pin " + ", ".join(f"{e}→{p['to']}" + (f"{p['offset']:+g}u" if p.get("offset") else "")
                                             for e, p in lay["pin"].items()))
        if lay.get("stack"):
            s = lay["stack"]
            key = next(k for k in ("below", "above", "rightOf", "leftOf") if s.get(k))
            parts.append(f"{key} {s[key]} gap {s.get('gap', 2):g}u")
        if lay.get("align"):
            parts.append("align " + ", ".join(f"{a['edge']} of {a['node']}" for a in lay["align"]))
        if lay.get("group"):
            parts.append(f"group {lay['group']}")
        if lay.get("fit"):
            parts.append("fit text")
        if n.get("variants"):
            parts.append("variants " + ", ".join(n["variants"]))
        lines.append(f"  {n.get('slot', '-'):<9} {n['id']:<12} {' · '.join(parts)}")
    for name, g in (d.get("groups") or {}).items():
        lines.append(f"  group     {name:<12} {g.get('direction', 'column')} gap {g.get('gap', 2):g}u align {g.get('align', 'start')}")
    if d.get("subject"):
        lines.append(f"  subject   place {json.dumps(d['subject'].get('place'))}")
    return "\n".join(lines)


def levels_used(d: dict[str, Any]) -> list[str]:
    return [lvl for lvl in LEVELS if any(n.get("level") == lvl for n in d.get("nodes", []))]
