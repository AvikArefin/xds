/**
 * The Master section (human-interaction §4 "Masters"): whether a 2D node is one of the
 * project's master nodes, shown on every slide (data-models §2.11).
 */
import type { Node } from "@xds/protocol";
import { isMasterNode } from "@xds/editor-core";
import { useStudio } from "../../store";
import { Checkbox, Row, Section } from "../ui";

export function MasterInspector({ node }: { node: Node }) {
  const project = useStudio((s) => s.project)!;
  const readOnly = useStudio((s) => s.readOnly);
  const { makeMaster, makeSlideNode } = useStudio.getState();
  if (node.layer === "render") return null;
  const master = isMasterNode(project, node.id);
  return (
    <Section title="Master" defaultOpen={master}>
      <Row label="Slides" hint={master ? "edited here for every slide; a slide can leave masters off" : "a master node sits behind each slide's own nodes of its layer"}>
        <Checkbox
          checked={master}
          disabled={readOnly}
          label="Show on every slide"
          onChange={(v) => (v ? void makeMaster(node.id) : makeSlideNode(node.id))}
        />
      </Row>
    </Section>
  );
}
