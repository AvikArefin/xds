/** The 2D image layer: images and SVG assets placed by box, with fit, rotation and opacity. */
import { useState } from "react";
import type { ImageNode, Project } from "@xds/protocol";
import { boxToPx } from "@xds/editor-core";
import { fileUrl } from "../api";
import { useFailure, usePending } from "./readiness";

function ImageBox({ node, project, hash, width, height }: { node: ImageNode; project: Project; hash?: string; width: number; height: number }) {
  const asset = project.assets?.find((a) => a.id === node.data.asset);
  const src = asset ? fileUrl(asset.path) : null;
  const [state, setState] = useState<{ src: string | null; status: "loading" | "ok" | "error" }>({ src, status: "loading" });
  const status = state.src === src ? state.status : "loading";
  usePending(`image:${node.id}`, `image: ${node.data.asset}`, !!src && status === "loading");
  useFailure(
    `image:${node.id}`,
    !asset ? `image node '${node.id}': unknown asset '${node.data.asset}'` : status === "error" ? `image '${node.data.asset}' failed to load` : null,
  );
  const b = boxToPx(node.box, { width, height });
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
          style={{ width: "100%", height: "100%", objectFit: node.data.fit ?? "cover", display: "block" }}
        />
      )}
    </div>
  );
}

export function ImageLayer(props: { project: Project; nodes: ImageNode[]; hash?: string; width: number; height: number }) {
  return (
    <>
      {props.nodes.map((n) => (
        <ImageBox key={n.id} node={n} project={props.project} hash={props.hash} width={props.width} height={props.height} />
      ))}
    </>
  );
}
