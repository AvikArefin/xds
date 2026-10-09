/**
 * StudioState (data-models.md §7.1): one zustand store split into slices — document, selection,
 * view, audit, jobs (+ disk state and notices). `zundo` keeps undo history over the document's
 * `project` only (plus the selection that went with each edit, so undo restores it).
 *
 * Every edit goes through a guarded action (dataflow.md §1.1): the node's layer must match the
 * mode, the node must not be locked, Present rejects node edits, and a read-only document rejects
 * everything. No action writes a render node's `parts`, `animation` or `screens`.
 */
import { create, useStore } from "zustand";
import { temporal } from "zundo";
import type {
  AuditReport,
  Box,
  FrameCamera,
  FreeCamera,
  Finding,
  Format,
  ImageNode,
  Layer,
  Lighting,
  Node,
  Pose,
  Project,
  RenderNode,
  SceneObject,
  Slide,
  TypeNode,
  GroundNode,
} from "@xds/protocol";
import {
  addNode,
  addSlide as addSlideCore,
  alignRects,
  deleteSlide as deleteSlideCore,
  distributeRects,
  duplicateNodes,
  freshId,
  gapForTop,
  moveSlide as moveSlideCore,
  nudgeNodes,
  nudgePose,
  pxRectToBox,
  removeNodes,
  reorderInLayer,
  renderNodePose,
  updateNodes,
  updateSlide,
  type AlignHow,
  type ReorderTo,
  type StackPlacement,
} from "@xds/editor-core";
import type { LibraryLogo } from "../api";
import { ServerError, server, subscribeEvents } from "./server";
import type { DesignInfoJson, ExportEntry, GuideJson, Job, Mode, Notice, NoticeLevel } from "./types";
import { boxPx, effectiveLighting, getSlide, nodesOf, typeStyle } from "./model";

export * from "./types";
export * from "./model";

export const API_VERSION = 2;

type Tracked = Pick<StudioState, "project" | "selectedIds" | "activeSlideId" | "mode">;

export interface PromptRequest {
  title: string;
  message?: string;
  label?: string;
  value?: string;
  confirm?: string;
  multiline?: boolean;
  /** false: a confirmation without a text field (resolves "" or null). */
  input?: boolean;
  danger?: boolean;
  resolve: (v: string | null) => void;
}

export interface StudioState {
  // --- document
  status: "loading" | "ready" | "error";
  loadError: string | null;
  root: string | null;
  project: Project | null;
  savedProject: Project | null;
  savedJson: string;
  designs: Record<string, DesignInfoJson>;
  hash: string;
  fileHash: string;
  guide: GuideJson | null;
  check: { ok: boolean; findings: Finding[] };
  readOnly: boolean;
  saving: boolean;

  // --- selection
  mode: Mode;
  activeSlideId: string;
  selectedIds: string[];
  transformMode: "translate" | "rotate" | "scale";
  transformSpace: "world" | "local";
  /** Editor-only locks (not saved: the schema has no lock field). */
  locked: Record<string, boolean>;
  /** Where the active slide's stacked text blocks landed (from the type layer). Not saved, not in undo. */
  stackLayout: Record<string, StackPlacement>;

  // --- view
  zoom: number | "fit";
  fitZoom: number;
  snap: boolean;
  showGuides: boolean;
  /** Audit regions outlined on the canvas. A view setting: never saved, not in undo. */
  showAudit: boolean;
  /** Layers hidden on the canvas while editing. A view setting: never saved, not in undo. */
  hiddenLayers: Layer[];
  inspectorTab: string;
  commandPaletteOpen: boolean;
  projectBrowser: null | "open" | "new";
  focusRect: { slideId: string; x: number; y: number; w: number; h: number; t: number } | null;
  prompt: PromptRequest | null;

  // --- audit
  report: AuditReport | null;
  auditing: boolean;
  hoverFinding: Finding | null;

  // --- jobs
  jobs: Record<string, Job>;
  exportBlocked: Finding[] | null;
  /** The format of the last export started, so "Export anyway" repeats it. */
  exportFormat: "png" | "pdf";
  exports: ExportEntry[];

  // --- notices
  notices: Notice[];
}

export interface StudioActions {
  load(reason?: "initial" | "external" | "conflict" | "switch" | "refresh"): Promise<void>;
  save(): Promise<boolean>;
  notify(level: NoticeLevel, text: string): void;
  dismissNotice(id: number): void;
  ask(req: Omit<PromptRequest, "resolve">): Promise<string | null>;

  undo(): void;
  redo(): void;
  beginGesture(): void;
  endGesture(): void;
  cancelGesture(): void;

  setMode(mode: Mode): void;
  setActiveSlide(id: string): void;
  select(ids: string[], opts?: { additive?: boolean; toggle?: boolean }): void;
  selectAll(): void;
  clearSelection(): void;
  setTransformMode(m: StudioState["transformMode"]): void;
  setTransformSpace(s: StudioState["transformSpace"]): void;
  toggleLock(id: string): void;
  /** The type layer laid out stacked blocks: keep their box.y in step (no undo step, not dirty). */
  syncStackLayout(placements: Map<string, StackPlacement>): void;

  setZoom(z: number | "fit"): void;
  zoomBy(f: number): void;
  setFitZoom(z: number): void;
  toggleSnap(): void;
  toggleGuides(): void;
  toggleAudit(): void;
  toggleLayer(layer: Layer): void;
  setPalette(open: boolean): void;
  setProjectBrowser(tab: StudioState["projectBrowser"]): void;

