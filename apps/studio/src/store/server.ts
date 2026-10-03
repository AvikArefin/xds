/**
 * The store's seam to the HTTP API: a thin adapter over the typed client in `../api`.
 */
import { ApiError, api, fileUrl, subscribe } from "../api";

export { ApiError as ServerError, fileUrl };

export const server = {
  project: () => api.project(),
  save: api.saveProject,
  formats: api.formats,
  projects: api.projects,
  openProject: api.openProject,
  initProject: (path: string, name: string, format: string) => api.initProject({ path, name, format }),
  chooseFolder: api.chooseFolder,
  audit: api.audit,
  exportPng: api.export,
  exports: api.exports,
  starters: api.starters,
  addDesign: api.addDesign,
  importModel: api.importModel,
  fetchFonts: api.fetchFonts,
};

export interface ServerEvents {
  changed?: (d: { hash: string; fileHash: string }) => void;
  progress?: (d: { job: string; line: string }) => void;
  project?: (d: { root: string }) => void;
}

/** Subscribe to `/api/events` (SSE). Returns an unsubscribe function. */
export function subscribeEvents(h: ServerEvents): () => void {
  if (typeof EventSource === "undefined") return () => {};
  return subscribe((e) => {
    if (e.type === "changed") h.changed?.(e);
    else if (e.type === "progress") h.progress?.(e);
    else if (e.type === "project") h.project?.(e);
  });
}
