/**
 * Typed client for the local HTTP API (xds/api.py). Every call returns the payload of
 * `{ ok: true, ...payload }` or throws an `ApiError`.
 */
import type { Project } from "@xds/protocol";
import type {
  AuditResponse,
  ExportEntry,
  ExportResponse,
  FormatsResponse,
  ModelImportResult,
  ProjectResponse,
  ProjectsResponse,
  SaveResponse,
  ServerEvent,
} from "./types";

export const API_VERSION = 2;

export class ApiError extends Error {
  code: string;
  path?: string;
  details?: unknown;
  status: number;

  constructor(code: string, message: string, status: number, path?: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.path = path;
    this.details = details;
  }
}

type Body = Record<string, unknown> | FormData | undefined;

async function request<T>(method: string, url: string, body?: Body): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw new ApiError("NETWORK", `cannot reach the XDS server (${(e as Error).message})`, 0);
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    throw new ApiError("BAD_RESPONSE", `${method} ${url}: HTTP ${res.status}, not JSON`, res.status);
  }
  const j = json as { ok?: boolean; error?: { code?: string; message?: string; path?: string; details?: unknown } };
  if (!res.ok || j.ok === false) {
    const e = j.error ?? {};
    throw new ApiError(e.code ?? `HTTP_${res.status}`, e.message ?? `${method} ${url} failed`, res.status, e.path, e.details);
  }
  const { ok: _ok, ...payload } = j as Record<string, unknown>;
  return payload as T;
}

export const api = {
  /** Loads the project and checks the backend speaks this client's API version. */
  async project(): Promise<ProjectResponse> {
    const r = await request<ProjectResponse>("GET", "/api/project");
    if (r.apiVersion !== API_VERSION) {
      throw new ApiError(
        "API_VERSION_MISMATCH",
        `the server speaks API version ${r.apiVersion}, this studio needs ${API_VERSION}; restart \`xds open\``,
        0,
      );
    }
    return r;
  },
  saveProject: (project: Project, baseHash: string) => request<SaveResponse>("PUT", "/api/project", { project, baseHash }),
  formats: (q: { preset?: string; width?: number; height?: number } = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
    const qs = p.toString();
    return request<FormatsResponse>("GET", `/api/formats${qs ? `?${qs}` : ""}`);
  },
  projects: () => request<ProjectsResponse>("GET", "/api/projects"),
  openProject: (path: string) => request<{ root: string }>("POST", "/api/projects/open", { path }),
  initProject: (body: { path: string; name: string; format: string }) =>
    request<{ root: string }>("POST", "/api/projects/init", body),
  chooseFolder: () => request<{ path: string | null }>("POST", "/api/projects/choose", {}),
  audit: (slideId?: string) => request<AuditResponse>("POST", "/api/audit", slideId ? { slideId } : {}),
  export: (force = false) => request<ExportResponse>("POST", "/api/export", { force }),
  exports: () => request<{ exports: ExportEntry[] }>("GET", "/api/exports"),
  starters: () => request<{ designs: string[] }>("GET", "/api/starters"),
  addDesign: (starter: string) => request<{ id: string }>("POST", "/api/designs/add", { starter }),
  importModel: (file: File | Blob, id: string, opts: { name?: string; slide?: string; replace?: boolean } = {}) => {
    const fd = new FormData();
    fd.set("file", file, file instanceof File ? file.name : "model.glb");
    fd.set("id", id);
    if (opts.name) fd.set("name", opts.name);
    if (opts.slide) fd.set("slide", opts.slide);
    if (opts.replace) fd.set("replace", "true");
    return request<{ result: ModelImportResult }>("POST", "/api/models/import", fd);
  },
  fetchFonts: (family: string) => request<{ fonts: unknown[] }>("POST", "/api/fonts/fetch", { family }),
};

/** URL of a project file (project-relative path). `hash` busts the browser cache when sources change. */
export function fileUrl(path: string, hash?: string): string {
  const clean = path.replace(/^\.?\//, "").split("/").map(encodeURIComponent).join("/");
  return `/api/files/${clean}${hash ? `?h=${encodeURIComponent(hash)}` : ""}`;
}

/** URL of a screen's rendered PNG for the current source hash. */
export function screenUrl(screenId: string, hash: string): string {
  return `/api/screens/${encodeURIComponent(screenId)}.png?h=${encodeURIComponent(hash)}`;
}

/** Subscribe to /api/events. Returns an unsubscribe function. EventSource reconnects by itself. */
export function subscribe(onEvent: (e: ServerEvent) => void): () => void {
  const es = new EventSource("/api/events");
  const parse = (m: MessageEvent) => {
    try {
      return JSON.parse(m.data);
    } catch {
      return {};
    }
  };
  es.addEventListener("changed", (m) => onEvent({ type: "changed", ...parse(m as MessageEvent) }));
  es.addEventListener("progress", (m) => onEvent({ type: "progress", ...parse(m as MessageEvent) }));
  es.addEventListener("project", (m) => onEvent({ type: "project", ...parse(m as MessageEvent) }));
  es.onopen = () => onEvent({ type: "open" });
  es.onerror = () => onEvent({ type: "error" });
  return () => es.close();
}
