import type { AuditReport, Finding, Layer, Project } from "@xds/protocol";
import type { DesignInfo, ExportEntry, FormatProfile, Guide, GuideBand, Level, ProjectListItem, ProjectResponse } from "../types";

export type Mode = "present" | Layer;
export const MODES: Mode[] = ["present", "type", "image", "render", "ground"];

export const LEVELS: Level[] = ["display", "headline", "subhead", "body", "caption"];

export type GuideJson = Guide;
export type DesignInfoJson = DesignInfo;
export type FormatPreset = FormatProfile;
export type { ExportEntry, GuideBand, Level, ProjectListItem, ProjectResponse };

export type NoticeLevel = "info" | "success" | "warning" | "error";
export interface Notice {
  id: number;
  level: NoticeLevel;
  text: string;
}

export interface Job {
  kind: "audit" | "export" | "save" | "import" | "fonts" | "design";
  running: boolean;
  lines: string[];
}

export type { AuditReport, Finding, Project };
