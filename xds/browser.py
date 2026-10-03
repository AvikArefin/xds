"""Render slides in headless Chromium: the one rasterizer (architecture §4).

For each slide this opens `/render?slide=<id>` at exactly the format size, waits for
`window.xds.ready`, and writes into `cache/<hash>/`:

    slides/<n>-<id>.png        the final composite (a page screenshot)
    measure/<id>.json          SlideMeasure from window.xds.measure()
    masks/<id>-<layer>.png     each layer's alpha, drawn alone without shadows
    background/<id>.png        every layer except type, for contrast sampling

The page is served by an in-process FastAPI app (the same one the editor talks to) on a free
local port, so a headless command needs one Python process and no Vite.
"""

from __future__ import annotations

import io
import json
import socket
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from PIL import Image

from . import project as proj
from .models import Project, SlideMeasure
from .project import XdsError

Progress = Callable[[str], None]
CHROMIUM_ARGS = [
    "--use-angle=swiftshader",  # WebGL without a GPU, identical on every machine
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--font-render-hinting=none",
    "--hide-scrollbars",
]
READY_TIMEOUT_MS = 90_000


@dataclass
class RenderedSlide:
    slide_id: str
    index: int  # 1-based position
    png: Path
    measure: Path
    reused: bool


@dataclass
class RenderResult:
    hash: str
    cache_dir: Path
    slides: list[RenderedSlide] = field(default_factory=list)
    contact_sheet: Path | None = None

    def to_json(self) -> dict[str, Any]:
        return {
            "hash": self.hash, "cacheDir": str(self.cache_dir),
            "contactSheet": str(self.contact_sheet) if self.contact_sheet else None,
            "slides": [{"slideId": s.slide_id, "png": str(s.png), "measure": str(s.measure),
                        "reused": s.reused} for s in self.slides],
        }


def slide_png_name(index: int, slide_id: str) -> str:
    return f"{index}-{slide_id}.png"


# --- the local server ------------------------------------------------------------------------

def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextmanager
def serve(root: Path) -> Iterator[str]:
    """Serve the API + built studio for `root` on a free port, in a background thread."""
    import uvicorn

    from .api import STUDIO_DIST, create_app

    if not (STUDIO_DIST / "index.html").exists():
        raise XdsError("STUDIO_NOT_BUILT", f"no built studio at {STUDIO_DIST}; run `npm run build`",
                       status=500)
    port = _free_port()
    config = uvicorn.Config(create_app(root, watch=False), host="127.0.0.1", port=port,
                            log_level="warning", lifespan="on")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 15
    while not server.started:
        if time.monotonic() > deadline or not thread.is_alive():
            raise XdsError("SERVER_FAILED", "the render server did not start", status=500)
        time.sleep(0.02)
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=5)


@contextmanager
def chromium() -> Iterator[Any]:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        try:
            browser = pw.chromium.launch(args=CHROMIUM_ARGS)
        except Exception as e:  # browsers not installed
            raise XdsError("BROWSER_MISSING", f"Chromium could not start ({e}). "
                           "Run `uv run playwright install chromium`.", status=500) from e
        try:
            yield browser
        finally:
            browser.close()


# --- rendering -------------------------------------------------------------------------------

def _alpha_png(png: bytes, out: Path) -> None:
    img = Image.open(io.BytesIO(png)).convert("RGBA")
    img.getchannel("A").save(out)


def _wait_ready(page: Any, slide_id: str, console: list[str]) -> None:
    try:
        page.wait_for_function("() => window.xds && (window.xds.ready || window.xds.error)",
                               timeout=READY_TIMEOUT_MS, polling=100)
    except Exception:
        try:
            waiting = page.evaluate("() => window.xds ? window.xds.waiting() : ['the render page script']")
        except Exception:
            waiting = ["the render page"]
        raise XdsError("RENDER_TIMEOUT", f"slide '{slide_id}' was not ready after "
                       f"{READY_TIMEOUT_MS // 1000}s; still waiting for: {', '.join(waiting)}",
                       status=500, details={"waiting": waiting, "console": console[-20:]})
    error = page.evaluate("() => window.xds.error")
    if error:
        raise XdsError("RENDER_FAILED", f"slide '{slide_id}': {error}", status=500,
                       details={"console": console[-20:]})


