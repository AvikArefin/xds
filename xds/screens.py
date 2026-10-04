"""Device screens: small HTML pages rendered to PNG textures for a model's `Screen` mesh.

`screens/<id>/index.html` is plain HTML. At render time XDS:

1. **expands partials**: `<xds-include src="status-bar"></xds-include>` is replaced by
   `screens/<id>/partials/status-bar.html` (falling back to the starter's copy in
   `xds/resources/screens/partials/`). Partials may include partials (up to 5 levels);
2. **inlines Lucide icons**: `<i data-lucide="bell" class="size-5"></i>` becomes the SVG from
   `lucide-static`, keeping the `<i>`'s other attributes (classes are appended);
3. **compiles Tailwind CSS v4 + Basecoat** (`npx --no-install @tailwindcss/cli`) for the classes
   the page uses, with `--font-sans` set to the project's body font, and inlines the CSS;
4. adds `@font-face` rules for every project font, sets `--safe-top/right/bottom/left` (px) from
   the screen's `safeArea` and `data-device` on `<html>` (kept if the page sets it, else the
   preset whose size matches, else "custom");
5. screenshots it with Playwright at `width × height` CSS px and `deviceScaleFactor = scale`
   (default 3 for widths under 600 px, else 2).

The page is served from a virtual origin whose paths map to the project, so relative URLs in
`index.html` (e.g. `img/avatar.jpg` next to it) resolve to project files, and `/xds:…` (library
fonts) to the xds library.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from .models import Project, SafeArea, Screen

REPO_ROOT = Path(__file__).resolve().parent.parent
NODE_MODULES = REPO_ROOT / "node_modules"
STARTER = Path(__file__).parent / "resources" / "screens"
ORIGIN = "http://xds.screen"

DEVICES: dict[str, dict[str, Any]] = {
    "iphone": {"width": 393, "height": 852, "scale": 3,
               "safeArea": {"top": 59, "right": 0, "bottom": 34, "left": 0}},
    "iphone-17-pro": {"width": 402, "height": 874, "scale": 3,
                      "safeArea": {"top": 62, "right": 0, "bottom": 34, "left": 0}},
    "iphone-max": {"width": 430, "height": 932, "scale": 3,
                   "safeArea": {"top": 59, "right": 0, "bottom": 34, "left": 0}},
    "android": {"width": 412, "height": 915, "scale": 2.625,
                "safeArea": {"top": 24, "right": 0, "bottom": 24, "left": 0}},
    "ipad": {"width": 820, "height": 1180, "scale": 2,
             "safeArea": {"top": 24, "right": 0, "bottom": 20, "left": 0}},
    "macbook": {"width": 1512, "height": 982, "scale": 2,
                "safeArea": {"top": 32, "right": 0, "bottom": 0, "left": 0}},
    "desktop": {"width": 1440, "height": 900, "scale": 2,
                "safeArea": {"top": 0, "right": 0, "bottom": 0, "left": 0}},
}

_INCLUDE = re.compile(r"<xds-include\s+src=[\"']([A-Za-z0-9_./-]+)[\"']\s*(?:/>|>\s*</xds-include>)")
_ICON = re.compile(r"<i\s+([^>]*?)\s*>\s*</i>", re.S)
_ATTR = re.compile(r"([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(\"[^\"]*\"|'[^']*')")
_FONT_FORMATS = {".woff2": "woff2", ".woff": "woff", ".ttf": "truetype", ".otf": "opentype"}


def default_scale(width: float) -> float:
    return 3 if width < 600 else 2


def device_for(screen: Screen) -> str:
    return next((k for k, d in DEVICES.items()
                 if d["width"] == screen.width and d["height"] == screen.height), "custom")


# --- add -------------------------------------------------------------------------------------

def add(root: Path, screen_id: str, *, device: str | None = None, width: float | None = None,
        height: float | None = None, scale: float | None = None) -> dict[str, Any]:
    """Create `screens/<id>/` from the starter and register the screen. Returns the Screen JSON."""
    from .project import XdsError, read_raw, write_project

    root = Path(root).resolve()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", screen_id):
        raise XdsError("INVALID_ID", f"'{screen_id}' is not a valid id", status=422)
    if device is None and (width is None or height is None):
        device = "iphone"
    if device is not None and device not in DEVICES:
        raise XdsError("UNKNOWN_DEVICE", f"No device preset '{device}'.", status=422,
                       details={"devices": list(DEVICES)})
    preset = DEVICES.get(device or "", {})
    project = Project.model_validate(read_raw(root))
    if project.screen(screen_id):
        raise XdsError("SCREEN_EXISTS", f"A screen '{screen_id}' already exists.", status=409)
    target = root / "screens" / screen_id
    if target.exists():
        raise XdsError("SCREEN_EXISTS", f"screens/{screen_id}/ already exists.", status=409)

    w = width if width is not None else preset["width"]
    h = height if height is not None else preset["height"]
    screen = Screen(id=screen_id, path=f"screens/{screen_id}/index.html", width=w, height=h,
                    scale=scale if scale is not None else preset.get("scale", default_scale(w)),
                    safe_area=SafeArea(**preset["safeArea"]) if preset else None)
    shutil.copytree(STARTER, target)
    page = target / "index.html"
    page.write_text(page.read_text(encoding="utf-8").replace(
        'data-device="iphone"', f'data-device="{device or "custom"}"', 1), encoding="utf-8")
    project.screens.append(screen)
    write_project(root, project)
    return screen.model_dump(mode="json", by_alias=True, exclude_none=True)


# --- building the page -----------------------------------------------------------------------

def expand_includes(text: str, screen_dir: Path, depth: int = 0) -> str:
    from .project import XdsError

    def repl(m: re.Match[str]) -> str:
        name = m.group(1).removesuffix(".html")
        for base in (screen_dir / "partials", STARTER / "partials"):
            f = (base / f"{name}.html").resolve()
            if base.resolve() in f.parents and f.is_file():
                if depth >= 5:
                    raise XdsError("SCREEN_INCLUDE", "partials nest more than 5 levels deep")
                partial = re.sub(r"<!--.*?-->", "", f.read_text(encoding="utf-8"), flags=re.S)
                return expand_includes(partial, screen_dir, depth + 1)
        raise XdsError("SCREEN_INCLUDE", f"No partial '{name}' (looked in "
                       f"{screen_dir.name}/partials/ and the starter).", status=422)

    return _INCLUDE.sub(repl, text)


def lucide_svg(name: str) -> str | None:
    f = NODE_MODULES / "lucide-static" / "icons" / f"{name}.svg"
    if not re.fullmatch(r"[a-z0-9-]+", name) or not f.is_file():
        return None
    return re.sub(r"<!--.*?-->", "", f.read_text(encoding="utf-8"), flags=re.S).strip()


def inline_icons(text: str) -> str:
    from .project import XdsError

    def repl(m: re.Match[str]) -> str:
        attrs = dict((k, v[1:-1]) for k, v in _ATTR.findall(m.group(1)))
        name = attrs.pop("data-lucide", None)
        if name is None:
            return m.group(0)
        svg = lucide_svg(name)
        if svg is None:
            raise XdsError("SCREEN_UNKNOWN_ICON", f"No Lucide icon '{name}' "
                           "(see https://lucide.dev/icons).", status=422)
        extra_class = attrs.pop("class", "")
        classes = " ".join(filter(None, ["lucide", f"lucide-{name}", extra_class]))
        svg = svg.replace(f'class="lucide lucide-{name}"', f'class="{classes}"', 1)
        rest = "".join(f' {k}="{v}"' for k, v in attrs.items())
        return svg.replace("<svg", "<svg" + rest, 1)

    return _ICON.sub(lambda m: repl(m) if "data-lucide" in m.group(1) else m.group(0), text)


def body_font(project: Project) -> str | None:
    """The family for `--font-sans`: the body role's font, else any role's, else the first file."""
    roles = project.brand.typography
    body = next((r.font for r in roles.values() if r.level == "body"), None)
    return body or next((r.font for r in roles.values()), None) or \
        (project.fonts[0].family if project.fonts else None)


def compile_css(page_html: str, font: str | None) -> str:
    """Tailwind v4 + Basecoat for the classes in `page_html`, minified."""
    from .project import XdsError

    tw = NODE_MODULES / "tailwindcss" / "index.css"
    basecoat = NODE_MODULES / "basecoat-css" / "dist" / "basecoat.css"
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        (t / "page.html").write_text(page_html, encoding="utf-8")
        theme = (f'@theme {{ --font-sans: "{font}", ui-sans-serif, system-ui, sans-serif; }}\n'
                 if font else "")
        (t / "input.css").write_text(
            f'@import "{tw.as_posix()}" source(none);\n@source "./page.html";\n'
            f'@import "{basecoat.as_posix()}";\n{theme}', encoding="utf-8")
        cmd = ["npx", "--no-install", "@tailwindcss/cli", "-i", str(t / "input.css"),
               "-o", str(t / "out.css"), "--minify"]
        proc = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True, timeout=120)
        if proc.returncode != 0 or not (t / "out.css").exists():
            raise XdsError("SCREEN_CSS_FAILED", f"Tailwind failed: {proc.stderr.strip()[-800:]}",
                           status=422)
        return (t / "out.css").read_text(encoding="utf-8")


def font_faces(project: Project) -> str:
    rules = []
    for f in project.fonts:
        fmt = _FONT_FORMATS.get(Path(f.path).suffix.lower(), "woff2")
        rules.append(f'@font-face{{font-family:"{f.family}";src:url("/{f.path}") format("{fmt}");'
                     f'font-weight:{f.weight};font-style:{"italic" if f.italic else "normal"};'
                     "font-display:block}")
    return "".join(rules)


def _html_tag(text: str, screen: Screen) -> str:
    """Set `data-device` (unless present) and the `--safe-*` variables on <html>."""
    safe = screen.safe_area or SafeArea()
    vars_ = (f"--safe-top:{safe.top:g}px;--safe-right:{safe.right:g}px;"
             f"--safe-bottom:{safe.bottom:g}px;--safe-left:{safe.left:g}px;")
    m = re.search(r"<html\b([^>]*)>", text, re.I)
    if not m:
        return f'<html data-device="{device_for(screen)}" style="{vars_}">' + text + "</html>"
    attrs = m.group(1)
    if "data-device" not in attrs:
        attrs += f' data-device="{device_for(screen)}"'
    sm = re.search(r'style="([^"]*)"', attrs)
    attrs = (attrs[:sm.start()] + f'style="{vars_}{sm.group(1)}"' + attrs[sm.end():]) if sm \
        else attrs + f' style="{vars_}"'
    return text[:m.start()] + f"<html{attrs}>" + text[m.end():]


def build_page(root: Path, project: Project, screen: Screen) -> str:
    """The self-contained HTML that gets screenshotted."""
    from .project import resolve_inside

    page = resolve_inside(root, screen.path)
    text = re.sub(r"<!--.*?-->", "", page.read_text(encoding="utf-8"), flags=re.S)
    text = expand_includes(text, page.parent)
    text = inline_icons(text)
    css = compile_css(text, body_font(project))
    style = f"<style>{font_faces(project)}{css}</style>"
    text = _html_tag(text, screen)
    if re.search(r"</head>", text, re.I):
        return re.sub(r"</head>", lambda _: style + "</head>", text, count=1, flags=re.I)
    return style + text


# --- rendering -------------------------------------------------------------------------------

def render(root: Path, screen_id: str, out_png: Path, *, browser: Any = None) -> Path:
    """Render screen `screen_id` to `out_png` at width × height × scale."""
    from .project import XdsError, read_raw, resolve_asset

    root = Path(root).resolve()
    project = Project.model_validate(read_raw(root))
    screen = project.screen(screen_id)
    if screen is None:
        raise XdsError("UNKNOWN_SCREEN", f"No screen '{screen_id}'.", status=404)
    page_html = build_page(root, project, screen)
    page_url = f"{ORIGIN}/{screen.path}"

    def handle(route: Any) -> None:
        url = route.request.url.split("?")[0].split("#")[0]
        rel = unquote(url[len(ORIGIN) + 1:])
        if url == page_url:
            return route.fulfill(body=page_html, content_type="text/html; charset=utf-8")
        try:
            target = resolve_asset(root, rel)  # project files, or `xds:` library fonts
        except XdsError:
            return route.fulfill(status=403, body="outside the project")
        if not target.is_file():
            return route.fulfill(status=404, body="not found")
        return route.fulfill(path=str(target))

    out_png = Path(out_png)
    out_png.parent.mkdir(parents=True, exist_ok=True)

    def shoot(b: Any) -> None:
        ctx = b.new_context(viewport={"width": int(screen.width), "height": int(screen.height)},
                            device_scale_factor=screen.scale or default_scale(screen.width))
        try:
            pg = ctx.new_page()
            pg.route(f"{ORIGIN}/**", handle)
            pg.route(re.compile(r"^(?!http://xds\.screen/).*"), lambda r: r.abort())  # offline
            pg.goto(page_url, wait_until="load")
            pg.evaluate("() => document.fonts.ready.then(() => true)")
            pg.screenshot(path=str(out_png))
        finally:
            ctx.close()

    if browser is not None:
        shoot(browser)
    else:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            b = p.chromium.launch()
            try:
                shoot(b)
            finally:
                b.close()
    return out_png


def ensure_rendered(root: Path, project: Project, cache_dir: Path, screen_ids: Any, *,
                    browser: Any = None) -> dict[str, Path]:
    """Render the given screens into `cache_dir/screens/<id>.png` unless already there."""
    out: dict[str, Path] = {}
    for sid in dict.fromkeys(screen_ids):
        if project.screen(sid) is None:
            continue
        png = Path(cache_dir) / "screens" / f"{sid}.png"
        if not png.exists():
            render(root, sid, png, browser=browser)
        out[sid] = png
    return out
