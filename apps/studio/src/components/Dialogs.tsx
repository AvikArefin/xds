import { useEffect, useState } from "react";
import { useDirty, useStudio } from "../store";
import { FindingItem } from "./AuditPanel";
import { Icon } from "./Icon";
import { IconButton } from "./ui";

export function PromptDialog() {
  const prompt = useStudio((s) => s.prompt);
  const [value, setValue] = useState("");
  useEffect(() => setValue(prompt?.value ?? ""), [prompt]);
  if (!prompt) return null;
  const input = prompt.input !== false;
  const ok = () => prompt.resolve(input ? value : "");
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && prompt.resolve(null)}>
      <form
        className="dialog"
        role="dialog"
        aria-label={prompt.title}
        onSubmit={(e) => {
          e.preventDefault();
          ok();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            prompt.resolve(null);
          }
        }}
      >
        <div className="dialog-head">
          <span className="dialog-title">{prompt.title}</span>
        </div>
        {prompt.message && <p className="dialog-msg">{prompt.message}</p>}
        {input && (
          <label className="dialog-field">
            {prompt.label && <span>{prompt.label}</span>}
            {prompt.multiline ? (
              <textarea
                className="text-input"
                rows={3}
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ok();
                }}
              />
            ) : (
              <input className="text-input" autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
            )}
          </label>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => prompt.resolve(null)}>
            Cancel
          </button>
          <button type="submit" className={`btn ${prompt.danger ? "danger" : "primary"}`} autoFocus={!input} disabled={input && !value.trim()}>
            {prompt.confirm ?? "OK"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function ExportBlockedDialog() {
  const blocked = useStudio((s) => s.exportBlocked);
  const { dismissExportBlocked, exportPng, focusFinding } = useStudio.getState();
  if (!blocked) return null;
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && dismissExportBlocked()}>
      <div className="dialog wide" role="dialog" aria-label="Export blocked">
        <div className="dialog-head">
          <span className="dialog-title">
            <Icon name="error" size={14} /> Export stopped: {blocked.length} open error(s)
          </span>
          <IconButton icon="x" title="Close" onClick={dismissExportBlocked} />
        </div>
        <p className="dialog-msg">Fix these, mark them as intentional, or export anyway (recorded as forced in export.json).</p>
        <ul className="findings scroll">
          {blocked.map((f, i) => (
            <FindingItem
              key={i}
              f={f}
              onClick={() => {
                dismissExportBlocked();
                focusFinding(f);
              }}
            />
          ))}
        </ul>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={dismissExportBlocked}>
            Cancel
          </button>
          <button type="button" className="btn danger" onClick={() => void exportPng(true)}>
            Export anyway
          </button>
        </div>
      </div>
    </div>
  );
}

export function StatusBar() {
  const notices = useStudio((s) => s.notices);
  const dismiss = useStudio((s) => s.dismissNotice);
  const project = useStudio((s) => s.project);
  const guide = useStudio((s) => s.guide);
  const readOnly = useStudio((s) => s.readOnly);
  const saving = useStudio((s) => s.saving);
  const root = useStudio((s) => s.root);
  const dirty = useDirty();
  const last = notices[notices.length - 1];
  return (
    <footer className="statusbar">
      <div className="status-notice">
        {last && (
          <span className={`notice lvl-${last.level}`}>
            <Icon name={last.level === "error" ? "error" : last.level === "warning" ? "warn" : last.level === "success" ? "check" : "info"} size={12} />
            <span>{last.text}</span>
            <button type="button" className="notice-x" onClick={() => dismiss(last.id)} aria-label="Dismiss">
              <Icon name="x" size={11} />
            </button>
          </span>
        )}
      </div>
      <div className="status-right">
        {readOnly ? (
          <span className="status-pill sev-error">Read-only</span>
        ) : (
          <span className={`status-pill${dirty ? " unsaved" : ""}`}>{saving ? "Saving…" : dirty ? "Unsaved changes" : "Saved"}</span>
        )}
        {project && (
          <span className="muted" title={root ?? undefined}>
            {project.name} · {guide?.label ?? project.format.preset ?? "Custom"} {project.format.width}×{project.format.height}
            {guide ? ` · u ${guide.u} · m ${guide.m}` : ""}
          </span>
        )}
      </div>
    </footer>
  );
}