def _render_slide(browser: Any, url: str, project: Project, slide_id: str, index: int,
                  cache: Path) -> None:
    w, h = project.format.width, project.format.height
    page = browser.new_page(viewport={"width": w, "height": h}, device_scale_factor=1)
    console: list[str] = []
    page.on("console", lambda m: console.append(f"{m.type}: {m.text}"))
    page.on("pageerror", lambda e: console.append(f"pageerror: {e}"))
    try:
        page.goto(f"{url}/render?slide={slide_id}", wait_until="domcontentloaded")
        _wait_ready(page, slide_id, console)
        clip = {"x": 0, "y": 0, "width": w, "height": h}

        png = cache / "slides" / slide_png_name(index, slide_id)
        page.screenshot(path=str(png), clip=clip)

        measure = page.evaluate("() => window.xds.measure()")
        layers: dict[str, str] = {}
        for layer in project.layer_order:
            page.evaluate("(l) => window.xds.showLayers([l], { background: false, shadows: false })", layer)
            rel = f"masks/{slide_id}-{layer}.png"
            _alpha_png(page.screenshot(clip=clip, omit_background=True), cache / rel)
            layers[layer] = rel
        behind_type = [layer for layer in project.layer_order if layer != "type"]
        page.evaluate("(ls) => window.xds.showLayers(ls, { background: true, shadows: true })", behind_type)
        background = f"background/{slide_id}.png"
        page.screenshot(path=str(cache / background), clip=clip)

        measure.update(layers=layers, backgroundOnly=background,
                       slidePng=f"slides/{slide_png_name(index, slide_id)}")
        validated = SlideMeasure.model_validate(measure)
        (cache / "measure" / f"{slide_id}.json").write_text(
            json.dumps(validated.model_dump(mode="json", by_alias=True, exclude_none=True), indent=2))
    finally:
        page.close()


def contact_sheet(pngs: list[Path], out: Path, *, columns: int = 4, thumb_width: int = 360) -> Path:
    images = [Image.open(p).convert("RGB") for p in pngs]
    if not images:
        raise XdsError("NOTHING_RENDERED", "no slides to put on a contact sheet")
    tw = thumb_width
    th = round(images[0].height * tw / images[0].width)
    cols = min(columns, len(images))
    rows = -(-len(images) // cols)
    gap = 16
    sheet = Image.new("RGB", (cols * tw + (cols + 1) * gap, rows * th + (rows + 1) * gap), "#1b1b1d")
    for i, img in enumerate(images):
        x = gap + (i % cols) * (tw + gap)
        y = gap + (i // cols) * (th + gap)
        sheet.paste(img.resize((tw, th), Image.LANCZOS), (x, y))
    sheet.save(out)
    return out


def render(path: str | Path, *, slide_ids: list[str] | None = None, progress: Progress = lambda s: None,
           sheet: bool = True) -> RenderResult:
    """Render slides into cache/<hash>/, reusing any slide already rendered for this hash."""
    from . import screens

    loaded = proj.load(path)
    project = loaded.require()
    root = loaded.root
    cache = root / "cache" / loaded.hash
    for d in ("slides", "measure", "masks", "background", "screens"):
        (cache / d).mkdir(parents=True, exist_ok=True)

    wanted = slide_ids or [s.id for s in project.slides]
    unknown = [s for s in wanted if project.slide(s) is None]
    if unknown:
        raise XdsError("UNKNOWN_SLIDE", f"no slide {', '.join(map(repr, unknown))}", status=404)
    positions = {s.id: i + 1 for i, s in enumerate(project.slides)}
    result = RenderResult(loaded.hash, cache)

    todo = []
    for sid in wanted:
        png = cache / "slides" / slide_png_name(positions[sid], sid)
        measure = cache / "measure" / f"{sid}.json"
        reused = png.exists() and measure.exists()
        result.slides.append(RenderedSlide(sid, positions[sid], png, measure, reused))
        if not reused:
            todo.append(sid)

    if todo:
        used_screens = sorted({sid for s in project.slides if s.id in todo for n in s.nodes
                               if n.layer == "render" for sid in (n.data.screens or {}).values()})
        with chromium() as browser, serve(root) as url:
            if used_screens:
                progress(f"screens: {', '.join(used_screens)}")
                screens.ensure_rendered(root, project, cache, used_screens, browser=browser)
            for sid in todo:
                progress(f"render {positions[sid]}/{len(project.slides)}: {sid}")
                _render_slide(browser, url, project, sid, positions[sid], cache)
    else:
        progress("render: reusing cached slides")

    if sheet and slide_ids is None:
        result.contact_sheet = contact_sheet([s.png for s in result.slides], cache / "contact-sheet.png")
    return result
