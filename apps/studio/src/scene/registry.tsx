/**
 * The live scene registry: maps render nodes to their Object3D roots so the editor (gizmos,
 * selection outlines) and measure() can reach the real objects.
 *
 *   SceneObject.id ↔ Object3D.userData.objectId ↔ the slide's RenderNode (userData.nodeId)
 */
import { createContext, useContext, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import type { Box3, Camera, Object3D } from "three";

export class SceneRegistry {
  private byNode = new Map<string, Object3D>();
  private listeners = new Set<() => void>();
  /** World-space bounds of the visible subject (null when nothing is visible). */
  subjectBounds: Box3 | null = null;
  version = 0;

  register(nodeId: string, obj: Object3D): void {
    this.byNode.set(nodeId, obj);
    this.bump();
  }

  unregister(nodeId: string, obj: Object3D): void {
    if (this.byNode.get(nodeId) === obj) {
      this.byNode.delete(nodeId);
      this.bump();
    }
  }

  getNode(nodeId: string): Object3D | undefined {
    return this.byNode.get(nodeId);
  }

  getObject(objectId: string): Object3D | undefined {
    for (const o of this.byNode.values()) if (o.userData.objectId === objectId) return o;
    return undefined;
  }

  nodeIds(): string[] {
    return [...this.byNode.keys()];
  }

  has(nodeId: string): boolean {
    return this.byNode.has(nodeId);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  bump(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }
}

export const SceneRegistryContext = createContext<SceneRegistry | null>(null);

export interface SceneRegistryApi {
  /** The root of the render node showing `objectId` on this slide. */
  getObject(objectId: string): Object3D | undefined;
  /** The root of a render node by node id. */
  getNode(nodeId: string): Object3D | undefined;
  camera: Camera;
  /** World bounds of the visible subject; read it when you need it (it updates in place). */
  readonly subjectBounds: Box3 | null;
  registry: SceneRegistry;
}

/** For content inside the RenderLayer canvas (SlideStage `sceneChildren`). */
export function useSceneRegistry(): SceneRegistryApi {
  const reg = useContext(SceneRegistryContext);
  const camera = useThree((s) => s.camera);
  if (!reg) throw new Error("useSceneRegistry must be used inside SlideStage sceneChildren");
  return useMemo(
    () => ({
      getObject: (id: string) => reg.getObject(id),
      getNode: (id: string) => reg.getNode(id),
      camera,
      get subjectBounds() {
        return reg.subjectBounds;
      },
      registry: reg,
    }),
    [reg, camera],
  );
}
