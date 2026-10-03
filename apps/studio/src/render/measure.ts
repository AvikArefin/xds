/**
 * measure(): the geometry the audit reads (data-models §5.1, CONTRACTS.md). The browser laid
 * everything out, so the browser measures it:
 * - 2D nodes: DOM bounds after rotation; type lines from Range.getClientRects merged per visual
 *   line, with the ink extent from canvas text metrics; the computed style; overflow;
 * - render nodes: the bounds of each node's own silhouette (a subject-only WebGL render read back);
 * - subject: the silhouette of all visible render nodes without shadows, its coverage and floor line;
 * - screens: projected mesh rects, displayed width and the mesh's UV-face aspect.
 * `layers`, `backgroundOnly` and `slidePng` are filled in by Python.
 */
import {
  Box3,
  Color,
  Matrix4,
  Vector3,
  WebGLRenderTarget,
  type BufferGeometry,
  type Mesh,
  type Object3D,
} from "three";
import type {
  MeasuredLine,
  MeasuredNode,
  MeasuredScreen,
  MeasuredStyle,
  Project,
  Rect,
  RenderNode,
  SlideMeasure,
  TypeNode,
} from "@xds/protocol";
import { toHex } from "../design/color";
import { findPart, meshesUnder } from "../scene/objects";
import type { SceneApi } from "../scene/SceneRoot";
import { projectToPx } from "../scene/studio/subject";
import type { StageHandle } from "../stage/SlideStage";

const ALPHA_THRESHOLD = 12; // of 255: ignore the faintest antialiasing fringe

const r2 = (v: number) => Math.round(v * 100) / 100;
const rect = (x: number, y: number, w: number, h: number): Rect => ({ x: r2(x), y: r2(y), w: r2(w), h: r2(h) });

// --- 3D -------------------------------------------------------------------------------------

interface MaskResult {
  bounds: Rect | null;
  pixels: number;
}

