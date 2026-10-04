import { LAYER_LABELS, type Layer } from "@xds/protocol";
import { layerOrder, useStudio, type Mode } from "../store";
import { EditableStage } from "./canvas/EditableStage";
import { AlignBar } from "./inspectors/NodeInspectors";
import { IconButton, Segmented } from "./ui";

const KEY: Record<Mode, string> = { present: "1", type: "2", image: "3", render: "4", ground: "5" };

export function StageToolbar() {
  const project = useStudio((s) => s.project)!;
  const mode = useStudio((s) => s.mode);
  const snap = useStudio((s) => s.snap);
  const showGuides = useStudio((s) => s.showGuides);
  const transformMode = useStudio((s) => s.transformMode);
  const transformSpace = useStudio((s) => s.transformSpace);
  const st = useStudio.getState();
  const layers = [...layerOrder(project)].reverse() as Layer[]; // front → back

  return (
    <div className="stage-toolbar">
      <div className="mode-switch" role="tablist">
        <button type="button" role="tab" className={mode === "present" ? "active" : ""} title="Present (1)" onClick={() => st.setMode("present")}>
          Present
        </button>
        {layers.map((l) => (
          <button type="button" role="tab" key={l} className={mode === l ? "active" : ""} title={`${LAYER_LABELS[l]} (${KEY[l]})`} onClick={() => st.setMode(l)}>
            {LAYER_LABELS[l]}
          </button>
        ))}
      </div>
      {mode === "render" && (
        <>
          <Segmented
            value={transformMode}
            onChange={st.setTransformMode}
            options={[
              { value: "translate", label: "Move", title: "Move (gizmo)" },
              { value: "rotate", label: "Rotate", title: "Rotate (gizmo)" },
              { value: "scale", label: "Scale", title: "Scale (gizmo)" },
            ]}
          />
          <Segmented
            value={transformSpace}
            onChange={st.setTransformSpace}
            options={[
              { value: "world", label: "World" },
              { value: "local", label: "Local" },
            ]}
          />
        </>
      )}
      {mode !== "present" && (
        <>
          <IconButton icon="magnet" title="Snap (hold Alt to invert)" active={snap} onClick={st.toggleSnap} />
          <IconButton icon="grid" title="Guides (G)" active={showGuides} onClick={st.toggleGuides} />
        </>
      )}
      {mode !== "present" && mode !== "render" && <AlignBar />}
    </div>
  );
}

/** Floats over the canvas's bottom-right corner, outside the scrolling viewport. */
function ZoomControl() {
  const zoom = useStudio((s) => (s.zoom === "fit" ? s.fitZoom : s.zoom));
  const isFit = useStudio((s) => s.zoom === "fit");
  const st = useStudio.getState();
  return (
    <div className="zoom">
      <IconButton icon="minus" title="Zoom out" onClick={() => st.zoomBy(1 / 1.25)} />
      <button type="button" className={`zoom-val${isFit ? " fit" : ""}`} title="Fit to window" onClick={() => st.setZoom("fit")}>
        {Math.round(zoom * 100)}%
      </button>
      <IconButton icon="plus" title="Zoom in" onClick={() => st.zoomBy(1.25)} />
    </div>
  );
}

export function StageArea() {
  return (
    <main className="stage-area">
      <StageToolbar />
      <EditableStage />
      <ZoomControl />
    </main>
  );
}
