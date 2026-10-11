import { useState } from "react";
import type { Finding } from "@xds/protocol";
import { useStudio } from "../store";
import { Icon } from "./Icon";
import { IconButton } from "./ui";

const SEV_ICON = { error: "error", warn: "warn", info: "info" } as const;

export function FindingItem({ f, onClick, compact }: { f: Finding; onClick?: () => void; compact?: boolean }) {
  const markIntentional = useStudio((s) => s.markIntentional);
  const applyEdits = useStudio((s) => s.applyEdits);
  const readOnly = useStudio((s) => s.readOnly);
  const structural = f.family === "check" || !!f.path;
  const waived = f.status === "waived";
  const fixable = !waived && !!f.edits?.length && !readOnly;
  return (
    <li className={`finding sev-${f.severity}${waived ? " waived" : ""}`}>
      <button type="button" className="finding-main" onClick={onClick} title={f.fix ? `Fix: ${f.fix}` : undefined}>
        <Icon name={SEV_ICON[f.severity]} size={13} className="finding-icon" />
        <span className="finding-text">
          <span className="finding-rule">
            {f.rule}
            {f.slideId && <span className="muted"> · {f.slideId}</span>}
            {f.path && <span className="muted mono"> · {f.path}</span>}
          </span>
          <span className="finding-msg">{f.message}</span>
          {!compact && f.fix && <span className="finding-fix">{f.fix}</span>}
          {waived && f.waiver?.reason && <span className="finding-fix">Intentional: {f.waiver.reason}</span>}
        </span>
      </button>
      {!compact && (fixable || (!structural && !waived)) && (
        <span className="finding-actions">
          {fixable && (
            <button
              type="button"
              className="link-btn"
              title={f.edits!.map((e) => `${e.nodeId ?? e.slideId ?? "project"}: ${e.path} → ${JSON.stringify(e.value ?? null)}`).join("\n")}
              onClick={() => {
                const n = applyEdits(f.edits!);
                if (n) useStudio.getState().notify("success", `Applied: ${f.fix}`);
              }}
            >
              Fix
            </button>
          )}
          {!structural && !waived && (
            <button type="button" className="link-btn" onClick={() => markIntentional(f)}>
              Mark as intentional…
            </button>
          )}
        </span>
      )}
    </li>
  );
}

export function AuditPanel() {
  const report = useStudio((s) => s.report);
  const auditing = useStudio((s) => s.auditing);
  const lines = useStudio((s) => s.jobs.audit?.lines);
  const runAudit = useStudio((s) => s.runAudit);
  const focusFinding = useStudio((s) => s.focusFinding);
  const hash = useStudio((s) => s.hash);
  const readOnly = useStudio((s) => s.readOnly);
  const check = useStudio((s) => s.check);
  const activeSlideId = useStudio((s) => s.activeSlideId);
  const showAudit = useStudio((s) => s.showAudit);
  const toggleAudit = useStudio((s) => s.toggleAudit);
  const fixAll = useStudio((s) => s.fixAll);
  const live = useStudio((s) => s.liveFindings);
  const liveOpen = useStudio((s) => s.liveOpen);
  const toggleLive = useStudio((s) => s.toggleLive);
  const [scope, setScope] = useState<"slide" | "all">("all");
  const [showWaived, setShowWaived] = useState(false);

  const stale = report && report.sourceHash !== hash;
  const findings = (report?.findings ?? []).filter(
    (f) => (showWaived || f.status !== "waived") && (scope === "all" || !f.slideId || f.slideId === activeSlideId),
  );
  const sum = report?.summary;
  const fixable = (report?.findings ?? []).filter(
    (f) => f.status === "open" && f.severity !== "info" && f.edits?.length && (!f.slideId || f.slideId === activeSlideId),
  ).length;

  return (
    <div className="audit-panel">
      <div className="audit-head">
        <span className="rail-title">Audit</span>
        {sum && (
          <span className="audit-counts">
            <span className="count sev-error" title="errors">
              {sum.errors ?? 0}
            </span>
            <span className="count sev-warn" title="warnings">
              {sum.warnings ?? 0}
            </span>
            <span className="count sev-info" title="info">
              {sum.infos ?? 0}
            </span>
          </span>
        )}
        <button type="button" className="btn small primary" disabled={auditing || readOnly} onClick={() => runAudit()} title="Run audit (A)">
          {auditing ? "Running…" : "Run audit"}
        </button>
      </div>
      {auditing && lines?.length ? <div className="progress-line">{lines[lines.length - 1]}</div> : null}
      {!readOnly && (
        <div className="audit-live">
          <button
            type="button"
            className="audit-live-head"
            onClick={() => toggleLive()}
            title="The text and spacing rules, run in the editor after every edit on this slide. A preview: the audit is the judge."
          >
            <Icon name={liveOpen ? "chevronDown" : "chevronRight"} size={12} />
            <span className="rail-title">Live</span>
            <span className="audit-counts">
              {(["error", "warn", "info"] as const).map((sev) => {
                const n = live.filter((f) => f.severity === sev).length;
                return n ? (
                  <span key={sev} className={`count sev-${sev}`} title={sev}>
                    {n}
                  </span>
                ) : null;
              })}
              {!live.length && <span className="muted small">clean</span>}
            </span>
          </button>
          {liveOpen && live.length > 0 && (
            <ul className="findings live">
              {live.map((f, i) => (
                <FindingItem key={`${f.rule}-${i}`} f={f} onClick={() => focusFinding(f)} />
              ))}
            </ul>
          )}
        </div>
      )}
      {readOnly && check.findings.length > 0 && (
        <ul className="findings">
          {check.findings.map((f, i) => (
            <FindingItem key={i} f={f} />
          ))}
        </ul>
      )}
      {report && (
        <>
          <div className="audit-filters">
            <button type="button" className={`chip${scope === "all" ? " active" : ""}`} onClick={() => setScope("all")}>
              All slides
            </button>
            <button type="button" className={`chip${scope === "slide" ? " active" : ""}`} onClick={() => setScope("slide")}>
              This slide
            </button>
            {(sum?.waived ?? 0) > 0 && (
              <button type="button" className={`chip${showWaived ? " active" : ""}`} onClick={() => setShowWaived(!showWaived)}>
                Waived {sum?.waived}
              </button>
            )}
            <IconButton
              icon={showAudit ? "eye" : "eyeOff"}
              title={`${showAudit ? "Hide" : "Show"} findings on the canvas (Shift+A). View only, not saved`}
              active={showAudit}
              onClick={toggleAudit}
              className="audit-canvas-toggle"
            />
          </div>
          {stale && <div className="muted small pad">Edited since this audit. Run it again to update.</div>}
          {!stale && fixable > 0 && !readOnly && (
            <div className="audit-fixall">
              <button type="button" className="btn small" onClick={() => void fixAll()} title="Apply every error's and warning's structured fix on this slide (one undo step), then audit again">
                Fix all on this slide ({fixable})
              </button>
            </div>
          )}
          <ul className="findings">
            {findings.map((f, i) => (
              <FindingItem key={`${f.rule}-${i}`} f={f} onClick={() => focusFinding(f)} />
            ))}
            {!findings.length && <li className="muted small pad">No findings{scope === "slide" ? " on this slide" : ""}.</li>}
          </ul>
        </>
      )}
      {!report && !readOnly && !auditing && <div className="muted small pad">Run the audit to check layout, type, contrast and lighting.</div>}
    </div>
  );
}
