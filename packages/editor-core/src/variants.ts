/**
 * Orientation variants (data-models §2.5c): a node's effective form is its base with
 * `variants[<orientation of the format>]` deep-merged over it. One source serves a portrait post
 * and a landscape banner. The merge rule: a `null` in a variant deletes the key (so
 * `layout: null` drops the relations), plain objects merge key by key, anything else replaces.
 *
 * Writes go the other way: while the format's orientation has a variant for a node, an edit made
 * to the effective node is written as a diff into that variant (`writeNode`), so the base keeps
 * the other orientations' values.
 */
import type { Node, Project } from "@xds/protocol";

export type Orientation = "portrait" | "square" | "landscape" | "story";
export const ORIENTATIONS: Orientation[] = ["portrait", "square", "landscape", "story"];

/** story: taller than 1.7:1; portrait: taller than 1.05:1; square: within 1.05 either way; else landscape. */
export function orientationOf(f: { width: number; height: number }): Orientation {
  const r = f.height / Math.max(1, f.width);
  if (r >= 1.7) return "story";
  if (r > 1.05) return "portrait";
  if (r >= 1 / 1.05) return "square";
  return "landscape";
}

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => !!v && typeof v === "object" && !Array.isArray(v);

/** The keys a variant may override. `id`, `layer` and `variants` itself never change. */
export const VARIANT_KEYS = ["box", "layout", "data", "hidden", "name", "exceptions"] as const;

export function mergeVariant<T extends Dict>(base: T, patch: Dict | null | undefined): T {
  if (!patch) return base;
  const out: Dict = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else if (isDict(v) && isDict(out[k])) out[k] = mergeVariant(out[k] as Dict, v);
    else out[k] = v;
  }
  return out as T;
}

/** The node as the format shows it: its base with the orientation's variant merged over it. */
export function resolveVariant<N extends Node>(node: N, orientation: Orientation): N {
  const v = node.variants?.[orientation];
  if (!v) return node;
  const patch: Dict = {};
  for (const k of VARIANT_KEYS) if (k in v) patch[k] = (v as Dict)[k];
  return mergeVariant(node as unknown as Dict, patch) as unknown as N;
}

export function resolveVariants(nodes: Node[], orientation: Orientation): Node[] {
  return nodes.some((n) => n.variants?.[orientation]) ? nodes.map((n) => resolveVariant(n, orientation)) : nodes;
}

export function hasVariant(node: Node, orientation: Orientation): boolean {
  return !!node.variants?.[orientation];
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The diff of `after` over `before` as a variant patch: changed keys, `null` for removed ones. */
export function diffVariant(before: Dict, after: Dict): Dict {
  const out: Dict = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[k];
    const b = after[k];
    if (!(k in after)) out[k] = null;
    else if (!(k in before)) out[k] = b;
    else if (same(a, b)) continue;
    else if (isDict(a) && isDict(b)) out[k] = diffVariant(a, b);
    else out[k] = b;
  }
  return out;
}

/**
 * Apply an edit `fn` to a node: on the base when the orientation has no variant for it, else to
 * the effective node, with the change stored in the variant. `fn` always sees the effective node.
 */
export function writeNode(raw: Node, orientation: Orientation, fn: (n: Node) => Node): Node {
  const variant = raw.variants?.[orientation];
  if (!variant) return fn(raw);
  const before = resolveVariant(raw, orientation);
  const after = fn(before);
  if (after === before) return raw;
  const patch: Dict = {};
  const b4 = before as unknown as Dict;
  const af = after as unknown as Dict;
  for (const k of VARIANT_KEYS) {
    if (same(b4[k], af[k])) continue;
    if (!(k in af) || af[k] === undefined) patch[k] = null;
    else if (isDict(b4[k]) && isDict(af[k])) patch[k] = diffVariant(b4[k] as Dict, af[k] as Dict);
    else patch[k] = af[k];
  }
  if (!Object.keys(patch).length) return raw;
  const next = storePatch(variant as Dict, patch);
  return { ...raw, variants: { ...raw.variants, [orientation]: next } } as Node;
}

/** Fold a diff into a stored variant: a `null` is kept (it deletes on resolve), objects recurse. */
function storePatch(variant: Dict, patch: Dict): Dict {
  const out: Dict = { ...variant };
  for (const [k, v] of Object.entries(patch)) {
    if (isDict(v) && isDict(out[k])) out[k] = storePatch(out[k] as Dict, v);
    else out[k] = v;
  }
  return out;
}

/** The orientation the project's format falls in. */
export function projectOrientation(project: Pick<Project, "format">): Orientation {
  return orientationOf(project.format);
}
