import { useState } from "react";
import type { Finding } from "@xds/protocol";
import { useStudio } from "../store";
import { Icon } from "./Icon";

const SEV_ICON = { error: "error", warn: "warn", info: "info" } as const;

export function FindingItem({ f, onClick, compact }: { f: Finding; onClick?: () => void; compact?: boolean }) {
  const markIntentional = useStudio((s) => s.markIntentional);
  const structural = f.family === "check" || !!f.path;
  const waived = f.status === "waived";
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
      {!structural && !waived && !compact && (
        <button type="button" className="link-btn" onClick={() => markIntentional(f)}>
          Mark as intentional…
        </button>
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
  const [scope, setScope] = useState<"slide" | "all">("all");
  const [showWaived, setShowWaived] = useState(false);

  const stale = report && report.sourceHash !== hash;
  const findings = (report?.findings ?? []).filter(
    (f) => (showWaived || f.status !== "waived") && (scope === "all" || !f.slideId || f.slideId === activeSlideId),
  );
  const sum = report?.summary;

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
          </div>
          {stale && <div className="muted small pad">Edited since this audit. Run it again to update.</div>}
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
