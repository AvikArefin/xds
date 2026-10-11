import { useEffect } from "react";
import { LAYER_LABELS, type Layer } from "@xds/protocol";
import { layerOrder, useStudio } from "../../store";
import { formatOptions, useFormatCatalog } from "../FormatSelect";
import { Icon } from "../Icon";
import { IconButton, ListRow, Select } from "../ui";
import { MasterPanel } from "./MasterPanel";

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
  const { setLayerOrder, setMode, exportSlides, loadExports, toggleLayer } = useStudio.getState();
  const catalog = useFormatCatalog();
  const current = project.format.preset;
  const targetOptions = formatOptions(catalog).filter((o) => o.value !== current);
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
        {frontToBack.map((l) => {
          const shown = !hiddenLayers.includes(l);
          return (
            <ListRow
              key={l}
              label={LAYER_LABELS[l]}
              title="Drag to reorder · double-click to edit this layer"
              hidden={!shown}
              dragType="text/x-xds-layer"
              dragId={l}
              onDropFrom={(from) => moveTo(from as Layer, l)}
              onDoubleClick={() => setMode(l)}
              actions={
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
              }
            />
          );
        })}
      </ul>

      <MasterPanel />

      <div className="panel-head">
        <span className="panel-title">Exports</span>
        <span className="panel-actions">
          <button type="button" className="btn small" disabled={readOnly || exportJob?.running} onClick={() => exportSlides("png")}>
            <Icon name="download" size={12} /> {exportJob?.running ? "Exporting…" : "PNG"}
          </button>
          <button
            type="button"
            className="btn small"
            title="The deck as one PDF, a page per slide (for a LinkedIn carousel)"
            disabled={readOnly || exportJob?.running}
            onClick={() => exportSlides("pdf")}
          >
            <Icon name="download" size={12} /> PDF
          </button>
        </span>
      </div>
      <div className="export-target" title="Export the saved deck reflowed to another preset (one source, several formats). The files land in export/<stamp>-<preset>/.">
        <Select
          value={undefined}
          options={targetOptions}
          noneLabel="Also export as…"
          disabled={readOnly || exportJob?.running || !targetOptions.length}
          onChange={(v) => v && void exportSlides("png", false, v)}
        />
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
              {e.record?.sourceFormat && (
                <span className="badge" title={`The ${e.record.sourceFormat} source reflowed to ${e.record.format}`}>
                  {e.record.format}
                </span>
              )}
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
