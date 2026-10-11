/**
 * Structured fixes (design-rules §6.1): an audit finding's `edits` are field writes at a dotted
 * path on a node (`box.y`, `data.size`, `layout.stack.gap`), on a slide (`camera.height`) or on
 * the project (`screens.0.scale`). `applyEdit` writes one immutably (structural sharing) and
 * returns the new project, or the same project when the target is missing.
 */
import type { Edit, Node, Project, Slide } from "@xds/protocol";

/** Where an edit lands: the node, the slide, or the project. */
export function editTarget(project: Project, e: Edit): { slide: Slide | null; node: Node | null; index: number } {
  const slide = project.slides.find((s) => s.id === e.slideId) ?? null;
  if (!e.nodeId) return { slide, node: null, index: -1 };
  const candidates = slide ? [slide] : project.slides;
  for (const s of candidates) {
    const index = (s.nodes ?? []).findIndex((n) => n.id === e.nodeId);
    if (index >= 0) return { slide: s, node: (s.nodes ?? [])[index] as Node, index };
  }
  return { slide, node: null, index: -1 };
}

/** `obj` with `value` written at `path` (dotted; numeric keys index arrays), or null when an
 * array index is missing. A value of null or undefined deletes the key. */
export function setPath<T>(obj: T, path: string, value: unknown): T | null {
  const parts = path.split(".");
  const write = (cur: unknown, i: number): unknown => {
    const key = parts[i];
    const last = i === parts.length - 1;
    if (Array.isArray(cur)) {
      const idx = Number(key);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return null;
      const next = last ? value : write(cur[idx], i + 1);
      if (!last && next === null) return null;
      const out = [...cur];
      out[idx] = next;
      return out;
    }
    const base = cur && typeof cur === "object" ? (cur as Record<string, unknown>) : {};
    if (last) {
      const out = { ...base };
      if (value === null || value === undefined) delete out[key];
      else out[key] = value;
      return out;
    }
    const next = write(base[key], i + 1);
    if (next === null) return null;
    return { ...base, [key]: next };
  };
  return write(obj, 0) as T | null;
}

export function applyEdit(project: Project, e: Edit): Project {
  const value = e.value === undefined ? null : e.value;
  if (e.nodeId) {
    const t = editTarget(project, e);
    if (!t.node || !t.slide) return project;
    const node = setPath(t.node, e.path, value);
    if (!node || node === t.node) return project;
    const nodes = [...(t.slide.nodes ?? [])];
    nodes[t.index] = node;
    return { ...project, slides: project.slides.map((s) => (s === t.slide ? { ...s, nodes } : s)) as Project["slides"] };
  }
  if (e.slideId) {
    const slide = project.slides.find((s) => s.id === e.slideId);
    if (!slide) return project;
    const next = setPath(slide, e.path, value);
    if (!next || next === slide) return project;
    return { ...project, slides: project.slides.map((s) => (s === slide ? next : s)) as Project["slides"] };
  }
  const next = setPath(project, e.path, value);
  return next ?? project;
}

/** Apply edits in order; returns the project and the ids of the nodes that were written. */
export function applyEdits(project: Project, edits: Edit[]): { project: Project; nodeIds: string[]; skipped: Edit[] } {
  let p = project;
  const nodeIds: string[] = [];
  const skipped: Edit[] = [];
  for (const e of edits) {
    const next = applyEdit(p, e);
    if (next === p) {
      // unchanged: either the target is missing or the value was already there
      const t = e.nodeId ? editTarget(p, e) : null;
      if ((e.nodeId && !t?.node) || (e.slideId && !e.nodeId && !p.slides.some((s) => s.id === e.slideId))) skipped.push(e);
      else if (e.nodeId) nodeIds.push(e.nodeId);
      continue;
    }
    p = next;
    if (e.nodeId) nodeIds.push(e.nodeId);
  }
  return { project: p, nodeIds: [...new Set(nodeIds)], skipped };
}
