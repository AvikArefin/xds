/**
 * The 2D interaction layer (Text / 2D / Background modes): hit-testing, selection handles,
 * drag to move (snapped), resize, rotate and marquee. Coordinates: canvas px × zoom.
 *
 * A drag is one gesture: the store's history is paused while it runs and gets one undo step at
 * the end.
 */
import { useRef, useState } from "react";
import type { Box, Layer, Node } from "@xds/protocol";
import { pxRectToBox, rectsBounds, snapMove, snapResize, snapTargets, type PxRect, type SnapLine } from "@xds/editor-core";
import { boxBoundsPx, boxPx, nodesOf, pointInBox, useActiveSlide, useStudio } from "../../store";
import { SnapLinesOverlay } from "./Overlays";

type BoxNode = Exclude<Node, { layer: "render" }>;
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

type Drag =
  | { kind: "move"; x0: number; y0: number; boxes: Record<string, Box>; moved: boolean; hitId: string | null; shift: boolean }
  | { kind: "resize"; id: string; handle: Handle; x0: number; y0: number; box: Box }
  | { kind: "rotate"; id: string; cx: number; cy: number; box: Box }
  | { kind: "marquee"; x0: number; y0: number; x1: number; y1: number; additive: boolean; base: string[] };

export function Overlay2D({ layer, W, H, zoom }: { layer: Layer; W: number; H: number; zoom: number }) {
  const slide = useActiveSlide();
  const selectedIds = useStudio((s) => s.selectedIds);
  const locked = useStudio((s) => s.locked);
  const snap = useStudio((s) => s.snap);
  const guide = useStudio((s) => s.guide);
  const readOnly = useStudio((s) => s.readOnly);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [marquee, setMarquee] = useState<PxRect | null>(null);
  const [snapLines, setSnapLines] = useState<SnapLine[]>([]);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const all = nodesOf(slide).filter((n): n is BoxNode => n.layer !== "render");
  const layerNodes = all.filter((n) => n.layer === layer);
  const selected = layerNodes.filter((n) => selectedIds.includes(n.id));

  const toCanvas = (e: React.PointerEvent | PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };
  const hitTest = (x: number, y: number): BoxNode | null => {
    for (let i = layerNodes.length - 1; i >= 0; i--) {
      const n = layerNodes[i];
      if (n.hidden || locked[n.id]) continue;
      if (pointInBox(x, y, n.box, W, H)) return n;
    }
    return null;
  };
  const targetsFor = (exclude: Set<string>) =>
    snapTargets({
      width: W,
      height: H,
      margins: guide?.margins,
      u: guide?.u,
      others: all
        .filter((n) => !exclude.has(n.id) && !n.hidden && n.layer !== "ground")
        .map((n) => boxBoundsPx(n.box, W, H)),
    });
  const threshold = 6 / zoom;

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const st = useStudio.getState();
    const p = toCanvas(e);
    const target = e.target as HTMLElement;
    const handle = target.dataset.handle as Handle | "rot" | undefined;
    ref.current!.setPointerCapture(e.pointerId);
    if (handle && selected.length === 1 && !readOnly && !locked[selected[0].id]) {
      const n = selected[0];
      st.beginGesture();
      if (handle === "rot") {
        const r = boxPx(n.box, W, H);
        drag.current = { kind: "rotate", id: n.id, cx: r.x + r.w / 2, cy: r.y + r.h / 2, box: n.box };
      } else drag.current = { kind: "resize", id: n.id, handle, x0: p.x, y0: p.y, box: n.box };
      return;
    }
    const hit = hitTest(p.x, p.y);
    if (hit) {
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      let ids = selectedIds;
      if (additive) {
        st.select([hit.id], { toggle: true });
        ids = useStudio.getState().selectedIds;
      } else if (!selectedIds.includes(hit.id)) {
        st.select([hit.id]);
        ids = [hit.id];
      }
      if (readOnly || !ids.includes(hit.id)) return;
      const boxes: Record<string, Box> = {};
      for (const n of layerNodes) if (ids.includes(n.id) && !locked[n.id]) boxes[n.id] = n.box;
      drag.current = { kind: "move", x0: p.x, y0: p.y, boxes, moved: false, hitId: hit.id, shift: additive };
      return;
    }
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    drag.current = { kind: "marquee", x0: p.x, y0: p.y, x1: p.x, y1: p.y, additive, base: additive ? selectedIds : [] };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const p = toCanvas(e);
    if (!d) {
      const hit = hitTest(p.x, p.y);
      setHoverId(hit?.id ?? null);
      return;
    }
    const st = useStudio.getState();
    const useSnap = snap !== e.altKey; // Alt inverts snapping
    if (d.kind === "move") {
      let dx = p.x - d.x0;
      let dy = p.y - d.y0;
      if (!d.moved && Math.hypot(dx, dy) * zoom < 3) return;
      if (!d.moved) {
        d.moved = true;
        st.beginGesture();
      }
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const ids = Object.keys(d.boxes);
      const rects = ids.map((id) => boxPx(d.boxes[id], W, H));
      const group = rectsBounds(rects);
      let lines: SnapLine[] = [];
      if (useSnap) {
        const moved = { ...group, x: group.x + dx, y: group.y + dy };
        const res = snapMove(moved, targetsFor(new Set(ids)), threshold);
        dx += res.rect.x - moved.x;
        dy += res.rect.y - moved.y;
        lines = res.guides;
      }
      setSnapLines(lines);
      const boxes: Record<string, Box> = {};
      ids.forEach((id, i) => {
        boxes[id] = pxRectToBox({ ...rects[i], x: rects[i].x + dx, y: rects[i].y + dy }, W, H, d.boxes[id]);
      });
      st.setBoxes(boxes);
    } else if (d.kind === "resize") {
      const r0 = boxPx(d.box, W, H);
      const rot = ((d.box.rotation ?? 0) * Math.PI) / 180;
      // pointer delta in the box's local frame
      const gx = p.x - d.x0;
      const gy = p.y - d.y0;
      const lx = gx * Math.cos(-rot) - gy * Math.sin(-rot);
      const ly = gx * Math.sin(-rot) + gy * Math.cos(-rot);
      const h = d.handle;
      let left = 0;
      let right = r0.w;
      let top = 0;
      let bottom = r0.h;
      if (h.includes("w")) left += lx;
      if (h.includes("e")) right += lx;
      if (h.includes("n")) top += ly;
      if (h.includes("s")) bottom += ly;
      if (e.shiftKey && h.length === 2) {
        const ratio = r0.w / r0.h;
        const w = right - left;
        const hh = bottom - top;
        if (Math.abs(w / ratio) > Math.abs(hh)) {
          const nh = w / ratio;
          if (h.includes("n")) top = bottom - nh;
          else bottom = top + nh;
        } else {
          const nw = hh * ratio;
          if (h.includes("w")) left = right - nw;
          else right = left + nw;
        }
      }
      const min = 4;
      if (right - left < min) {
        if (h.includes("w")) left = right - min;
        else right = left + min;
      }
      if (bottom - top < min) {
        if (h.includes("n")) top = bottom - min;
        else bottom = top + min;
      }
      let rect: PxRect;
      let lines: SnapLine[] = [];
      if (!rot) {
        rect = { x: r0.x + left, y: r0.y + top, w: right - left, h: bottom - top };
        if (useSnap) {
          const res = snapResize(
            rect,
            { left: h.includes("w"), right: h.includes("e"), top: h.includes("n"), bottom: h.includes("s") },
            targetsFor(new Set([d.id])),
            threshold,
            min,
          );
          rect = res.rect;
          lines = res.guides;
        }
      } else {
        // keep the opposite edge fixed in world space: move the center by the rotated local shift
        const cxl = (left + right) / 2 - r0.w / 2;
        const cyl = (top + bottom) / 2 - r0.h / 2;
        const cx = r0.x + r0.w / 2 + cxl * Math.cos(rot) - cyl * Math.sin(rot);
        const cy = r0.y + r0.h / 2 + cxl * Math.sin(rot) + cyl * Math.cos(rot);
        const w = right - left;
        const hh = bottom - top;
        rect = { x: cx - w / 2, y: cy - hh / 2, w, h: hh };
      }
      setSnapLines(lines);
      st.setBoxes({ [d.id]: pxRectToBox(rect, W, H, d.box) });
    } else if (d.kind === "rotate") {
      let a = (Math.atan2(p.y - d.cy, p.x - d.cx) * 180) / Math.PI + 90;
      if (a > 180) a -= 360;
      if (e.shiftKey || useSnap) {
        const step = e.shiftKey ? 15 : 1;
        a = Math.round(a / step) * step;
        if (!e.shiftKey && Math.abs(a % 90) <= 2) a = Math.round(a / 90) * 90;
      }
      const box: Box = { ...d.box, rotation: Math.round(a * 100) / 100 };
      if (!box.rotation) delete box.rotation;
      st.setBoxes({ [d.id]: box });
    } else if (d.kind === "marquee") {
      d.x1 = p.x;
      d.y1 = p.y;
      const r = { x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) };
      setMarquee(r);
      if (r.w * zoom > 3 || r.h * zoom > 3) {
        const inside = layerNodes
          .filter((n) => !n.hidden && !locked[n.id])
          .filter((n) => {
            const b = boxBoundsPx(n.box, W, H);
            return b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y;
          })
          .map((n) => n.id);
        st.select([...new Set([...d.base, ...inside])]);
      }
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setSnapLines([]);
    setMarquee(null);
    if (!d) return;
    const st = useStudio.getState();
    if (d.kind === "move") {
      if (d.moved) st.endGesture();
      else if (!d.shift && d.hitId && st.selectedIds.length > 1) st.select([d.hitId]);
    } else if (d.kind === "resize" || d.kind === "rotate") st.endGesture();
    else if (d.kind === "marquee") {
      if (Math.abs(d.x1 - d.x0) * zoom <= 3 && Math.abs(d.y1 - d.y0) * zoom <= 3 && !d.additive) st.clearSelection();
    }
  };

  const z = zoom;
  const groupRect = selected.length > 1 ? rectsBounds(selected.map((n) => boxBoundsPx(n.box, W, H))) : null;
  const hover = hoverId && !selectedIds.includes(hoverId) ? layerNodes.find((n) => n.id === hoverId) : null;

  const outline = (n: BoxNode, cls: string, withHandles: boolean) => {
    const r = boxPx(n.box, W, H);
    return (
      <div
        key={`${cls}-${n.id}`}
        className={cls}
        style={{
          left: r.x * z,
          top: r.y * z,
          width: r.w * z,
          height: r.h * z,
          transform: n.box.rotation ? `rotate(${n.box.rotation}deg)` : undefined,
        }}
      >
        {withHandles && (
          <>
            {HANDLES.map((h) => (
              <span key={h} className={`handle h-${h}`} data-handle={h} />
            ))}
            <span className="rot-stem" />
            <span className="handle rot" data-handle="rot" title="Rotate (Shift: 15°)" />
          </>
        )}
      </div>
    );
  };

  return (
    <div
      ref={ref}
      className="overlay interact"
      style={{ width: W * z, height: H * z }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setHoverId(null)}
    >
      <SnapLinesOverlay lines={snapLines} W={W} H={H} zoom={z} />
      {hover && outline(hover, "hover-box", false)}
      {selected.map((n) =>
        outline(n, `sel-box${locked[n.id] ? " locked" : ""}`, selected.length === 1 && !readOnly && !locked[n.id]),
      )}
      {groupRect && (
        <div className="group-box" style={{ left: groupRect.x * z, top: groupRect.y * z, width: groupRect.w * z, height: groupRect.h * z }} />
      )}
      {marquee && (
        <div className="marquee" style={{ left: marquee.x * z, top: marquee.y * z, width: marquee.w * z, height: marquee.h * z }} />
      )}
    </div>
  );
}