/** Render only `only` (or the whole subject group), no shadows/gizmos, and read the alpha back. */
function renderSilhouette(api: SceneApi, only?: Object3D): MaskResult {
  const { gl, scene, camera, subject, width, height } = api;
  const saved: [Object3D, boolean][] = [];
  const hide = (o: Object3D) => {
    saved.push([o, o.visible]);
    o.visible = false;
  };
  for (const c of scene.children) if (c !== subject) hide(c);
  if (only) for (const c of subject.children) if (c !== only) hide(c);
  const background = scene.background;
  scene.background = null;

  const rt = new WebGLRenderTarget(width, height);
  const prevTarget = gl.getRenderTarget();
  const prevAlpha = gl.getClearAlpha();
  const prevColor = gl.getClearColor(new Color());
  const buf = new Uint8Array(width * height * 4);
  try {
    gl.setRenderTarget(rt);
    gl.setClearColor(0x000000, 0);
    gl.clear(true, true, true);
    gl.render(scene, camera);
    gl.readRenderTargetPixels(rt, 0, 0, width, height, buf);
  } finally {
    gl.setRenderTarget(prevTarget);
    gl.setClearColor(prevColor, prevAlpha);
    rt.dispose();
    scene.background = background;
    for (const [o, v] of saved) o.visible = v;
  }

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
  for (let row = 0; row < height; row++) {
    const y = height - 1 - row; // GL rows start at the bottom
    const off = row * width * 4;
    for (let x = 0; x < width; x++) {
      if (buf[off + x * 4 + 3] > ALPHA_THRESHOLD) {
        n++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return { bounds: n ? rect(x0, y0, x1 - x0 + 1, y1 - y0 + 1) : null, pixels: n };
}

const _v = new Vector3();

function projectedVertexBounds(meshes: Mesh[], api: SceneApi): Rect | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const m of meshes) {
    m.updateWorldMatrix(true, false);
    const pos = m.geometry.getAttribute("position");
    if (!pos) continue;
    const step = Math.max(1, Math.floor(pos.count / 20000));
    for (let i = 0; i < pos.count; i += step) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      const [x, y] = projectToPx(_v, api.camera, api.width, api.height);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  return Number.isFinite(x0) ? rect(x0, y0, x1 - x0, y1 - y0) : null;
}

/** Least-squares fit P(u, v) = P0 + u·Pu + v·Pv over a mesh's vertices (world space). */
function uvFit(mesh: Mesh): { p0: Vector3; pu: Vector3; pv: Vector3; u: [number, number]; v: [number, number] } | null {
  const g = mesh.geometry as BufferGeometry;
  const pos = g.getAttribute("position");
  const uv = g.getAttribute("uv");
  if (!pos || !uv || pos.count < 3) return null;
  mesh.updateWorldMatrix(true, false);
  const m = new Matrix4().copy(mesh.matrixWorld);
  // normal equations: [n Σu Σv; Σu Σuu Σuv; Σv Σuv Σvv] · [p0 pu pv] = [Σp Σup Σvp]
  let n = 0, su = 0, sv = 0, suu = 0, suv = 0, svv = 0;
  const sp = [0, 0, 0], sup = [0, 0, 0], svp = [0, 0, 0];
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    _v.fromBufferAttribute(pos, i).applyMatrix4(m);
    const p = [_v.x, _v.y, _v.z];
    n++; su += u; sv += v; suu += u * u; suv += u * v; svv += v * v;
    for (let k = 0; k < 3; k++) {
      sp[k] += p[k]; sup[k] += u * p[k]; svp[k] += v * p[k];
    }
    umin = Math.min(umin, u); umax = Math.max(umax, u);
    vmin = Math.min(vmin, v); vmax = Math.max(vmax, v);
  }
  const A = new Matrix4().set(n, su, sv, 0, su, suu, suv, 0, sv, suv, svv, 0, 0, 0, 0, 1);
  if (Math.abs(A.determinant()) < 1e-12) return null;
  const inv = A.clone().invert().elements; // column-major
  const solve = (k: number) => {
    const b = [sp[k], sup[k], svp[k]];
    return [0, 1, 2].map((row) => inv[row] * b[0] + inv[4 + row] * b[1] + inv[8 + row] * b[2]);
  };
  const xs = solve(0), ys = solve(1), zs = solve(2);
  return {
    p0: new Vector3(xs[0], ys[0], zs[0]),
    pu: new Vector3(xs[1], ys[1], zs[1]),
    pv: new Vector3(xs[2], ys[2], zs[2]),
    u: [umin, umax],
    v: [vmin, vmax],
  };
}

function measureScreens(project: Project, nodes: RenderNode[], api: SceneApi): MeasuredScreen[] {
  const out: MeasuredScreen[] = [];
  for (const node of nodes) {
    const root = api.registry.getNode(node.id);
    if (!root) continue;
    for (const [meshName, screenId] of Object.entries(node.data.screens ?? {})) {
      const target = findPart(root, meshName);
      if (!target) continue;
      const meshes = meshesUnder(target);
      const r = projectedVertexBounds(meshes, api);
      if (!r || !meshes.length) continue;
      const biggest = meshes.reduce((a, b) =>
        (b.geometry.getAttribute("position")?.count ?? 0) > (a.geometry.getAttribute("position")?.count ?? 0) ? b : a,
      );
      const fit = uvFit(biggest);
      let displayedWidth = r.w;
      let meshAspect: number | undefined;
      if (fit) {
        const vm = (fit.v[0] + fit.v[1]) / 2;
        const at = (u: number, v: number) => fit.p0.clone().addScaledVector(fit.pu, u).addScaledVector(fit.pv, v);
        const a = projectToPx(at(fit.u[0], vm), api.camera, api.width, api.height);
        const b = projectToPx(at(fit.u[1], vm), api.camera, api.width, api.height);
        displayedWidth = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const wWorld = fit.pu.length() * (fit.u[1] - fit.u[0]);
        const hWorld = fit.pv.length() * (fit.v[1] - fit.v[0]);
        if (hWorld > 1e-9) meshAspect = Math.round((wWorld / hWorld) * 10000) / 10000;
      }
      out.push({ screenId, objectId: node.data.object, mesh: meshName, rect: r, displayedWidth: r2(displayedWidth), meshAspect });
    }
  }
  void project;
  return out;
}

// --- type -------------------------------------------------------------------------------------

let ctx2d: CanvasRenderingContext2D | null = null;
function textMetrics(font: string, letterSpacingPx: number, text: string): TextMetrics {
  ctx2d ??= document.createElement("canvas").getContext("2d")!;
  ctx2d.font = font;
  (ctx2d as unknown as { letterSpacing: string }).letterSpacing = `${letterSpacingPx}px`;
  return ctx2d.measureText(text);
}

function measureLines(textEl: HTMLElement, origin: DOMRect, cs: CSSStyleDeclaration, uppercase: boolean): MeasuredLine[] {
  const size = parseFloat(cs.fontSize) || 16;
  const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const ls = cs.letterSpacing === "normal" ? 0 : parseFloat(cs.letterSpacing) || 0;
  const fm = textMetrics(font, 0, "Hg");

  type Acc = { text: string; x0: number; x1: number; top: number; bottom: number };
  const lines: Acc[] = [];
  const walker = document.createTreeWalker(textEl, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const s = node.data;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === "\n") {
        lines.push({ text: "", x0: Infinity, x1: -Infinity, top: NaN, bottom: NaN }); // force a break
        continue;
      }
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const rects = Array.from(range.getClientRects()).filter((r) => r.height > 0);
      if (!rects.length) continue;
      const r = rects[rects.length - 1];
      let line = lines[lines.length - 1];
      const mid = (r.top + r.bottom) / 2;
      if (!line || (!Number.isNaN(line.top) && (mid > line.bottom || mid < line.top))) {
        line = { text: "", x0: Infinity, x1: -Infinity, top: NaN, bottom: NaN };
        lines.push(line);
      }
      if (Number.isNaN(line.top)) {
        line.top = r.top;
        line.bottom = r.bottom;
      }
      line.text += ch;
      if (ch.trim()) {
        line.x0 = Math.min(line.x0, r.left);
        line.x1 = Math.max(line.x1, r.right);
      }
      line.top = Math.min(line.top, r.top);
      line.bottom = Math.max(line.bottom, r.bottom);
    }
  }
  const out: MeasuredLine[] = [];
  for (const l of lines) {
    const text = l.text.trim();
    if (!text || !Number.isFinite(l.x0)) continue;
    const baseline = l.bottom - fm.fontBoundingBoxDescent;
    const ink = textMetrics(font, ls, uppercase ? text.toUpperCase() : text);
    const asc = Math.max(0, ink.actualBoundingBoxAscent);
    const desc = Math.max(0, ink.actualBoundingBoxDescent);
    // trailing letter-spacing after the last glyph is not ink
    const x1 = l.x1 - ls;
    out.push({
      text,
      rect: rect(l.x0 - origin.left, baseline - asc - origin.top, Math.max(0, x1 - l.x0), asc + desc),
      baseline: r2(baseline - origin.top),
    });
  }
  void size;
  return out;
}

