/**
 * A slide thumbnail. When a current render exists (the audit renders every slide into
 * cache/<hash>/slides/) it shows that PNG; otherwise a light schematic drawn from the document
 * (background, 2D boxes, text, the 3D subject's frame position), which is cheap enough for a rail.
 */
import { memo, useState } from "react";
import type { Asset, Node, Project, Slide, TypeNode } from "@xds/protocol";
import { fileUrl } from "../api";
import { slideBaseColor } from "../stage/typeStyle";
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

  return (
    <div className="thumb" style={{ width, height, background: slideBaseColor(project, slide) ?? "#222" }}>
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
          const a = assets.get(n.data.asset);
          return (
            <div key={n.id} className="thumb-image" style={style}>
              {a && <img src={fileUrl(a.path)} alt="" draggable={false} style={{ objectFit: n.data.fit === "fill" ? "fill" : n.data.fit ?? "contain" }} />}
            </div>
          );
        }
        const t = n as TypeNode;
        const role = project.brand.typography?.[t.data.role];
        const size = (t.data.size ?? role?.size ?? 40) * scale;
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
