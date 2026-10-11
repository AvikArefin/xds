/**
 * The Master section of the Present side panel (human-interaction §4 "Masters"): the project's
 * master nodes, shown on every slide behind that slide's own nodes (data-models §2.11), with
 * whether the active slide shows them.
 */
import { masterNodes } from "@xds/editor-core";
import { nodeLabel, useActiveSlide, useStudio } from "../../store";
import { Checkbox, ListRow } from "../ui";

export function MasterPanel() {
  const project = useStudio((s) => s.project)!;
  const slide = useActiveSlide();
  const readOnly = useStudio((s) => s.readOnly);
  const { makeSlideNode, setSlideMaster, setMode, select } = useStudio.getState();
  const nodes = masterNodes(project);
  const shown = slide?.master !== false;
  return (
    <>
      <div className="panel-head">
        <span className="panel-title">Master</span>
        <span className="muted small">{nodes.length ? `${nodes.length} on every slide` : "none"}</span>
      </div>
      <ul className="node-list">
        {nodes.map((n) => (
          <ListRow
            key={n.id}
            label={nodeLabel(n, project)}
            title={`${n.id} · double-click to edit it on this slide (for every slide)`}
            hidden={!shown}
            onDoubleClick={() => {
              if (n.layer === "render") return;
              setMode(n.layer);
              select([n.id]);
            }}
            actions={
              <button
                type="button"
                className="btn small ghost"
                disabled={readOnly}
                title="Move it back onto this slide only"
                onClick={(e) => {
                  e.stopPropagation();
                  makeSlideNode(n.id);
                }}
              >
                To slide
              </button>
            }
          />
        ))}
        {!nodes.length && <li className="muted small pad">No master nodes. Select a block in a layer and tick Master → Show on every slide.</li>}
      </ul>
      {nodes.length > 0 && (
        <div className="pad small">
          <Checkbox checked={shown} disabled={readOnly} label="Show master nodes on this slide" onChange={(v) => setSlideMaster(v)} />
        </div>
      )}
    </>
  );
}
