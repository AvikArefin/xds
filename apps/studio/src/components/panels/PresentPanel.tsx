import { useEffect, useState } from "react";
import { LAYER_LABELS, type Layer } from "@xds/protocol";
import { layerOrder, useStudio } from "../../store";
import { Icon } from "../Icon";
import { IconButton } from "../ui";

function fmtStamp(stamp: string) {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(stamp);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : stamp;
}

export function PresentPanel() {
  const project = useStudio((s) => s.project)!;
  const readOnly = useStudio((s) => s.readOnly);
  const exports = useStudio((s) => s.exports);
  const exportJob = useStudio((s) => s.jobs.export);
  const hiddenLayers = useStudio((s) => s.hiddenLayers);
  const { setLayerOrder, setMode, exportPng, loadExports, toggleLayer } = useStudio.getState();
  const [dragOver, setDragOver] = useState<Layer | null>(null);
  useEffect(() => {
    void loadExports();
  }, [loadExports]);

  const order = layerOrder(project); // back → front
  const frontToBack = [...order].reverse();
  /** Drop `from` onto `to`'s row: `from` takes `to`'s place in the stack. */
  const moveTo = (from: Layer, to: Layer) => {
    if (from === to) return;
    const next = order.filter((l) => l !== from);
    next.splice(order.indexOf(to), 0, from);
    setLayerOrder(next);
  };

  return (
    <div className="side-panel">
      <div className="panel-head">
        <span className="panel-title">Layers</span>
        <span className="muted small">front → back</span>
      </div>
      <ul className="node-list">
        {frontToBack.map((l, k) => {
          const shown = !hiddenLayers.includes(l);
          return (
            <li
              key={l}
              className={`node-row${shown ? "" : " is-hidden"}${dragOver === l ? " drop" : ""}`}
              onDoubleClick={() => setMode(l)}
              title="Drag to reorder · double-click to edit this layer"
              draggable={!readOnly}
              onDragStart={(e) => {
                e.dataTransfer.setData("text/x-xds-layer", l);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes("text/x-xds-layer")) return;
                e.preventDefault();
                setDragOver(l);
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                setDragOver(null);
                const from = e.dataTransfer.getData("text/x-xds-layer") as Layer;
                if (from) moveTo(from, l);
              }}
            >
              {!readOnly && <Icon name="grip" size={12} className="grip" />}
              <span className="layer-index">{k + 1}</span>
              <span className="node-name">{LAYER_LABELS[l]}</span>
              <span className="node-actions always">
                <IconButton
                  icon={shown ? "eye" : "eyeOff"}
                  title={`${shown ? "Hide" : "Show"} on the canvas while editing (not saved; exports always include every layer)`}
                  size={12}
                  active={!shown}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLayer(l);
                  }}
                />
              </span>
            </li>
          );
        })}
      </ul>

      <div className="panel-head">
        <span className="panel-title">Exports</span>
        <button type="button" className="btn small" disabled={readOnly || exportJob?.running} onClick={() => exportPng()}>
          <Icon name="download" size={12} /> {exportJob?.running ? "Exporting…" : "Export PNG"}
        </button>
      </div>
      {exportJob?.running && (
        <div className="job-lines">
          {exportJob.lines.slice(-6).map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
      <ul className="export-list">
        {exports.map((e) => (
          <li key={e.stamp} className="export-item">
            <div className="export-head">
              <span>{fmtStamp(e.stamp)}</span>
              {e.record?.forced && <span className="badge sev-warn">forced</span>}
              {e.record && (
                <span className="muted small">
                  {e.record.audit.errors ?? 0} err · {e.record.audit.warnings ?? 0} warn
                </span>
              )}
            </div>
            <div className="export-files">
              {e.files.map((f) => (
                <a key={f} href={f} target="_blank" rel="noreferrer" download>
                  {decodeURIComponent(f.split("/").pop() ?? f)}
                </a>
              ))}
            </div>
          </li>
        ))}
        {!exports.length && <li className="muted small pad">No exports yet.</li>}
      </ul>
    </div>
  );
}
