/** The 2D image layer: images and SVG assets placed by box, with fit, rotation and opacity. */
import { useState } from "react";
import { isAsset, type ImageNode, type Project } from "@xds/protocol";
import { boxToPx, type LayoutPlacement } from "@xds/editor-core";
import { fileUrl } from "../api";
import { useFailure, usePending } from "./readiness";

interface ImageBoxProps {
  node: ImageNode;
  project: Project;
  hash?: string;
  width: number;
  height: number;
  /** The stage's resolved rect for this node, when a relation decided it. */
  placement?: LayoutPlacement;
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
  const own = boxToPx(node.box, { width, height });
  const b = placement ? { ...own, ...placement.rect } : own;
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
}) {
  return (
    <>
      {props.nodes.map((n) => (
        <ImageBox
          key={n.id}
          node={n}
          project={props.project}
          hash={props.hash}
          width={props.width}
          height={props.height}
          placement={props.placements?.get(n.id)}
        />
      ))}
    </>
  );
}