  /** A guarded edit of nodes on the active slide (ids failing the guard are dropped). */
  editNodes(ids: string[], fn: (n: Node) => Node, opts?: { ignoreLock?: boolean; quiet?: boolean }): boolean;
  setBoxes(boxes: Record<string, Box>): void;
  patchBox(ids: string[], patch: Partial<Box>): void;
  patchData(ids: string[], patch: Record<string, unknown>, remove?: string[]): void;
  renameNode(id: string, name: string): void;
  toggleHidden(id: string): void;
  deleteSelection(): void;
  duplicateSelection(): void;
  nudge(dx: number, dy: number, big: boolean): void;
  reorder(id: string, to: ReorderTo): void;
  align(how: AlignHow): void;
  distribute(axis: "x" | "y", snapped: boolean): void;

  addText(role: string): void;
  addImage(assetId: string, aspect?: number): void;
  /** Register a library logo as an asset (by reference) if the project hasn't yet, and place it. */
  addLibraryLogo(logo: LibraryLogo): void;
  addBackground(designId: string): void;
  addShape(kind: SceneObject["kind"]): void;
  addObjectToSlide(objectId: string): void;
  commitPoses(poses: Record<string, Pose>): void;
  setCamera(cam: FrameCamera | FreeCamera | null): void;
  patchCamera(patch: Partial<FrameCamera>): void;
  patchLighting(patch: Partial<Lighting>, remove?: (keyof Lighting)[]): void;
  useLightingForAll(): void;

  editProject(fn: (p: Project) => Project, what?: string): boolean;
  setFormat(fmt: Format): void;
  setLayerOrder(order: Layer[]): void;

  addSlide(): void;
  deleteSlide(id: string): void;
  moveSlide(id: string, to: number): void;
  renameSlide(id: string, name: string): void;

  runAudit(): Promise<void>;
  focusFinding(f: Finding): void;
  setHoverFinding(f: Finding | null): void;
  markIntentional(f: Finding): Promise<void>;
  /** PNGs, one per slide, or the deck as one PDF. */
  exportSlides(format: "png" | "pdf", force?: boolean): Promise<void>;
  loadExports(): Promise<void>;
  dismissExportBlocked(): void;
  saveThen(what: string): Promise<boolean>;
  connect(): () => void;
}

export type Studio = StudioState & StudioActions;

const initial: StudioState = {
  status: "loading",
  loadError: null,
  root: null,
  project: null,
  savedProject: null,
  savedJson: "",
  designs: {},
  hash: "",
  fileHash: "",
  guide: null,
  check: { ok: true, findings: [] },
  readOnly: true,
  saving: false,
  mode: "present",
  activeSlideId: "",
  selectedIds: [],
  transformMode: "translate",
  transformSpace: "world",
  locked: {},
  stackLayout: {},
  zoom: "fit",
  fitZoom: 0.5,
  snap: true,
  showGuides: false,
  showAudit: true,
  hiddenLayers: [],
  inspectorTab: "",
  commandPaletteOpen: false,
  projectBrowser: null,
  focusRect: null,
  prompt: null,
  report: null,
  auditing: false,
  hoverFinding: null,
  jobs: {},
  exportBlocked: null,
  exportFormat: "png",
  exports: [],
  notices: [],
};

let noticeSeq = 1;
let gestureBase: Tracked | null = null;
const HISTORY_LIMIT = 200;

const track = (s: StudioState): Tracked => ({
  project: s.project,
  selectedIds: s.selectedIds,
  activeSlideId: s.activeSlideId,
  mode: s.mode,
});

const dirtyCache = { project: null as Project | null, saved: "", dirty: false };
/** `project` differs from the last loaded/saved copy. */
export function isDirty(s: Pick<StudioState, "project" | "savedProject" | "savedJson">): boolean {
  if (!s.project || s.project === s.savedProject) return false;
  if (dirtyCache.project === s.project && dirtyCache.saved === s.savedJson) return dirtyCache.dirty;
  const dirty = JSON.stringify(s.project) !== s.savedJson;
  Object.assign(dirtyCache, { project: s.project, saved: s.savedJson, dirty });
  return dirty;
}

