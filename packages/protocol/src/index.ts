export * from "./generated/project";

import type { GroundNode, ImageData, ImageNode, RenderNode, ShapeData, TypeNode } from "./generated/project";

/** The four layers; also the editor's edit modes (plus "present"). */
export type Layer = "ground" | "render" | "image" | "type";
export type Node = GroundNode | ImageNode | TypeNode | RenderNode;
export type BoxNode = GroundNode | ImageNode | TypeNode;
export type Vec3 = [number, number, number];

export const LAYERS: Layer[] = ["ground", "render", "image", "type"];

/** An image-layer node's data is an asset reference or a drawn shape (an ornament). */
export const isShape = (d: ImageNode["data"]): d is ShapeData => "shape" in d;
export const isAsset = (d: ImageNode["data"]): d is ImageData => "asset" in d;
/** The node's own stack, wherever it was written (`layout.stack`, or the older `data.stack`). */
export const stackOf = (n: Node) =>
  n.layer === "render" ? undefined : (n.layout?.stack ?? (n.layer === "type" ? n.data.stack : undefined));
export const DEFAULT_LAYER_ORDER: Layer[] = ["ground", "render", "image", "type"];
export const LAYER_LABELS: Record<Layer, string> = {
  type: "Text",
  image: "2D",
  render: "3D",
  ground: "Background",
};
