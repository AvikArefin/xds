/**
 * Editor content inside the 3D canvas (SlideStage `sceneChildren`): the transform gizmo on the
 * selected object(s) and their selection boxes.
 *
 * The gizmo moves the registry's Object3D live; the pose is committed on release only, as one
 * undo step (dataflow.md §1.2). With several objects selected the gizmo sits on a pivot at their
 * shared center and moves them together.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { TransformControls } from "@react-three/drei";
import { Box3, BoxHelper, Matrix4, Object3D, Vector3, Color } from "three";
import type { Pose, RenderNode, Vec3 } from "@xds/protocol";
import { useSceneRegistry } from "../../scene/registry";
import { nodesOf, useActiveSlide, useStudio } from "../../store";

/** Shared with the DOM gesture layer: is the gizmo hovered/dragging right now? */
export const gizmoState = { hovered: false, dragging: false };

const r = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
const RAD2DEG = 180 / Math.PI;

export function poseOf(o: Object3D): Pose {
  return {
    position: [r(o.position.x, 4), r(o.position.y, 4), r(o.position.z, 4)] as Vec3,
    rotation: [r(o.rotation.x * RAD2DEG, 2), r(o.rotation.y * RAD2DEG, 2), r(o.rotation.z * RAD2DEG, 2)] as Vec3,
    scale: [r(o.scale.x, 4), r(o.scale.y, 4), r(o.scale.z, 4)] as Vec3,
  };
}

function SelectionBox({ obj, locked }: { obj: Object3D; locked: boolean }) {
  const helper = useMemo(() => {
    const h = new BoxHelper(obj, new Color(locked ? "#8a8f98" : "#4c9aff"));
    (h.material as { depthTest?: boolean; transparent?: boolean }).depthTest = false;
    (h.material as { transparent?: boolean }).transparent = true;
    h.renderOrder = 999;
    return h;
  }, [obj, locked]);
  useEffect(() => () => helper.geometry.dispose(), [helper]);
  useFrame(() => helper.update());
  return <primitive object={helper} />;
}

export function Scene3D({ onDragChange }: { onDragChange?: (dragging: boolean) => void }) {
  const reg = useSceneRegistry();
  const slide = useActiveSlide();
  const mode = useStudio((s) => s.mode);
  const selectedIds = useStudio((s) => s.selectedIds);
  const locked = useStudio((s) => s.locked);
  const transformMode = useStudio((s) => s.transformMode);
  const transformSpace = useStudio((s) => s.transformSpace);
  const readOnly = useStudio((s) => s.readOnly);
  const [, setVersion] = useState(0);
  useEffect(() => reg.registry.subscribe(() => setVersion((v) => v + 1)), [reg.registry]);

  const nodes = nodesOf(slide).filter(
    (n): n is RenderNode => n.layer === "render" && selectedIds.includes(n.id) && !n.hidden,
  );
  const objects = nodes.map((n) => ({ id: n.id, obj: reg.getNode(n.id) })).filter((x): x is { id: string; obj: Object3D } => !!x.obj);
  const editable = mode === "render" && !readOnly ? objects.filter((o) => !locked[o.id]) : [];

  // Multi-select: a pivot at the shared center.
  const pivot = useMemo(() => new Object3D(), []);
  const start = useRef<{ pivot: Matrix4; objs: { obj: Object3D; world: Matrix4 }[] } | null>(null);
  const multi = editable.length > 1;
  const key = editable.map((o) => o.id).join(",");
  useEffect(() => {
    if (!multi) return;
    const box = new Box3();
    for (const o of editable) box.expandByObject(o.obj);
    const c = box.getCenter(new Vector3());
    pivot.position.copy(c);
    pivot.rotation.set(0, 0, 0);
    pivot.scale.set(1, 1, 1);
    pivot.updateMatrixWorld();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, multi, pivot]);

  const tcRef = useRef<unknown>(null);
  useFrame(() => {
    const tc = tcRef.current as { axis?: string | null; dragging?: boolean } | null;
    gizmoState.hovered = !!tc?.axis;
    gizmoState.dragging = !!tc?.dragging;
  });
  useEffect(
    () => () => {
      gizmoState.hovered = false;
      gizmoState.dragging = false;
    },
    [],
  );

  const target = multi ? pivot : editable[0]?.obj;

  const onDown = () => {
    onDragChange?.(true);
    if (!multi) return;
    pivot.updateMatrixWorld();
    start.current = {
      pivot: pivot.matrixWorld.clone(),
      objs: editable.map((o) => {
        o.obj.updateMatrixWorld();
        return { obj: o.obj, world: o.obj.matrixWorld.clone() };
      }),
    };
  };
  const onChange = () => {
    const s = start.current;
    if (!multi || !s) return;
    pivot.updateMatrixWorld();
    const delta = pivot.matrixWorld.clone().multiply(s.pivot.clone().invert());
    for (const { obj, world } of s.objs) {
      const next = delta.clone().multiply(world);
      if (obj.parent) {
        obj.parent.updateMatrixWorld();
        next.premultiply(obj.parent.matrixWorld.clone().invert());
      }
      next.decompose(obj.position, obj.quaternion, obj.scale);
    }
  };
  const onUp = () => {
    onDragChange?.(false);
    start.current = null;
    const poses: Record<string, Pose> = {};
    for (const o of editable) poses[o.id] = poseOf(o.obj);
    useStudio.getState().commitPoses(poses);
  };

  return (
    <>
      {objects.map((o) => (
        <SelectionBox key={o.id} obj={o.obj} locked={!!locked[o.id] || mode !== "render"} />
      ))}
      {multi && <primitive object={pivot} />}
      {target && (
        <TransformControls
          key={key + transformMode}
          ref={tcRef as never}
          object={target}
          mode={transformMode}
          space={transformSpace}
          size={0.8}
          onMouseDown={onDown}
          onObjectChange={onChange}
          onMouseUp={onUp}
        />
      )}
    </>
  );
}