export const useStudio = create<Studio>()(
  temporal(
    (set, get) => {
      // ---- small internals -------------------------------------------------------------------
      const notify = (level: NoticeLevel, text: string) => {
        const id = noticeSeq++;
        set({ notices: [{ id, level, text }] }); // the status bar shows the latest notice only
        if (level === "info" || level === "success")
          setTimeout(() => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })), 5000);
      };
      const job = (kind: Job["kind"], patch: Partial<Job>) =>
        set((s) => ({
          jobs: { ...s.jobs, [kind]: { ...(s.jobs[kind] ?? { kind, running: false, lines: [] }), ...patch } },
        }));

      const canEditDoc = (quiet = false): boolean => {
        const s = get();
        if (!s.project) return false;
        if (s.readOnly) {
          if (!quiet) notify("warning", "This project is read-only until its findings are fixed.");
          return false;
        }
        return true;
      };

      /**
       * A stacked block's box.y follows its layout (see syncStackLayout), so an edit that moves it
       * (drag, nudge, align, the Y field) is turned into a new stack gap. When its anchor moved
       * in the same edit, only the difference counts: blocks moved together keep their gap.
       * With snapping on, gaps are whole units.
       */
      const withStackGaps = (prev: Project | null, next: Project): Project => {
        const s = get();
        const before = getSlide(prev, s.activeSlideId);
        const after = getSlide(next, s.activeSlideId);
        if (!before || !after || before === after) return next;
        const H = next.format.height;
        const u = s.guide?.u ?? Math.max(4, Math.round(Math.min(next.format.width, H) / 135));
        const old = new Map(nodesOf(before).map((n) => [n.id, n]));
        const shift = (id: string): number => {
          const a = old.get(id);
          const b = nodesOf(after).find((n) => n.id === id);
          return a && b && a.layer !== "render" && b.layer !== "render" ? ((b.box.y - a.box.y) / 100) * H : 0;
        };
        let changed = false;
        const nodes = nodesOf(after).map((n) => {
          const was = old.get(n.id);
          const place = s.stackLayout[n.id];
          if (n.layer !== "type" || !n.data.stack || !place || was?.layer !== "type" || !was.data.stack) return n;
          if (n.box.y === was.box.y || JSON.stringify(n.data.stack) !== JSON.stringify(was.data.stack)) return n;
          const top = (n.box.y / 100) * H - shift(place.anchor);
          const gap = gapForTop(place, top, u, s.snap ? 1 : 0);
          if (gap === n.data.stack.gap) return n;
          changed = true;
          return { ...n, data: { ...n.data, stack: { ...n.data.stack, gap } } } as Node;
        });
        return changed ? updateSlide(next, after.id, (sl) => ({ ...sl, nodes: nodes as Slide["nodes"] })) : next;
      };

      /** Replace the project (one undo step unless inside a gesture). */
      const commit = (project: Project, extra: Partial<StudioState> = {}) => {
        if (project === get().project && !Object.keys(extra).length) return;
        set({ project: project ? withStackGaps(get().project, project) : project, ...extra });
      };

      const slideOf = () => getSlide(get().project, get().activeSlideId);

      /** Add an image node for `assetId` inside the margin; a wide (or tall) one keeps `aspect`. */
      const placeImage = (project: Project, assetId: string, aspect?: number) => {
        const s = get();
        const node: ImageNode = {
          id: assetId,
          layer: "image",
          box: { x: 0, y: 0, w: 10, h: 10 },
          data: { asset: assetId, fit: "contain" },
        };
        const side = (s.guide ? Math.min(s.guide.content.x1 - s.guide.content.x0, s.guide.content.y1 - s.guide.content.y0) : 400) * 0.4;
        const size = aspect ? (aspect >= 1 ? { w: side, h: side / aspect } : { w: side * aspect, h: side }) : { w: side, h: side };
        const r = addNode(project, s.activeSlideId, node, s.guide ?? undefined, size);
        commit(r.project, { selectedIds: [r.id] });
      };

      /** Node ids on the active slide that pass the guard. */
      const guardIds = (ids: string[], opts: { ignoreLock?: boolean; quiet?: boolean } = {}): string[] => {
        const s = get();
        if (!canEditDoc(opts.quiet)) return [];
        if (s.mode === "present") {
          if (!opts.quiet) notify("info", "Present mode is read-only. Pick a layer (2–5) to edit.");
          return [];
        }
        const nodes = nodesOf(slideOf());
        const out: string[] = [];
        let lockedHit = false;
        for (const id of ids) {
          const n = nodes.find((x) => x.id === id);
          if (!n || n.layer !== s.mode) continue;
          if (!opts.ignoreLock && s.locked[id]) {
            lockedHit = true;
            continue;
          }
          out.push(id);
        }
        if (lockedHit && !out.length && !opts.quiet) notify("info", "Locked: unlock it in the layer list to edit.");
        return out;
      };

      const applyLoaded = async (reason: "initial" | "external" | "conflict" | "switch" | "refresh") => {
        const before = get();
        const wasDirty = isDirty(before);
        let data;
        try {
          data = await server.project();
        } catch (e) {
          const msg = (e as Error).message;
          const fatal = e instanceof ServerError && e.code === "API_VERSION_MISMATCH";
          if (fatal || reason === "initial" || reason === "switch") set({ status: "error", loadError: msg });
          else notify("error", `Reload failed: ${msg}`);
          return;
        }
        if (data.apiVersion !== API_VERSION) {
          set({
            status: "error",
            loadError: `The server speaks API version ${data.apiVersion}; this editor needs ${API_VERSION}. Update XDS.`,
          });
          return;
        }
        const raw = data.project as Project | null;
        // An older schema has slides too, but not the shapes the editor reads: show the migrate screen instead.
        const migrate = data.check.findings.some((f) => f.rule === "MIGRATION_NEEDED");
        const parsed = !migrate && raw && typeof raw === "object" && Array.isArray((raw as Project).slides) ? raw : null;
        const readOnly = data.readOnly || !data.check.ok || !parsed;
        const keepSession = reason === "external" || reason === "conflict" || reason === "refresh";
        const slides = parsed?.slides ?? [];
        const activeSlideId =
          keepSession && slides.some((s) => s.id === before.activeSlideId) ? before.activeSlideId : slides[0]?.id ?? "";
        const existing = new Set(
          slides.flatMap((s) => (s.id === activeSlideId ? (s.nodes ?? []).map((n) => n.id) : [])),
        );
        const temporalApi = useStudio.temporal.getState();
        temporalApi.pause();
        set({
          status: "ready",
          loadError: null,
          root: data.root,
          project: parsed,
          savedProject: parsed,
          savedJson: parsed ? JSON.stringify(parsed) : "",
          designs: data.designs ?? {},
          hash: data.hash,
          fileHash: data.fileHash,
          guide: data.guide,
          check: data.check,
          readOnly,
          activeSlideId,
          selectedIds: keepSession ? before.selectedIds.filter((id) => existing.has(id)) : [],
          mode: keepSession ? before.mode : "present",
          locked: keepSession ? before.locked : {},
          report: keepSession ? before.report : null,
          exportBlocked: null,
        });
        temporalApi.resume();
        useStudio.temporal.getState().clear();
        gestureBase = null;
        if (reason === "external" && wasDirty)
          notify("warning", "The project changed on disk and was reloaded. Your unsaved edits were replaced.");
        else if (reason === "external") notify("info", "Reloaded: the project changed on disk.");
        else if (reason === "conflict") notify("warning", "The file changed on disk before saving; reloaded it. Your edits were replaced.");
        if (readOnly && parsed) notify("error", `Read-only: ${data.check.findings.length} finding(s) must be fixed in the file.`);
        if (reason === "initial" || reason === "switch") void get().loadExports();
      };

      return {
        ...initial,

        // ---- document ------------------------------------------------------------------------
        load: (reason = "initial") => applyLoaded(reason),

        save: async () => {
          const s = get();
          if (!s.project || s.readOnly) {
            if (s.readOnly) notify("warning", "Read-only project: nothing to save.");
            return false;
          }
          if (s.saving) return false;
          if (!isDirty(s)) return true;
          const project = s.project;
          set({ saving: true });
          try {
            const r = await server.save(project, s.fileHash);
            set({ savedProject: project, savedJson: JSON.stringify(project), hash: r.hash, fileHash: r.fileHash });
            notify("success", "Saved");
            return true;
          } catch (e) {
            if (e instanceof ServerError && e.status === 409) {
              await applyLoaded("conflict");
            } else if (e instanceof ServerError && e.status === 422) {
              const first = Array.isArray(e.details) ? (e.details as Finding[])[0] : undefined;
              notify("error", `Not saved: ${first?.message ?? e.message}${!first && e.path ? ` (${e.path})` : ""}`);
            } else notify("error", `Not saved: ${(e as Error).message}`);
            return false;
          } finally {
            set({ saving: false });
          }
        },

        saveThen: async (what: string) => {
          if (!isDirty(get())) return true;
          const ok = await get().save();
          if (!ok) notify("warning", `${what} needs the project saved first.`);
          return ok;
        },

        notify,
        dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
        ask: (req) =>
          new Promise<string | null>((resolve) =>
            set({
              prompt: {
                ...req,
                resolve: (v) => {
                  set({ prompt: null });
                  resolve(v);
                },
              },
            }),
          ),

        // ---- history ---------------------------------------------------------------------------
        undo: () => {
          if (gestureBase) return;
          const t = useStudio.temporal.getState();
          if (!t.pastStates.length) return;
          t.undo();
          fixSelectionAfterHistory();
        },
        redo: () => {
          if (gestureBase) return;
          const t = useStudio.temporal.getState();
          if (!t.futureStates.length) return;
          t.redo();
          fixSelectionAfterHistory();
        },
        syncStackLayout: (placements) => {
          const s = get();
          set({ stackLayout: Object.fromEntries(placements) });
          if (!s.project) return;
          const H = s.project.format.height;
          const sync = (p: Project | null): Project | null => {
            const slide = getSlide(p, s.activeSlideId);
            if (!p || !slide) return p;
            let changed = false;
            const nodes = nodesOf(slide).map((n) => {
              const place = placements.get(n.id);
              if (n.layer !== "type" || !n.data.stack || !place) return n;
              const y = Math.round((place.top / H) * 100 * 1000) / 1000;
              if (Math.abs(n.box.y - y) < 0.0005) return n;
              changed = true;
              return { ...n, box: { ...n.box, y } } as Node;
            });
            return changed ? updateSlide(p, slide.id, (sl) => ({ ...sl, nodes: nodes as Slide["nodes"] })) : p;
          };
          const project = sync(s.project);
          if (project === s.project) return;
          const saved = sync(s.savedProject);
          const history = useStudio.temporal.getState();
          const tracking = history.isTracking;
          if (tracking) history.pause();
          set({ project, savedProject: saved, savedJson: saved === s.savedProject ? s.savedJson : JSON.stringify(saved) });
          if (tracking) history.resume();
        },
        beginGesture: () => {
          if (gestureBase) return;
          gestureBase = track(get());
          useStudio.temporal.getState().pause();
        },
        endGesture: () => {
          const base = gestureBase;
          gestureBase = null;
          const t = useStudio.temporal;
          t.getState().resume();
          if (base && base.project !== get().project) {
            t.setState((h) => ({ pastStates: [...h.pastStates, base].slice(-HISTORY_LIMIT), futureStates: [] }));
          }
        },
        cancelGesture: () => {
          const base = gestureBase;
          gestureBase = null;
          if (base) set({ project: base.project });
          useStudio.temporal.getState().resume();
        },

        // ---- selection -------------------------------------------------------------------------
        setMode: (mode) => {
          if (mode === get().mode) return;
          set({ mode, selectedIds: [] });
        },
        setActiveSlide: (id) => {
          if (id === get().activeSlideId) return;
          set({ activeSlideId: id, selectedIds: [] });
        },
        select: (ids, opts = {}) => {
          const s = get();
          if (s.mode === "present") return set({ selectedIds: [] });
          const nodes = nodesOf(slideOf());
          const valid = ids.filter((id) => nodes.some((n) => n.id === id && n.layer === s.mode));
          if (opts.additive || opts.toggle) {
            const cur = new Set(s.selectedIds);
            for (const id of valid) {
              if (opts.toggle && cur.has(id)) cur.delete(id);
              else cur.add(id);
            }
            set({ selectedIds: [...cur] });
          } else set({ selectedIds: valid });
        },
        selectAll: () => {
          const s = get();
          if (s.mode === "present") return;
          set({
            selectedIds: nodesOf(slideOf())
              .filter((n) => n.layer === s.mode && !n.hidden && !s.locked[n.id])
              .map((n) => n.id),
          });
        },
        clearSelection: () => get().selectedIds.length && set({ selectedIds: [] }),
        setTransformMode: (transformMode) => set({ transformMode }),
        setTransformSpace: (transformSpace) => set({ transformSpace }),
        toggleLock: (id) => set((s) => ({ locked: { ...s.locked, [id]: !s.locked[id] } })),

        // ---- view ------------------------------------------------------------------------------
        setZoom: (zoom) => set({ zoom: zoom === "fit" ? "fit" : Math.min(8, Math.max(0.05, zoom)) }),
        zoomBy: (f) => {
          const s = get();
          const cur = s.zoom === "fit" ? s.fitZoom : s.zoom;
          get().setZoom(Math.round(cur * f * 100) / 100);
        },
        setFitZoom: (fitZoom) => set({ fitZoom }),
        toggleSnap: () => set((s) => ({ snap: !s.snap })),
        toggleGuides: () => set((s) => ({ showGuides: !s.showGuides })),
        toggleAudit: () => set((s) => ({ showAudit: !s.showAudit })),
        toggleLayer: (layer) =>
          set((s) => ({
            hiddenLayers: s.hiddenLayers.includes(layer) ? s.hiddenLayers.filter((l) => l !== layer) : [...s.hiddenLayers, layer],
          })),
        setPalette: (commandPaletteOpen) => set({ commandPaletteOpen }),
        setProjectBrowser: (projectBrowser) => set({ projectBrowser }),

        // ---- node edits ------------------------------------------------------------------------
        editNodes: (ids, fn, opts = {}) => {
          const ok = guardIds(ids, opts);
          if (!ok.length) return false;
          const s = get();
          commit(updateNodes(s.project!, s.activeSlideId, ok, fn));
          return true;
        },
        setBoxes: (boxes) => {
          get().editNodes(
            Object.keys(boxes),
            (n) => (n.layer === "render" ? n : ({ ...n, box: { ...boxes[n.id] } } as Node)),
            { quiet: true },
          );
        },
        patchBox: (ids, patch) => {
          get().editNodes(ids, (n) => {
            if (n.layer === "render") return n;
            const box = { ...n.box, ...patch } as Box;
            for (const k of Object.keys(patch) as (keyof Box)[]) if (patch[k] === undefined) delete box[k];
            return { ...n, box } as Node;
          });
        },
        patchData: (ids, patch, remove = []) => {
          const forbidden = ["parts", "animation", "screens"];
          get().editNodes(ids, (n) => {
            const data = { ...(n.data as unknown as Record<string, unknown>) };
            for (const [k, v] of Object.entries(patch)) {
              if (forbidden.includes(k)) continue;
              if (v === undefined) delete data[k];
              else data[k] = v;
            }
            for (const k of remove) if (!forbidden.includes(k)) delete data[k];
            return { ...n, data } as unknown as Node;
          });
        },
        renameNode: (id, name) =>
          void get().editNodes([id], (n) => {
            const out = { ...n } as Node;
            if (name.trim()) out.name = name.trim();
            else delete out.name;
            return out;
          }),
        toggleHidden: (id) =>
          void get().editNodes(
            [id],
            (n) => {
              const out = { ...n } as Node;
              if (n.hidden) delete out.hidden;
              else out.hidden = true;
              return out;
            },
            { ignoreLock: true },
          ),
        deleteSelection: () => {
          const s = get();
          const ok = guardIds(s.selectedIds);
          if (!ok.length) return;
          commit(removeNodes(s.project!, s.activeSlideId, ok), {
            selectedIds: s.selectedIds.filter((id) => !ok.includes(id)),
          });
        },
        duplicateSelection: () => {
          const s = get();
          const ok = guardIds(s.selectedIds);
          if (!ok.length) return;
          const r = duplicateNodes(s.project!, s.activeSlideId, ok);
          commit(r.project, { selectedIds: r.ids });
        },
        nudge: (dx, dy, big) => {
          const s = get();
          const ok = guardIds(s.selectedIds, { quiet: true });
          if (!ok.length || !s.project) return;
          if (s.mode === "render") {
            const step = big ? 0.1 : 0.01;
            commit(nudgePose(s.project, s.activeSlideId, ok, [dx * step, -dy * step, 0]));
          } else {
            const step = big ? s.guide?.u ?? 8 : 1;
            commit(
              nudgeNodes(s.project, s.activeSlideId, ok, dx * step, dy * step, s.project.format.width, s.project.format.height),
            );
          }
        },
        reorder: (id, to) => {
          const ok = guardIds([id]);
          if (!ok.length) return;
          const s = get();
          commit(reorderInLayer(s.project!, s.activeSlideId, id, to));
        },
        align: (how) => {
          const s = get();
          const ok = guardIds(s.selectedIds);
          if (ok.length < 2 || !s.project) return;
          const { width: W, height: H } = s.project.format;
          const nodes = nodesOf(slideOf()).filter((n) => ok.includes(n.id) && n.layer !== "render") as Exclude<
            Node,
            RenderNode
          >[];
          const out = alignRects(
            nodes.map((n) => boxPx(n.box, W, H)),
            how,
          );
          const boxes: Record<string, Box> = {};
          nodes.forEach((n, i) => (boxes[n.id] = pxRectToBox(out[i], W, H, n.box)));
          get().setBoxes(boxes);
        },
        distribute: (axis, snapped) => {
          const s = get();
          const ok = guardIds(s.selectedIds);
          if (ok.length < 2 || !s.project) return;
          const { width: W, height: H } = s.project.format;
          const nodes = nodesOf(slideOf()).filter((n) => ok.includes(n.id) && n.layer !== "render") as Exclude<
            Node,
            RenderNode
          >[];
          const out = distributeRects(
            nodes.map((n) => boxPx(n.box, W, H)),
            axis,
            snapped ? { unit: s.guide?.u ?? 8 } : {},
          );
          const boxes: Record<string, Box> = {};
          nodes.forEach((n, i) => (boxes[n.id] = pxRectToBox(out[i], W, H, n.box)));
          get().setBoxes(boxes);
        },

        // ---- adding ----------------------------------------------------------------------------
        addText: (role) => {
          const s = get();
          if (!canEditDoc() || !s.project) return;
          if (s.mode !== "type") return notify("info", "Switch to Text (2) to add text.");
          const node: TypeNode = {
            id: role || "text",
            layer: "type",
            box: { x: 0, y: 0, w: 10, h: 10 },
            data: { text: "New text", role },
          };
          const st = typeStyle(s.project, node, s.guide);
          const guide = s.guide;
          const content = guide ? guide.content.x1 - guide.content.x0 : s.project.format.width * 0.8;
          const size = { w: content * (st.level === "body" || st.level === "caption" ? 0.7 : 1), h: Math.ceil(st.size * st.lineHeight * 1.15) };
          const r = addNode(s.project, s.activeSlideId, node, guide ?? undefined, size);
          commit(r.project, { selectedIds: [r.id] });
        },
        addImage: (assetId, aspect) => {
          const s = get();
          if (!canEditDoc() || !s.project) return;
          if (s.mode !== "image") return notify("info", "Switch to 2D (3) to add an image.");
          placeImage(s.project, assetId, aspect);
        },
        addLibraryLogo: (logo) => {
          const s = get();
          if (!canEditDoc() || !s.project) return;
          if (s.mode !== "image") return notify("info", "Switch to 2D (3) to add an image.");
          const assets = s.project.assets ?? [];
          let asset = assets.find((a) => a.path === logo.path);
          let project = s.project;
          if (!asset) {
            const base = `${logo.brand}-${logo.file.replace(/\.[^.]+$/, "")}`;
            asset = { id: freshId(base, new Set(assets.map((a) => a.id))), path: logo.path, kind: "svg" };
            project = { ...project, assets: [...assets, asset] };
          }
          placeImage(project, asset.id, logo.width && logo.height ? logo.width / logo.height : undefined);
        },
        addBackground: (designId) => {
          const s = get();
          if (!canEditDoc() || !s.project) return;
          if (s.mode !== "ground") return notify("info", "Switch to Background (5) to add a background.");
          const node: GroundNode = {
            id: designId,
            layer: "ground",
            box: { x: 0, y: 0, w: 100, h: 100 },
            data: { design: designId },
          };
          const r = addNode(s.project, s.activeSlideId, node);
          commit(r.project, { selectedIds: [r.id] });
        },
        addShape: (kind) => {
          const s = get();
          if (!canEditDoc() || !s.project) return;
          if (s.mode !== "render") return notify("info", "Switch to 3D (4) to add a shape.");
          const p = s.project;
          const objIds = new Set((p.objects ?? []).map((o) => o.id));
          const id = freshId(kind, objIds);
          const params: Record<string, Record<string, number>> = {
            box: { width: 0.2, height: 0.2, depth: 0.2 },
            sphere: { radius: 0.1 },
            cylinder: { radius: 0.08, height: 0.2 },
            torus: { radius: 0.1, tube: 0.03 },
            plane: { width: 0.3, height: 0.3 },
          };
          const materials = [...(p.materials ?? [])];
          let material = materials[0]?.id;
          if (!material) {
            material = "default";
            materials.push({ id: material, name: "Default", color: "#d9d6d0", metalness: 0, roughness: 0.45 });
          }
          const obj: SceneObject = {
            id,
            name: kind[0].toUpperCase() + kind.slice(1),
            kind,
            params: params[kind] ?? {},
            material,
            pose: {
              position: [0, kind === "sphere" || kind === "torus" ? 0.1 : 0, 0],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
            },
          };
          const withObj = { ...p, materials, objects: [...(p.objects ?? []), obj] };
          const node: RenderNode = { id, layer: "render", data: { object: id } };
          const r = addNode(withObj, s.activeSlideId, node);
          commit(r.project, { selectedIds: [r.id] });
        },
        addObjectToSlide: (objectId) => {
          const s = get();
          if (!canEditDoc() || !s.project) return;
          if (nodesOf(slideOf()).some((n) => n.layer === "render" && n.data.object === objectId))
            return notify("info", "That object is already on this slide.");
          const r = addNode(s.project, s.activeSlideId, { id: objectId, layer: "render", data: { object: objectId } } as RenderNode);
          commit(r.project, { selectedIds: s.mode === "render" ? [r.id] : s.selectedIds });
        },
        commitPoses: (poses) => {
          const s = get();
          const ok = guardIds(Object.keys(poses));
          if (!ok.length) return;
          commit(
            updateNodes(s.project!, s.activeSlideId, ok, (n) => {
              if (n.layer !== "render") return n;
              const cur = renderNodePose(s.project!, n);
              return { ...n, data: { ...n.data, pose: { ...cur, ...poses[n.id] } } };
            }),
          );
        },
        setCamera: (cam) => {
          const s = get();
          if (!canEditDoc() || !s.project) return;
          commit(
            updateSlide(s.project, s.activeSlideId, (sl) => {
              const out = { ...sl } as Slide;
              if (cam) out.camera = cam;
              else delete out.camera;
              return out;
            }),
          );
        },
        patchCamera: (patch) => {
          const s = get();
          if (!canEditDoc(true) || !s.project) return;
          commit(
            updateSlide(s.project, s.activeSlideId, (sl) => {
              const cur = sl.camera && sl.camera.mode !== "free" ? (sl.camera as FrameCamera) : { mode: "frame" as const };
              return { ...sl, camera: { ...cur, ...patch, mode: "frame" } };
            }),
          );
        },
        patchLighting: (patch, remove = []) => {
          const s = get();
          if (!canEditDoc(true) || !s.project) return;
          commit(
            updateSlide(s.project, s.activeSlideId, (sl) => {
              const lighting = { ...(sl.lighting ?? {}), ...patch } as Record<string, unknown>;
              for (const k of remove) delete lighting[k];
              for (const k of Object.keys(lighting)) if (lighting[k] === undefined) delete lighting[k];
              const out = { ...sl, lighting } as Slide;
              if (!Object.keys(lighting).length) delete out.lighting;
              return out;
            }),
          );
        },
        useLightingForAll: () => {
          const s = get();
          if (!canEditDoc() || !s.project) return;
          const eff = effectiveLighting(s.project, slideOf());
          const lighting: Lighting = { ...eff };
          if (!lighting.tint) delete lighting.tint;
          const slides = s.project.slides.map((sl) => {
            if (!sl.lighting) return sl;
            const out = { ...sl };
            delete out.lighting;
            return out;
          }) as Project["slides"];
          commit({ ...s.project, lighting, slides });
          notify("success", "Lighting is now the project default for every slide.");
        },

        // ---- project-level ---------------------------------------------------------------------
        editProject: (fn) => {
          const s = get();
          if (!canEditDoc() || !s.project) return false;
          commit(fn(s.project));
          return true;
        },
        setFormat: (fmt) => void get().editProject((p) => ({ ...p, format: fmt })),
        setLayerOrder: (order) => void get().editProject((p) => ({ ...p, layerOrder: order })),

        addSlide: () => {
          const s = get();
          if (!canEditDoc() || !s.project) return;
          const r = addSlideCore(s.project, s.activeSlideId);
          commit(r.project, { activeSlideId: r.id, selectedIds: [] });
        },
        deleteSlide: (id) => {
          const s = get();
          if (!canEditDoc() || !s.project) return;
          if (s.project.slides.length <= 1) return notify("info", "A project needs at least one slide.");
          const idx = s.project.slides.findIndex((x) => x.id === id);
          const next = deleteSlideCore(s.project, id);
          const active = s.activeSlideId === id ? next.slides[Math.max(0, idx - 1)].id : s.activeSlideId;
          commit(next, { activeSlideId: active, selectedIds: s.activeSlideId === id ? [] : s.selectedIds });
        },
        moveSlide: (id, to) => {
          const s = get();
          if (!canEditDoc() || !s.project) return;
          commit(moveSlideCore(s.project, id, to));
        },
        renameSlide: (id, name) => {
          const s = get();
          if (!canEditDoc() || !s.project) return;
          commit(updateSlide(s.project, id, (sl) => ({ ...sl, name })));
        },

        // ---- audit -----------------------------------------------------------------------------
        runAudit: async () => {
          const s = get();
          if (s.auditing || !s.project) return;
          if (s.readOnly) return notify("warning", "Fix the structural findings first; the audit needs a valid project.");
          if (!(await get().saveThen("The audit"))) return;
          set({ auditing: true });
          job("audit", { running: true, lines: [] });
          try {
            const r = await server.audit();
            set({ report: r.report });
            const sum = r.report.summary;
            notify(
              sum.errors ? "warning" : "success",
              `Audit: ${sum.errors ?? 0} errors · ${sum.warnings ?? 0} warnings · ${sum.infos ?? 0} info`,
            );
          } catch (e) {
            notify("error", `Audit failed: ${(e as Error).message}`);
          } finally {
            set({ auditing: false });
            job("audit", { running: false });
          }
        },
        focusFinding: (f) => {
          const s = get();
          if (!s.project) return;
          const slideId = f.slideId ?? s.activeSlideId;
          const slide = getSlide(s.project, slideId);
          const node = nodesOf(slide).find((n) => f.nodes?.includes(n.id));
          const patch: Partial<StudioState> = { activeSlideId: slideId, showAudit: true };
          if (node) {
            patch.mode = node.layer;
            patch.selectedIds = [node.id];
          } else patch.selectedIds = [];
          let rect = f.region ?? null;
          if (!rect && node && node.layer !== "render") rect = boxPx(node.box, s.project.format.width, s.project.format.height);
          if (rect) patch.focusRect = { slideId, ...rect, t: Date.now() };
          set(patch);
        },
        setHoverFinding: (hoverFinding) => set({ hoverFinding }),
        markIntentional: async (f) => {
          const s = get();
          if (!canEditDoc() || !s.project) return;
          const reason = await get().ask({
            title: `Mark ${f.rule} as intentional`,
            message: f.message,
            label: "Reason (written into the project next to the element)",
            confirm: "Mark as intentional",
            multiline: true,
          });
          if (!reason?.trim()) return;
          const exc = { rule: f.rule, reason: reason.trim() };
          const slideId = f.slideId ?? s.activeSlideId;
          const p = get().project!;
          const slide = getSlide(p, slideId);
          const node = f.family === "composition" ? undefined : nodesOf(slide).find((n) => f.nodes?.includes(n.id));
          const add = <T extends { exceptions?: { rule: string; reason: string }[] }>(o: T): T => ({
            ...o,
            exceptions: [...(o.exceptions ?? []).filter((e) => e.rule !== f.rule), exc],
          });
          const next = node
            ? updateNodes(p, slideId, [node.id], (n) => add(n))
            : updateSlide(p, slideId, (sl) => add(sl));
          commit(next);
          notify("success", `Recorded an exception for ${f.rule} on ${node ? node.id : `slide ${slideId}`}. Save and re-run the audit.`);
        },

        // ---- export ----------------------------------------------------------------------------
        exportSlides: async (format, force = false) => {
          const s = get();
          if (!s.project || s.jobs.export?.running) return;
          if (s.readOnly) return notify("warning", "Fix the structural findings first.");
          // The export must match the file on disk (dataflow §7), so it never saves on its own.
          if (isDirty(s)) return notify("warning", "Save first: the export renders the saved file.");
          set({ exportBlocked: null, exportFormat: format });
          job("export", { running: true, lines: [] });
          try {
            const r = await server.exportSlides(format, force);
            notify("success", `Exported ${r.files.length} file(s) to ${r.dir}`);
            await get().loadExports();
          } catch (e) {
            if (e instanceof ServerError && e.code === "EXPORT_BLOCKED") {
              set({ exportBlocked: (e.details as Finding[]) ?? [] });
              notify("warning", "Export stopped: the audit has open errors.");
            } else notify("error", `Export failed: ${(e as Error).message}`);
          } finally {
            job("export", { running: false });
          }
        },
        loadExports: async () => {
          try {
            const r = await server.exports();
            set({ exports: r.exports });
          } catch {
            /* no exports yet */
          }
        },
        dismissExportBlocked: () => set({ exportBlocked: null }),

        // ---- server events ---------------------------------------------------------------------
        connect: () =>
          subscribeEvents({
            changed: (d) => {
              const s = get();
              if (d.hash === s.hash && d.fileHash === s.fileHash) return;
              if (s.saving) return;
              void applyLoaded("external");
            },
            progress: (d) => {
              const kind = (d.job === "export" ? "export" : d.job === "audit" ? "audit" : d.job) as Job["kind"];
              set((st) => {
                const j = st.jobs[kind] ?? { kind, running: true, lines: [] };
                return { jobs: { ...st.jobs, [kind]: { ...j, lines: [...j.lines.slice(-200), d.line] } } };
              });
            },
            project: (d) => {
              if (d.root !== get().root) void applyLoaded("switch");
            },
          }),
      };

      function fixSelectionAfterHistory() {
        const s = get();
        const slide = getSlide(s.project, s.activeSlideId) ?? s.project?.slides[0] ?? null;
        const nodes = nodesOf(slide);
        const sel = s.selectedIds.filter((id) => nodes.some((n) => n.id === id && n.layer === s.mode));
        if (slide?.id !== s.activeSlideId || sel.length !== s.selectedIds.length)
          useStudio.setState({ activeSlideId: slide?.id ?? "", selectedIds: sel });
      }
    },
    {
      partialize: (s) => track(s),
      equality: (a, b) => a.project === b.project,
      limit: HISTORY_LIMIT,
    },
  ),
);

/** Convenience: the active slide. */
export const useActiveSlide = () => useStudio((s) => getSlide(s.project, s.activeSlideId));
export const useDirty = () => useStudio(isDirty);
export const useCanUndo = () => useStore(useStudio.temporal, (t) => t.pastStates.length > 0);
export const useCanRedo = () => useStore(useStudio.temporal, (t) => t.futureStates.length > 0);
