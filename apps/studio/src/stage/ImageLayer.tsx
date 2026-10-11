/**
 * The 2D image layer: images and SVG assets placed by box, with fit, rotation and opacity, and
 * drawn ornaments (`ShapeData`, see shapes.tsx) in the same boxes.
 */
import { useState } from "react";
import { isAsset, isShape, type ImageNode, type Project } from "@xds/protocol";
import { boxToPx, type LayoutPlacement } from "@xds/editor-core";
import { fileUrl } from "../api";
import type { Guide } from "../types";
import { useFailure, usePending } from "./readiness";
import { ShapeSvg, shapeStyle } from "./shapes";
import { stackUnit } from "./TypeLayer";

interface ImageBoxProps {
  node: ImageNode;
  project: Project;
  hash?: string;
  width: number;
  height: number;
  /** The stage's resolved rect for this node, when a relation decided it. */
  placement?: LayoutPlacement;
}

function placedBox(node: ImageNode, width: number, height: number, placement?: LayoutPlacement) {
  const own = boxToPx(node.box, { width, height });
  return placement ? { ...own, ...placement.rect } : own;
}

function ShapeBox({ node, project, background, u, width, height, placement }: ImageBoxProps & { background: string | null; u: number }) {
  if (!isShape(node.data)) return null;
  const b = placedBox(node, width, height, placement);
  const style = shapeStyle(node.data, project, background, u);
  return (
    <div
      data-node-id={node.id}
      data-layer="image"
      style={{
        position: "absolute",
        left: b.x,
        top: b.y,
        width: b.w,
        height: b.h,
        transform: b.rotation ? `rotate(${b.rotation}deg)` : undefined,
        opacity: b.opacity,
      }}
    >
      <ShapeSvg shape={node.data.shape} w={b.w} h={b.h} u={u} style={style} params={node.data.params ?? undefined} />
    </div>
  );
}

function ImageBox({ node, project, hash, width, height, placement }: ImageBoxProps) {
  const data = isAsset(node.data) ? node.data : null;
  const assetId = data?.asset ?? "";
  const asset = project.assets?.find((a) => a.id === assetId);
  const src = asset ? fileUrl(asset.path) : null;
  const [state, setState] = useState<{ src: string | null; status: "loading" | "ok" | "error" }>({ src, status: "loading" });
  const status = state.src === src ? state.status : "loading";
  usePending(`image:${node.id}`, `image: ${assetId}`, !!src && status === "loading");
  useFailure(
    `image:${node.id}`,
    data && !asset ? `image node '${node.id}': unknown asset '${assetId}'` : status === "error" ? `image '${assetId}' failed to load` : null,
  );
  const b = placedBox(node, width, height, placement);
  return (
    <div
      data-node-id={node.id}
      data-layer="image"
      style={{
        position: "absolute",
        left: b.x,
        top: b.y,
        width: b.w,
        height: b.h,
        transform: b.rotation ? `rotate(${b.rotation}deg)` : undefined,
        opacity: b.opacity,
        overflow: "hidden",
      }}
    >
      {src && (
        <img
          src={src}
          alt=""
          draggable={false}
          onLoad={() => setState({ src, status: "ok" })}
          onError={() => setState({ src, status: "error" })}
          style={{ width: "100%", height: "100%", objectFit: data?.fit ?? "cover", display: "block" }}
        />
      )}
    </div>
  );
}

export function ImageLayer(props: {
  project: Project;
  nodes: ImageNode[];
  hash?: string;
  width: number;
  height: number;
  placements?: Map<string, LayoutPlacement>;
  /** The slide's base color (shape stroke defaults contrast with it). */
  background?: string | null;
  guide?: Guide | null;
}) {
  const u = stackUnit(props.project, props.guide);
  return (
    <>
      {props.nodes.map((n) =>
        isShape(n.data) ? (
          <ShapeBox
            key={n.id}
            node={n}
            project={props.project}
            background={props.background ?? null}
            u={u}
            width={props.width}
            height={props.height}
            placement={props.placements?.get(n.id)}
          />
        ) : (
          <ImageBox
            key={n.id}
            node={n}
            project={props.project}
            hash={props.hash}
            width={props.width}
            height={props.height}
            placement={props.placements?.get(n.id)}
          />
        ),
      )}
    </>
  );
}
