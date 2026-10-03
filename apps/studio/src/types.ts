/** Response shapes of the local HTTP API (xds/api.py). The project schema itself is @xds/protocol. */
import type { AuditReport, DesignManifest, ExportRecord, Finding } from "@xds/protocol";

export type Level = "display" | "headline" | "subhead" | "body" | "caption";

/** One type band of `formats.Guide.to_json()` (snake_case keys, px values). */
export interface GuideBand {
  level: Level;
  default: number;
  min: number;
  max: number;
  line_height: [number, number];
  max_lines: number;
  chars: [number | null, number | null];
  lc_min: number;
}

export interface Zone {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** `formats.derive(...).to_json()`. */
export interface Guide {
  preset: string;
  label: string;
  width: number;
  height: number;
  view_width: number | null;
  s: number;
  k: number;
  u: number;
  m: number;
  margins: { top: number; right: number; bottom: number; left: number };
  content: { x0: number; x1: number; y0: number; y1: number };
  spacing_scale: number[];
  safe_zones: Zone[];
  bands: Record<Level, GuideBand>;
  budget?: Record<string, number>;
  subject_height?: [number, number];
  percent?: {
    m: { x: number; y: number };
    u: { x: number; y: number };
    margins: Record<string, number>;
  };
}

export interface DesignInfo {
  id: string;
  svg: string;
  manifest: DesignManifest | null;
  error?: string;
}

export interface ProjectCheck {
  ok: boolean;
  findings: Finding[];
}

export interface ProjectResponse {
  apiVersion: number;
  root: string;
  /** Raw project.json; may be invalid (then `readOnly` is true and `check` says why). */
  project: unknown;
  designs: Record<string, DesignInfo>;
  hash: string;
  fileHash: string;
  check: ProjectCheck;
  readOnly: boolean;
  guide: Guide | null;
}

export interface SaveResponse {
  hash: string;
  fileHash: string;
}

export interface FormatProfile {
  key: string;
  label: string;
  group: string;
  width: number;
  height: number;
  viewWidth: number | null;
  dpi: number | null;
}

export interface FormatsResponse {
  catalog: FormatProfile[];
  guide: Guide | null;
}

export interface ProjectListItem {
  path: string;
  id: string | null;
  name: string;
  schemaVersion: number | null;
  active: boolean;
}

export interface ProjectsResponse {
  dir: string;
  projects: ProjectListItem[];
}

export interface ExportEntry {
  stamp: string;
  dir: string;
  record: ExportRecord | null;
  files: string[];
}

export interface ExportResponse {
  dir: string;
  files: string[];
  record: ExportRecord;
}

export interface AuditResponse {
  report: AuditReport;
}

export interface ModelImportResult {
  warnings?: string[];
  [k: string]: unknown;
}

/** Server-sent events from /api/events. */
export type ServerEvent =
  | { type: "changed"; hash: string; fileHash: string }
  | { type: "progress"; job: string; line: string }
  | { type: "project"; root: string }
  | { type: "open" }
  | { type: "error" };
