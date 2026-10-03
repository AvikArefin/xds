import { useEffect } from "react";
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
  const { setLayerOrder, setMode, exportPng, loadExports } = useStudio.getState();
  useEffect(() => {
    void loadExports();
  }, [loadExports]);

  const order = layerOrder(project); // back → front
  const frontToBack = [...order].reverse();
  const move = (layer: Layer, dir: 1 | -1) => {
    const i = order.indexOf(layer);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setLayerOrder(next);
  };

  return (
    <div className="side-panel">
      <div className="panel-head">
        <span className="panel-title">Layers</span>
        <span className="muted small">front → back</span>
      </div>
      <ul className="node-list">
        {frontToBack.map((l, k) => (
          <li key={l} className="node-row" onDoubleClick={() => setMode(l)} title="Double-click to edit this layer">
            <span className="layer-index">{k + 1}</span>
            <span className="node-name">{LAYER_LABELS[l]}</span>
            <span className="node-actions always">
              <IconButton icon="up" title="Move toward the front" size={12} disabled={readOnly || k === 0} onClick={() => move(l, 1)} />
              <IconButton
                icon="down"
                title="Move toward the back"
                size={12}
                disabled={readOnly || k === frontToBack.length - 1}
                onClick={() => move(l, -1)}
              />
            </span>
          </li>
        ))}
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
