"""The local HTTP API between the editor and the Python process. Routes only, no logic.

Every route calls the same functions as the CLI. Responses are `{ ok: true, ... }` or
`{ ok: false, error: { code, message, path?, details? } }`.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import tempfile
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse

from . import formats, project as proj
from .models import Format
from .project import XdsError

API_VERSION = 2
REPO = Path(__file__).resolve().parent.parent
STUDIO_DIST = Path(os.environ.get("XDS_STUDIO_DIST", REPO / "apps" / "studio" / "dist"))


def projects_dir() -> Path:
    return Path(os.environ.get("XDS_PROJECTS_DIR", "~/xd-projects")).expanduser()


@dataclass
class State:
    root: Path | None
    watch: bool = True
    subscribers: set[asyncio.Queue[str]] = field(default_factory=set)
    watcher: asyncio.Task[None] | None = None
    stop: asyncio.Event | None = None
    loop: asyncio.AbstractEventLoop | None = None

    def require_root(self) -> Path:
        if self.root is None:
            raise XdsError("NO_PROJECT", "no project is open", status=404)
        return self.root

    # --- server-sent events ---
    def broadcast(self, event: str, data: dict[str, Any]) -> None:
        message = f"event: {event}\ndata: {json.dumps(data)}\n\n"
        for q in list(self.subscribers):
            q.put_nowait(message)

    def broadcast_threadsafe(self, event: str, data: dict[str, Any]) -> None:
        if self.loop:
            self.loop.call_soon_threadsafe(self.broadcast, event, data)

    def progress(self, job: str):
        return lambda line: self.broadcast_threadsafe("progress", {"job": job, "line": line})

    # --- file watching ---
    async def start_watching(self) -> None:
        await self.stop_watching()
        if not self.watch or self.root is None:
            return
        self.stop = asyncio.Event()
        root, stop = self.root, self.stop

        async def run() -> None:
            async for h in proj.watch(root, stop):
                self.broadcast("changed", {"hash": h, "fileHash": proj.project_file_hash(root)})

        self.watcher = asyncio.create_task(run())

    async def stop_watching(self) -> None:
        if self.stop:
            self.stop.set()
        if self.watcher:
            self.watcher.cancel()
            try:
                await self.watcher
            except (asyncio.CancelledError, Exception):
                pass
        self.watcher = self.stop = None


def ok(**payload: Any) -> dict[str, Any]:
    return {"ok": True, **payload}


def dump(model: Any) -> Any:
    return model.model_dump(mode="json", by_alias=True, exclude_none=True)


def create_app(root: str | Path | None = None, *, watch: bool = True, serve_studio: bool = True) -> FastAPI:
    """The app for one Python process. `root` is the active project (switchable at runtime)."""
    state = State(proj.find_root(root) if root else None, watch=watch)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        state.loop = asyncio.get_running_loop()
        await state.start_watching()
        yield
        await state.stop_watching()

    app = FastAPI(title="XDS", version=str(API_VERSION), lifespan=lifespan)
    app.state.xds = state

    @app.exception_handler(XdsError)
    async def _xds_error(_: Request, e: XdsError) -> JSONResponse:
        return JSONResponse({"ok": False, "error": e.to_json()}, status_code=e.status)

    # --- the project -------------------------------------------------------------------------

    @app.get("/api/project")
    async def get_project() -> dict[str, Any]:
        from . import designs

        root = state.require_root()
        loaded = await run_in_threadpool(proj.load, root)
        guide = None
        if loaded.project:
            sets = loaded.project.rules.set if loaded.project.rules else None
            guide = formats.derive(loaded.project.format, sets).to_json()
        elif isinstance(loaded.raw, dict) and isinstance(loaded.raw.get("format"), dict):
            try:
                guide = formats.derive(Format.model_validate(loaded.raw["format"])).to_json()
            except Exception:
                guide = None
        return ok(
            apiVersion=API_VERSION,
            root=str(loaded.root),
            project=loaded.raw,
            designs=await run_in_threadpool(designs.load_all, root),
            hash=loaded.hash,
            fileHash=loaded.file_hash,
            check={"ok": loaded.ok, "findings": [dump(f) for f in loaded.findings]},
            readOnly=loaded.project is None,
            guide=guide,
        )

    @app.put("/api/project")
    async def put_project(body: dict[str, Any]) -> dict[str, Any]:
        root = state.require_root()
        if "project" not in body:
            raise XdsError("BAD_REQUEST", "body needs { project, baseHash }", status=422)
        result = await run_in_threadpool(proj.save, root, body["project"], body.get("baseHash"))
        return ok(**result)

    @app.get("/api/events")
    async def events(request: Request) -> StreamingResponse:
        queue: asyncio.Queue[str] = asyncio.Queue()
        state.subscribers.add(queue)

        async def stream():
            try:
                yield "retry: 1000\n\n"
                while not await request.is_disconnected():
                    try:
                        yield await asyncio.wait_for(queue.get(), timeout=15)
                    except asyncio.TimeoutError:
                        yield ": keep-alive\n\n"
            finally:
                state.subscribers.discard(queue)

        return StreamingResponse(stream(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @app.get("/api/files/{path:path}")
    async def files(path: str) -> FileResponse:
        target = proj.resolve_asset(state.require_root(), path)
        if not target.is_file():
            raise XdsError("NOT_FOUND", f"no file '{path}'", status=404)
        return FileResponse(target, headers={"Cache-Control": "no-cache"})

    @app.get("/api/screens/{name}")
    async def screen_png(name: str) -> FileResponse:
        from . import screens

        root = state.require_root()
        screen_id = name.removesuffix(".png")
        loaded = await run_in_threadpool(proj.load, root, deep=False)
        project = loaded.require()
        if project.screen(screen_id) is None:
            raise XdsError("UNKNOWN_SCREEN", f"no screen '{screen_id}'", status=404)
        cache_dir = root / "cache" / loaded.hash
        paths = await run_in_threadpool(screens.ensure_rendered, root, project, cache_dir, [screen_id])
        return FileResponse(paths[screen_id], media_type="image/png")

    @app.get("/api/formats")
    async def get_formats(preset: str | None = None, width: int | None = None,
                          height: int | None = None) -> dict[str, Any]:
        guide = None
        if preset in formats.CATALOG and not (width and height):
            p = formats.CATALOG[preset]
            width, height = p.width, p.height
        if width and height:
            guide = formats.derive(Format(preset=preset, width=width, height=height)).to_json()
        return ok(catalog=formats.catalog_json(), guide=guide)

    # --- projects ----------------------------------------------------------------------------

    @app.get("/api/projects")
    async def list_projects() -> dict[str, Any]:
        base = projects_dir()
        items = []
        if base.is_dir():
            for d in sorted(base.iterdir()):
                pj = d / proj.PROJECT_FILE
                if not pj.is_file():
                    continue
                try:
                    raw = json.loads(pj.read_text())
                except Exception:
                    raw = {}
                items.append({"path": str(d), "id": raw.get("id"), "name": raw.get("name") or d.name,
                              "schemaVersion": raw.get("schemaVersion"),
                              "active": state.root is not None and d.resolve() == state.root})
        return ok(dir=str(base), projects=items)

    async def activate(path: str | Path) -> Path:
        state.root = proj.find_root(path)
        await state.start_watching()
        state.broadcast("project", {"root": str(state.root)})
        return state.root

    @app.post("/api/projects/open")
    async def open_project(body: dict[str, Any]) -> dict[str, Any]:
        return ok(root=str(await activate(body.get("path", ""))))

    @app.post("/api/projects/init")
    async def init_project(body: dict[str, Any]) -> dict[str, Any]:
        path = body.get("path") or str(projects_dir() / (body.get("name") or "untitled"))
        root = await run_in_threadpool(proj.init, Path(path).expanduser(), name=body.get("name"),
                                       preset=body.get("format") or "instagram-portrait")
        return ok(root=str(await activate(root)))

    @app.post("/api/projects/choose")
    async def choose_folder() -> dict[str, Any]:
        script = 'POSIX path of (choose folder with prompt "Choose an XDS project folder")'
        try:
            out = await run_in_threadpool(lambda: subprocess.run(
                ["osascript", "-e", script], capture_output=True, text=True, timeout=300))
        except (FileNotFoundError, subprocess.TimeoutExpired):
            raise XdsError("UNSUPPORTED", "the folder picker needs macOS", status=400)
        path = out.stdout.strip() if out.returncode == 0 else ""
        return ok(path=path.rstrip("/") or None)

    # --- audit and export ----------------------------------------------------------------------

    @app.post("/api/audit")
    async def audit(body: dict[str, Any] | None = None) -> dict[str, Any]:
        from . import export

        root = state.require_root()
        slide = (body or {}).get("slideId")
        report = await run_in_threadpool(export.audit, root, slide_ids=[slide] if slide else None,
                                         progress=state.progress("audit"))
        return ok(report=dump(report))

    @app.post("/api/export")
    async def do_export(body: dict[str, Any] | None = None) -> dict[str, Any]:
        from . import export

        root = state.require_root()
        body = body or {}
        fmt = body.get("format", "png")
        if fmt not in ("png", "pdf"):
            raise XdsError("BAD_REQUEST", f"unknown export format '{fmt}' (png or pdf)", status=422)
        target = body.get("target") or None
        if target and target not in formats.CATALOG:
            raise XdsError("UNKNOWN_FORMAT", f"'{target}' is not a format preset", status=422)
        result = await run_in_threadpool(export.export, root, force=bool(body.get("force")), format=fmt,
                                         target=target, progress=state.progress("export"))
        return ok(**result)

    @app.get("/api/exports")
    async def list_exports() -> dict[str, Any]:
        from . import export

        return ok(exports=export.list_exports(state.require_root()))

    # --- commands that register things in project.json ------------------------------------------

    @app.get("/api/starters")
    async def starters() -> dict[str, Any]:
        from . import designs

        return ok(designs=designs.starters())

    @app.post("/api/designs/add")
    async def add_design(body: dict[str, Any]) -> dict[str, Any]:
        from . import designs

        return ok(id=await run_in_threadpool(designs.add_starter, state.require_root(), body.get("starter", "")))

    @app.post("/api/models/import")
    async def import_model(file: UploadFile = File(...), id: str = Form(...), name: str | None = Form(None),
                           slide: str | None = Form(None), replace: bool = Form(False)) -> dict[str, Any]:
        from . import models3d

        root = state.require_root()
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / Path(file.filename or "model.glb").name
            with dest.open("wb") as f:
                shutil.copyfileobj(file.file, f)
            result = await run_in_threadpool(models3d.add, root, dest, id=id, name=name, slide=slide,
                                             replace=replace)
        return ok(result=result)

    @app.post("/api/reflow")
    async def reflow_doc(body: dict[str, Any]) -> dict[str, Any]:
        """Reflow a document (not the file) to another format; the editor commits the result."""
        from . import reflow

        if "project" not in body or "format" not in body:
            raise XdsError("BAD_REQUEST", "body needs { project, format }", status=422)
        target = Format.model_validate(body["format"])
        new, report = await run_in_threadpool(reflow.reflow, body["project"], target)
        return ok(project=new, report=report)

    @app.get("/api/layouts")
    async def get_layouts() -> dict[str, Any]:
        from . import layouts

        return ok(layouts=layouts.list_layouts())

    @app.post("/api/layouts/apply")
    async def apply_layout(body: dict[str, Any]) -> dict[str, Any]:
        """`xds layout apply` for the active project (the editor saves first, then reloads)."""
        from . import layouts

        if not body.get("id"):
            raise XdsError("BAD_REQUEST", "body needs { id, slide?, mode?, addRoles? }", status=422)
        report = await run_in_threadpool(
            layouts.apply_project, state.require_root(), body["id"], slide=body.get("slide"),
            mode=body.get("mode", "fill"), add_roles=bool(body.get("addRoles", True)))
        return ok(report=report)

    @app.get("/api/snapshots")
    async def list_snapshots() -> dict[str, Any]:
        from . import snapshots

        return ok(snapshots=await run_in_threadpool(snapshots.list_snapshots, state.require_root()))

    @app.post("/api/snapshots")
    async def take_snapshot(body: dict[str, Any] | None = None) -> dict[str, Any]:
        from . import snapshots

        label = (body or {}).get("label")
        return ok(snapshot=await run_in_threadpool(snapshots.take, state.require_root(), label=label))

    @app.post("/api/snapshots/restore")
    async def restore_snapshot(body: dict[str, Any]) -> dict[str, Any]:
        """Put a snapshot back; the file change then reloads the editor."""
        from . import snapshots

        if not body.get("id"):
            raise XdsError("BAD_REQUEST", "body needs { id }", status=422)
        return ok(**await run_in_threadpool(snapshots.restore, state.require_root(), body["id"]))

    @app.delete("/api/snapshots/{snapshot_id}")
    async def delete_snapshot(snapshot_id: str) -> dict[str, Any]:
        from . import snapshots

        return ok(**await run_in_threadpool(snapshots.delete, state.require_root(), snapshot_id))

    @app.post("/api/migrate")
    async def migrate_project() -> dict[str, Any]:
        """`xds migrate` for the active project (backs up project.json first)."""
        from . import migrate

        return ok(report=await run_in_threadpool(migrate.run, state.require_root()))

    @app.get("/api/library")
    async def get_library() -> dict[str, Any]:
        from . import library

        return ok(models=library.models(), logos=library.logos())

    @app.post("/api/models/library")
    async def add_library_model(body: dict[str, Any]) -> dict[str, Any]:
        from . import models3d

        result = await run_in_threadpool(
            models3d.add_library, state.require_root(), body.get("model", ""), id=body.get("id"),
            slide=body.get("slide"), screen=body.get("screen"))
        return ok(result=result)

    @app.post("/api/fonts/fetch")
    async def fetch_fonts(body: dict[str, Any]) -> dict[str, Any]:
        from . import fonts

        return ok(fonts=await run_in_threadpool(fonts.fetch, state.require_root(), body.get("family", "")))

    # --- the studio (built) ---------------------------------------------------------------------

    if serve_studio:
        @app.get("/{path:path}", include_in_schema=False)
        async def studio(path: str) -> Response:
            if path.startswith("api/"):
                raise XdsError("NOT_FOUND", f"no route /{path}", status=404)
            index = STUDIO_DIST / "index.html"
            if not index.exists():
                return Response("The studio is not built. Run `npm run build`.", status_code=503)
            target = (STUDIO_DIST / path).resolve()
            if path and target.is_file() and STUDIO_DIST.resolve() in target.parents:
                return FileResponse(target)
            return FileResponse(index, headers={"Cache-Control": "no-cache"})

    return app
