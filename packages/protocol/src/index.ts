export * from "./generated/project";

import type { GroundNode, ImageNode, RenderNode, TypeNode } from "./generated/project";

/** The four layers; also the editor's edit modes (plus "present"). */
export type Layer = "ground" | "render" | "image" | "type";
export type Node = GroundNode | ImageNode | TypeNode | RenderNode;
export type BoxNode = GroundNode | ImageNode | TypeNode;
export type Vec3 = [number, number, number];

export const LAYERS: Layer[] = ["ground", "render", "image", "type"];
export const DEFAULT_LAYER_ORDER: Layer[] = ["ground", "render", "image", "type"];
export const LAYER_LABELS: Record<Layer, string> = {
  type: "Text",
  image: "2D",
  render: "3D",
  ground: "Background",
};