function measureType(node: TypeNode, el: HTMLElement, origin: DOMRect, project: Project, canvas: { w: number; h: number }): Partial<MeasuredNode> {
  const textEl = (el.querySelector("[data-xds-text]") as HTMLElement) ?? el;
  const cs = getComputedStyle(textEl);
  const size = parseFloat(cs.fontSize) || 0;
  const uppercase = cs.textTransform === "uppercase";
  const style: MeasuredStyle = {
    font: cs.fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, ""),
    size: r2(size),
    weight: parseInt(cs.fontWeight, 10) || 400,
    lineHeight: r2(cs.lineHeight === "normal" ? size * 1.2 : parseFloat(cs.lineHeight)),
    letterSpacing: cs.letterSpacing === "normal" || !size ? 0 : Math.round((parseFloat(cs.letterSpacing) / size) * 10000) / 10000,
    color: toHex(cs.color) ?? "#000000",
    uppercase,
    italic: cs.fontStyle === "italic" || cs.fontStyle.startsWith("oblique"),
  };
  const lines = measureLines(textEl, origin, cs, uppercase);
  const boxOverflow = textEl.offsetHeight > el.clientHeight + 0.5 || textEl.scrollWidth > el.clientWidth + 0.5;
  const canvasOverflow = lines.some(
    (l) => l.rect.x < -0.5 || l.rect.y < -0.5 || l.rect.x + l.rect.w > canvas.w + 0.5 || l.rect.y + l.rect.h > canvas.h + 0.5,
  );
  const role = project.brand?.typography?.[node.data.role];
  const out: Partial<MeasuredNode> = {
    lines,
    style,
    overflow: boxOverflow || canvasOverflow,
    role: node.data.role,
    align: node.data.align ?? "left",
    decorative: node.data.decorative ?? false,
  };
  if (role?.level) out.level = role.level;
  if (node.data.group) out.group = node.data.group;
  return out;
}

// --- all ----------------------------------------------------------------------------------

export async function measure(handle: StageHandle, project: Project, slideId: string): Promise<SlideMeasure> {
  const slide = project.slides.find((s) => s.id === slideId)!;
  const width = project.format.width;
  const height = project.format.height;
  const root = handle.root!;
  const origin = root.getBoundingClientRect();
  const api = handle.scene;
  const nodes: MeasuredNode[] = [];
  const renderNodes: RenderNode[] = [];

  for (const node of slide.nodes ?? []) {
    if (node.hidden) continue;
    if (node.layer === "render") {
      renderNodes.push(node);
      const obj = api?.registry.getNode(node.id);
      if (!api || !obj) continue;
      const mask = renderSilhouette(api, obj);
      const box = mask.bounds ?? projectedVertexBounds(meshesUnder(obj), api) ?? rect(0, 0, 0, 0);
      nodes.push({ id: node.id, layer: "render", box });
      continue;
    }
    const el = root.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(node.id)}"]`);
    if (!el) continue;
    const b = el.getBoundingClientRect();
    const m: MeasuredNode = { id: node.id, layer: node.layer, box: rect(b.left - origin.left, b.top - origin.top, b.width, b.height) };
    if (node.layer === "type") Object.assign(m, measureType(node, el, origin, project, { w: width, h: height }));
    nodes.push(m);
  }

  let subject: SlideMeasure["subject"];
  let screens: MeasuredScreen[] = [];
  if (api && renderNodes.length) {
    const mask = renderSilhouette(api);
    if (mask.bounds) {
      const box = api.registry.subjectBounds ?? new Box3().setFromObject(api.subject);
      const c = box.getCenter(new Vector3());
      const [, floor] = projectToPx(new Vector3(c.x, box.min.y, c.z), api.camera, width, height);
      subject = { bounds: mask.bounds, coverage: Math.round((mask.pixels / (width * height)) * 1e6) / 1e6, floor: r2(floor) };
    }
    screens = measureScreens(project, renderNodes, api);
  }

  const out: SlideMeasure = { slideId, width, height, nodes, screens };
  if (subject) out.subject = subject;
  return out;
}
