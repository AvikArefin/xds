/**
 * Ground design resolution (data-models §4, lighting-and-backgrounds §3).
 *
 * A design is an SVG with a JSON manifest in `<metadata id="xds-design">`, `{{ expr }}`
 * placeholders in attributes and text, and `data-xds-repeat` / `data-xds-count` loops (syntax
 * documented in xds/designs.py). `resolveDesign` turns one ground node's design into plain SVG
 * markup for its box: values = param defaults ← variant ← node values, the context holds
 * `width`, `height`, `subject.*`, `brand.<token>` and the params, and every `id` is prefixed
 * per node so two grounds on one page don't share gradients or filters.
 */
import type { Brand, DesignManifest, GroundData } from "@xds/protocol";
import { ExprError, interpolate, type Scope } from "./expr";

/** The 3D subject's on-screen layout in canvas px (lighting-and-backgrounds §3.2). */
export interface SubjectLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  floor: number;
}

/** Used when the slide has no visible 3D subject. */
export function fallbackSubject(width: number, height: number): SubjectLayout {
  const w = width * 0.4;
  const h = height * 0.4;
  return { x: width / 2 - w / 2, y: height * 0.3, w, h, cx: width / 2, cy: height / 2, floor: height * 0.7 };
}

export class DesignError extends Error {
  constructor(
    message: string,
    public expr?: string,
  ) {
    super(message);
    this.name = "DesignError";
  }
}

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const MAX_REPEAT = 500;

/** Read the manifest JSON from `<metadata id="xds-design">` (null when absent or invalid). */
export function parseManifest(svg: string): DesignManifest | null {
  const m = /<metadata[^>]*id=["']xds-design["'][^>]*>([\s\S]*?)<\/metadata>/i.exec(svg);
  if (!m) return null;
  let body = m[1].trim();
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(body);
  if (cdata) body = cdata[1];
  try {
    return JSON.parse(body) as DesignManifest;
  } catch {
    return null;
  }
}

export function brandTokens(brand: Brand | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of brand?.colors ?? []) out[c.name] = c.hex.toLowerCase();
  return out;
}

/** Param defaults ← variant values ← node values; color token names become hex. */
export function resolveValues(
  manifest: DesignManifest | null,
  data: Pick<GroundData, "variant" | "values">,
  tokens: Record<string, string>,
): Record<string, string | number | boolean> {
  const values: Record<string, string | number | boolean> = {};
  for (const p of manifest?.params ?? []) values[p.name] = p.default;
  const variant = data.variant ? manifest?.variants?.find((v) => v.name === data.variant) : undefined;
  Object.assign(values, variant?.values ?? {}, data.values ?? {});
  for (const p of manifest?.params ?? []) {
    const v = values[p.name];
    if (p.type === "color" && typeof v === "string" && !HEX.test(v) && tokens[v]) values[p.name] = tokens[v];
  }
  return values;
}

export function designScope(opts: {
  width: number;
  height: number;
  subject: SubjectLayout;
  tokens: Record<string, string>;
  values: Record<string, string | number | boolean>;
}): Scope {
  return {
    ...opts.values,
    width: opts.width,
    height: opts.height,
    subject: { ...opts.subject },
    brand: { ...opts.tokens },
  };
}

function ev(text: string, scope: Scope): string | number | boolean {
  try {
    return interpolate(text, scope);
  } catch (e) {
    const kind = e instanceof ExprError ? (e.kind === "name" ? "unknown name" : "bad expression") : "error";
    throw new DesignError(`${kind} in "${text.trim()}": ${(e as Error).message}`, text);
  }
}

function processElement(el: Element, scope: Scope): void {
  for (const attr of Array.from(el.attributes)) {
    if (attr.value.includes("{{")) el.setAttribute(attr.name, String(ev(attr.value, scope)));
  }
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 1) processNode(child as Element, scope);
    else if ((child.nodeType === 3 || child.nodeType === 4) && child.nodeValue?.includes("{{")) {
      child.nodeValue = String(ev(child.nodeValue, scope));
    }
  }
}

