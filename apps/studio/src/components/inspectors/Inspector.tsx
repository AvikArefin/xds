import type { GroundNode, ImageNode, RenderNode, TypeNode } from "@xds/protocol";
import { LAYER_LABELS } from "@xds/protocol";
import { nodeLabel, slideNodes, useActiveSlide, useStudio } from "../../store";
import { TextField } from "../ui";
import { BrandInspector } from "./BrandInspector";
import { GroupInspector } from "./GroupInspector";
import { LayoutInspector } from "./LayoutInspector";
import { MasterInspector } from "./MasterInspector";
import { GroundInspector, ImageInspector, ShapeInspector, TransformInspector, TypeInspector } from "./NodeInspectors";
import { SceneInspector } from "./SceneInspector";
import { TreatmentsInspector } from "./TreatmentsInspector";
import { VariantInspector } from "./VariantInspector";

function NodeHeader({ id }: { id: string }) {
  const slide = useActiveSlide();
  const project = useStudio((s) => s.project);
  const readOnly = useStudio((s) => s.readOnly);
  const renameNode = useStudio((s) => s.renameNode);
  const node = slideNodes(project, slide).find((n) => n.id === id);
  if (!node) return null;
  return (
    <div className="node-header">
      <TextField value={node.name ?? ""} placeholder={nodeLabel(node, project)} disabled={readOnly} onChange={(v) => renameNode(id, v)} />
      <span className="muted mono small" title="id (stable)">
        {node.id}
      </span>
    </div>
  );
}

export function Inspector() {
  const mode = useStudio((s) => s.mode);
  const selectedIds = useStudio((s) => s.selectedIds);
  const slide = useActiveSlide();
  const project = useStudio((s) => s.project);
  if (!project) return <aside className="inspector" />;

  let body: React.ReactNode;
  if (mode === "present") body = <BrandInspector />;
  else {
    const nodes = slideNodes(project, slide).filter((n) => selectedIds.includes(n.id) && n.layer === mode);
    if (mode === "render") body = <SceneInspector nodes={nodes as RenderNode[]} />;
    else if (!nodes.length)
      body = (
        <div className="inspector-body">
          <div className="muted small pad">
            Select a {LAYER_LABELS[mode]} block on the canvas or in the list. Shift+click adds to the selection; drag on empty canvas to
            marquee-select.
          </div>
        </div>
      );
    else {
      const boxNodes = nodes as (TypeNode | ImageNode | GroundNode)[];
      const groupName = boxNodes.every((n) => n.layout?.group && n.layout.group === boxNodes[0].layout?.group) ? boxNodes[0].layout?.group : undefined;
      const group = groupName ? slide?.groups?.[groupName] : undefined;
      const members = groupName ? slideNodes(project, slide).filter((n) => n.layer !== "render" && n.layout?.group === groupName).length : 0;
      body = (
        <div className="inspector-body">
          {nodes.length === 1 && <NodeHeader id={nodes[0].id} />}
          <TransformInspector nodes={boxNodes} />
          <LayoutInspector nodes={boxNodes} />
          {groupName && group && <GroupInspector name={groupName} group={group} members={members} />}
          {nodes.length === 1 && <MasterInspector node={nodes[0]} />}
          <VariantInspector nodes={nodes} />
          {mode === "type" && <TypeInspector nodes={nodes as TypeNode[]} />}
          {mode === "type" && <TreatmentsInspector nodes={nodes as TypeNode[]} />}
          {mode === "image" && <ImageInspector nodes={nodes as ImageNode[]} />}
          {mode === "image" && <ShapeInspector nodes={nodes as ImageNode[]} />}
          {mode === "ground" && <GroundInspector nodes={nodes as GroundNode[]} />}
        </div>
      );
    }
  }
  return (
    <aside className="inspector">
      <div className="inspector-head">
        <span className="panel-title">{mode === "present" ? "Brand" : mode === "render" ? "Scene" : LAYER_LABELS[mode]}</span>
      </div>
      {body}
    </aside>
  );
}
