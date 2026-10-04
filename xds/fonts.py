"""`xds fonts fetch`: put a Fontshare family in the xds font library and register it.

Fonts live with xds, not in each project: `xds/library/fonts/<Family>/` holds the files plus a
`family.json` (`{"name", "files": [{"file", "weight", "italic"}]}`), and a project's `fonts`
entries point there with `xds:fonts/<Family>/<file>` paths (see library.py). A family is
downloaded once; every later project reuses it offline. `xds fonts vendor` copies a project's
library fonts into its own `fonts/` so it can travel without xds.

Fontshare's API: `GET https://api.fontshare.com/v2/fonts?q=<name>` finds the family (its `name`
and `slug`); `GET https://api.fontshare.com/v2/fonts/download/<slug>` returns a zip with
`<Family>_Complete/Fonts/WEB/fonts/<File>-<Style>.woff2` files. We keep the static `.woff2`
styles (not the variable fonts) and read weight and italic from the style name.
"""

from __future__ import annotations

import io
import json
import re
import zipfile
from pathlib import Path
from typing import Any

import httpx

from .models import FontFile, Project

API = "https://api.fontshare.com/v2"
WEIGHTS = {"thin": 100, "hairline": 100, "extralight": 200, "ultralight": 200, "light": 300,
           "regular": 400, "book": 400, "normal": 400, "": 400, "medium": 500,
           "semibold": 600, "demibold": 600, "bold": 700, "extrabold": 800, "ultrabold": 800,
           "black": 900, "heavy": 900}


def find_family(client: httpx.Client, family: str) -> dict[str, Any]:
    from .project import XdsError

    resp = client.get(f"{API}/fonts", params={"q": family})
    resp.raise_for_status()
    fonts = resp.json().get("fonts") or []
    key = family.strip().lower()
    match = next((f for f in fonts if f.get("name", "").lower() == key
                  or f.get("slug") == re.sub(r"\s+", "-", key)), None)
    if match is None:
        names = ", ".join(f.get("name", "?") for f in fonts[:8])
        raise XdsError("FONT_NOT_FOUND", f"Fontshare has no family '{family}'"
                       + (f" (did you mean: {names})" if names else "") + ".", status=404)
    return match


def style_of(filename: str, family_file: str) -> tuple[int, bool] | None:
    """`Satoshi-BoldItalic.woff2` → (700, True). None for variable fonts or unknown styles."""
    stem = Path(filename).stem
    style = stem[len(family_file) + 1:] if stem.lower().startswith(family_file.lower() + "-") \
        else stem.rsplit("-", 1)[-1]
    if "variable" in style.lower():
        return None
    italic = style.lower().endswith("italic")
    base = style[:-6] if italic else style
    weight = WEIGHTS.get(base.lower().replace("-", ""))
    return (weight, italic) if weight else None


def extract(zip_bytes: bytes, family: str, dest: Path) -> list[tuple[Path, int, bool]]:
    """Write the static .woff2 styles into `dest`; returns (path, weight, italic) for each."""
    out = []
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        names = [n for n in z.namelist() if n.lower().endswith(".woff2") and "/__MACOSX" not in n]
        for name in sorted(names):
            file_family = Path(name).stem.split("-")[0]
            style = style_of(name, file_family)
            if style is None:
                continue
            target = dest / Path(name).name
            target.write_bytes(z.read(name))
            out.append((target, *style))
    return out


def _folder(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "", name.replace(" ", ""))


def library_families() -> dict[str, dict[str, Any]]:
    """Families already in the font library, by lowercased name → family.json."""
    from . import library

    out = {}
    for meta in sorted((library.DIR / "fonts").glob("*/family.json")):
        try:
            data = json.loads(meta.read_text(encoding="utf-8"))
        except ValueError:
            continue
        data["folder"] = meta.parent.name
        out[data["name"].lower()] = data
    return out


def ensure_library(family: str) -> dict[str, Any]:
    """The family's library entry, downloading it from Fontshare the first time."""
    from . import library
    from .project import XdsError

    known = library_families().get(family.strip().lower())
    if known:
        return known
    try:
        with httpx.Client(timeout=60, follow_redirects=True) as client:
            info = find_family(client, family)
            known = library_families().get(info["name"].lower())  # asked by slug or other casing
            if known:
                return known
            resp = client.get(f"{API}/fonts/download/{info['slug']}")
            resp.raise_for_status()
    except httpx.HTTPError as e:
        raise XdsError("FONT_DOWNLOAD_FAILED", f"Fontshare request failed: {e}", status=502) from e
    name = info["name"]
    folder = library.DIR / "fonts" / _folder(name)
    files = extract(resp.content, name, folder)
    if not files:
        raise XdsError("FONT_DOWNLOAD_FAILED", f"The '{name}' download has no static .woff2 "
                       "styles.", status=502)
    data = {"name": name, "slug": info["slug"],
            "files": [{"file": p.name, "weight": w, "italic": italic} for p, w, italic in files]}
    (folder / "family.json").write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return {**data, "folder": folder.name}


def fetch(root: Path, family: str) -> list[dict[str, Any]]:
    """Register `family` in the project, pointing at the font library (downloaded once from
    Fontshare). Existing FontFile entries for the family are replaced. Returns the entries."""
    from .project import read_raw, write_project

    root = Path(root).resolve()
    project = Project.model_validate(read_raw(root))
    lib = ensure_library(family)
    entries = [FontFile(family=lib["name"], path=f"xds:fonts/{lib['folder']}/{f['file']}",
                        weight=f["weight"], italic=True if f["italic"] else None)
               for f in lib["files"]]
    project.fonts = [f for f in project.fonts if f.family != lib["name"]] + entries
    write_project(root, project)
    return [e.model_dump(mode="json", by_alias=True, exclude_none=True) for e in entries]


def vendor(root: Path, family: str | None = None) -> list[str]:
    """Copy the project's library fonts (or one family's) into its `fonts/` folder and point the
    entries there, so the project renders without this xds install. Returns the new paths."""
    import shutil

    from . import library
    from .project import read_raw, write_project

    root = Path(root).resolve()
    project = Project.model_validate(read_raw(root))
    copied = []
    for f in project.fonts:
        if not library.is_library_path(f.path) or (family and f.family.lower() != family.lower()):
            continue
        src = library.resolve(f.path)
        dest = root / "fonts" / src.parent.name / src.name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dest)
        f.path = dest.relative_to(root).as_posix()
        copied.append(f.path)
    write_project(root, project)
    return copied