function processNode(el: Element, scope: Scope): void {
  const varName = el.getAttribute("data-xds-repeat");
  if (varName === null) {
    processElement(el, scope);
    return;
  }
  const countSrc = el.getAttribute("data-xds-count") ?? "0";
  const raw = ev(countSrc, scope);
  const count = Math.max(0, Math.min(MAX_REPEAT, Math.floor(Number(raw)) || 0));
  el.removeAttribute("data-xds-repeat");
  el.removeAttribute("data-xds-count");
  const parent = el.parentNode!;
  for (let k = 0; k < count; k++) {
    const copy = el.cloneNode(true) as Element;
    parent.insertBefore(copy, el);
    processElement(copy, { ...scope, [varName.trim()]: k, n: count });
  }
  parent.removeChild(el);
}

const URL_REF = /url\(\s*(['"]?)#([^'")\s]+)\1\s*\)/g;

/** Prefix every id in the tree and rewrite `url(#id)` / `href="#id"` references. */
export function uniquifyIds(root: Element, prefix: string): void {
  const map = new Map<string, string>();
  const all = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const el of all) {
    const id = el.getAttribute("id");
    if (id) {
      const next = `${prefix}${id}`;
      map.set(id, next);
      el.setAttribute("id", next);
    }
  }
  if (map.size === 0) return;
  const fix = (s: string) => s.replace(URL_REF, (m, q: string, id: string) => (map.has(id) ? `url(${q}#${map.get(id)}${q})` : m));
  for (const el of all) {
    for (const attr of Array.from(el.attributes)) {
      if ((attr.localName === "href") && attr.value.startsWith("#") && map.has(attr.value.slice(1))) {
        el.setAttributeNS(attr.namespaceURI, attr.name, `#${map.get(attr.value.slice(1))}`);
      } else if (attr.value.includes("url(")) {
        el.setAttribute(attr.name, fix(attr.value));
      }
    }
    if (el.localName === "style" && el.textContent) el.textContent = fix(el.textContent);
  }
}

export interface ResolveOptions {
  svg: string;
  manifest?: DesignManifest | null;
  data: GroundData;
  brand?: Brand;
  /** The node box in px; the design is drawn at this size. */
  width: number;
  height: number;
  /** In the node box's coordinates (canvas px minus the box origin). */
  subject: SubjectLayout;
  /** Prefix for ids (unique per node). */
  idPrefix: string;
}

/** Resolve a design to SVG markup sized `width × height`. Throws DesignError. */
export function resolveDesign(o: ResolveOptions): string {
  const doc = new DOMParser().parseFromString(o.svg, "image/svg+xml");
  const err = doc.querySelector("parsererror");
  if (err) throw new DesignError(`the design is not valid SVG: ${err.textContent?.slice(0, 200) ?? ""}`);
  const root = doc.documentElement;
  if (root.localName !== "svg") throw new DesignError("the design's root element is not <svg>");
  const manifest = o.manifest ?? parseManifest(o.svg);
  for (const meta of Array.from(root.querySelectorAll("metadata"))) {
    if (meta.getAttribute("id") === "xds-design") meta.remove();
  }
  const tokens = brandTokens(o.brand);
  const scope = designScope({
    width: o.width,
    height: o.height,
    subject: o.subject,
    tokens,
    values: resolveValues(manifest, o.data, tokens),
  });
  processElement(root, scope);
  uniquifyIds(root, o.idPrefix);
  if (!root.getAttribute("viewBox")) root.setAttribute("viewBox", `0 0 ${o.width} ${o.height}`);
  root.setAttribute("width", String(o.width));
  root.setAttribute("height", String(o.height));
  root.setAttribute("style", `display:block;${root.getAttribute("style") ?? ""}`);
  return new XMLSerializer().serializeToString(root);
}
