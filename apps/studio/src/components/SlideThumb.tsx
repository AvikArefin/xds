/**
 * A slide thumbnail. When a current render exists (the audit renders every slide into
 * cache/<hash>/slides/) it shows that PNG; otherwise a light schematic drawn from the document
 * (background, 2D boxes, text, the 3D subject's frame position), which is cheap enough for a rail.
 */
import { memo, useState } from "react";
import { isAsset, isShape, type Asset, type Node, type Project, type Slide, type TypeNode } from "@xds/protocol";
import { effectiveSize } from "@xds/editor-core";
import { fileUrl } from "../api";
import { ShapeSvg, shapeStyle } from "../stage/shapes";
import { stackUnit } from "../stage/TypeLayer";
import { bandFor, slideBaseColor } from "../stage/typeStyle";
import { colorHex, effectiveCamera, layerOrder } from "../store";

export const SlideThumb = memo(function SlideThumb({
  project,
  slide,
  index,
  cachedHash,
  width = 168,
}: {
  project: Project;
  slide: Slide;
  index: number;
  cachedHash: string | null;
  width?: number;
}) {
  const { width: W, height: H } = project.format;
  const scale = width / W;
  const height = Math.round(H * scale);
  const [failed, setFailed] = useState<string | null>(null);
  const png = cachedHash ? `/api/files/cache/${cachedHash}/slides/${index + 1}-${encodeURIComponent(slide.id)}.png` : null;

  if (png && failed !== png) {
    return (
      <div className="thumb" style={{ width, height }}>
        <img src={png} alt="" width={width} height={height} onError={() => setFailed(png)} draggable={false} />
      </div>
    );
  }

  const order = layerOrder(project);
  const nodes = ((slide.nodes ?? []) as Node[]).filter((n) => !n.hidden);
  const sorted = [...nodes].sort((a, b) => order.indexOf(a.layer) - order.indexOf(b.layer));
  const cam = effectiveCamera(slide);
  const assets = new Map<string, Asset>((project.assets ?? []).map((a) => [a.id, a]));
  const base = slideBaseColor(project, slide);

  return (
    <div className="thumb" style={{ width, height, background: base ?? "#222" }}>
      {sorted.map((n) => {
        if (n.layer === "render") {
          if (cam.mode !== "frame") return <div key={n.id} className="thumb-subject" style={{ left: "40%", top: "35%", width: "20%", height: "35%" }} />;
          const h = cam.height;
          const w = Math.min(60, h * 0.6 * (H / W));
          return (
            <div
              key={n.id}
              className="thumb-subject"
              style={{ left: `${cam.x - w / 2}%`, top: `${cam.y - h / 2}%`, width: `${w}%`, height: `${h}%` }}
            />
          );
        }
        const b = n.box;
        const style: React.CSSProperties = {
          left: `${b.x}%`,
          top: `${b.y}%`,
          width: `${b.w}%`,
          height: `${b.h}%`,
          opacity: b.opacity ?? 1,
          transform: b.rotation ? `rotate(${b.rotation}deg)` : undefined,
        };
        if (n.layer === "ground") return <div key={n.id} className="thumb-ground" style={style} />;
        if (n.layer === "image") {
          if (isShape(n.data)) {
            const u = stackUnit(project);
            const bw = (b.w / 100) * W;
            const bh = (b.h / 100) * H;
            return (
              <div key={n.id} className="thumb-image" style={style}>
                <ShapeSvg shape={n.data.shape} w={bw} h={bh} u={u} style={shapeStyle(n.data, project, base, u)} params={n.data.params ?? undefined} />
              </div>
            );
          }
          const d = isAsset(n.data) ? n.data : null;
          const a = d ? assets.get(d.asset) : undefined;
          return (
            <div key={n.id} className="thumb-image" style={style}>
              {a && d && <img src={fileUrl(a.path)} alt="" draggable={false} style={{ objectFit: d.fit === "fill" ? "fill" : d.fit ?? "contain" }} />}
            </div>
          );
        }
        const t = n as TypeNode;
        const role = project.brand.typography?.[t.data.role];
        const size = effectiveSize(t.data, role, bandFor(role?.level ?? "body", project).default) * scale;
        return (
          <div
            key={n.id}
            className="thumb-text"
            style={{
              ...style,
              fontSize: Math.max(2, size),
              color: colorHex(project, t.data.color ?? role?.color) ?? colorHex(project, "ink") ?? "#111",
              textAlign: t.data.align ?? "left",
              fontWeight: t.data.weight ?? role?.weight ?? 400,
            }}
          >
            {t.data.text}
          </div>
        );
      })}
    </div>
  );
});
