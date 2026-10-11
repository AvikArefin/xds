/** Read-only helpers over the document (no store access). */
import type {
  Box,
  FrameCamera,
  FreeCamera,
  Layer,
  Lighting,
  Node,
  Project,
  RenderNode,
  Slide,
  TypeNode,
} from "@xds/protocol";
import { DEFAULT_LAYER_ORDER, isShape } from "@xds/protocol";
import type { GuideJson, Level } from "./types";

export const LIGHTING_DEFAULTS: Required<Omit<Lighting, "tint">> & { tint?: string } = {
  look: "softbox",
  angle: 35,
  elevation: 30,
  shadow: "contact",
  brightness: 0,
};

export const FRAME_DEFAULTS: Required<FrameCamera> = {
  mode: "frame",
  x: 50,
  y: 55,
  height: 55,
  yaw: 25,
  pitch: 12,
  fov: 30,
};

export function layerOrder(p: Project): Layer[] {
  return (p.layerOrder as Layer[] | undefined) ?? DEFAULT_LAYER_ORDER;
}

export function getSlide(p: Project | null, id: string | null | undefined): Slide | null {
  if (!p) return null;
  return p.slides.find((s) => s.id === id) ?? null;
}

export function nodesOf(slide: Slide | null): Node[] {
  return (slide?.nodes ?? []) as Node[];
}

export function nodeLabel(n: Node, p?: Project | null): string {
  if (n.name) return n.name;
  if (n.layer === "type") return (n as TypeNode).data.text.split("\n")[0].slice(0, 40) || n.id;
  if (n.layer === "render") {
    const obj = p?.objects?.find((o) => o.id === (n as RenderNode).data.object);
    return obj?.name ?? n.id;
  }
  if (n.layer === "ground") return n.data.design;
  return isShape(n.data) ? n.data.shape : n.data.asset;
}

export function effectiveLighting(p: Project, slide: Slide | null): typeof LIGHTING_DEFAULTS {
  return { ...LIGHTING_DEFAULTS, ...(p.lighting ?? {}), ...(slide?.lighting ?? {}) };
}

export function effectiveCamera(slide: Slide | null): Required<FrameCamera> | FreeCamera {
  const c = slide?.camera;
  if (c && c.mode === "free") return c as FreeCamera;
  return { ...FRAME_DEFAULTS, ...((c as FrameCamera | undefined) ?? {}), mode: "frame" };
}

export function colorHex(p: Project, token: string | undefined): string | undefined {
  if (!token) return undefined;
  return p.brand.colors.find((c) => c.name === token)?.hex;
}

/** The type style the editor shows (render/measure do it in the browser; this is for inspectors). */
export function typeStyle(p: Project, n: TypeNode, guide: GuideJson | null) {
  const role = p.brand.typography?.[n.data.role];
  const level = (role?.level ?? "body") as Level;
  const band = guide?.bands?.[level];
  const lhMid = band ? (band.line_height[0] + band.line_height[1]) / 2 : 1.2;
  return {
    level,
    band,
    font: role?.font ?? "",
    size: n.data.size ?? role?.size ?? band?.default ?? 40,
    weight: n.data.weight ?? role?.weight ?? 400,
    lineHeight: n.data.lineHeight ?? role?.lineHeight ?? lhMid,
    letterSpacing: n.data.letterSpacing ?? role?.letterSpacing ?? 0,
    color: n.data.color ?? role?.color,
    uppercase: n.data.uppercase ?? role?.uppercase ?? false,
    italic: n.data.italic ?? role?.italic ?? false,
    wrap: n.data.wrap ?? role?.wrap ?? "normal",
  };
}

/** Px rect of a percent box. */
export function boxPx(b: Box, W: number, H: number) {
  return { x: (b.x / 100) * W, y: (b.y / 100) * H, w: (b.w / 100) * W, h: (b.h / 100) * H };
}

/** Axis-aligned px bounds of a (possibly rotated) box. */
export function boxBoundsPx(b: Box, W: number, H: number) {
  const r = boxPx(b, W, H);
  const a = ((b.rotation ?? 0) * Math.PI) / 180;
  if (!a) return r;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  const w = r.w * c + r.h * s;
  const h = r.w * s + r.h * c;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Is a px point inside a rotated box? */
export function pointInBox(px: number, py: number, b: Box, W: number, H: number): boolean {
  const r = boxPx(b, W, H);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const a = (-(b.rotation ?? 0) * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(lx) <= r.w / 2 && Math.abs(ly) <= r.h / 2;
}

export const isEditableLayer = (mode: string): mode is Layer => mode !== "present";
