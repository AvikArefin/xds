/**
 * The Studio editor (human-interaction.md): SlideRail | Stage | side panel | Inspector, with a
 * status bar, the command palette and the project browser.
 */
import { Component, useState, type ReactNode } from "react";
import { api } from "./api";
import { FindingItem } from "./components/AuditPanel";
import { CommandPalette } from "./components/CommandPalette";
import { ExportBlockedDialog, PromptDialog, StatusBar } from "./components/Dialogs";
import { Inspector } from "./components/inspectors/Inspector";
import { LayerList } from "./components/panels/LayerList";
import { PresentPanel } from "./components/panels/PresentPanel";
import { ScenePanel } from "./components/panels/ScenePanel";
import { ProjectBrowser } from "./components/ProjectBrowser";
import { SlideRail } from "./components/SlideRail";
import { StageArea } from "./components/StageArea";
import { useDocumentSync, useGuideSync } from "./hooks/useDocumentSync";
import { useShortcuts } from "./hooks/useShortcuts";
import { useStudio } from "./store";
import "./styles/app.css";
import "./styles/controls.css";
import "./styles/panels.css";
import "./styles/canvas.css";

class ErrorBoundary extends Component<{ children: ReactNode; label: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error)
      return (
        <div className="boundary-error">
          <strong>{this.props.label} failed to draw.</strong>
          <pre>{this.state.error.message}</pre>
          <button type="button" className="btn small" onClick={() => this.setState({ error: null })}>
            Retry
          </button>
        </div>
      );
    return this.props.children;
  }
}

function SidePanel() {
  const mode = useStudio((s) => s.mode);
  return (
    <aside className="side">
      {mode === "present" ? <PresentPanel /> : mode === "render" ? <ScenePanel /> : <LayerList layer={mode} />}
    </aside>
  );
}

/** The project failed the gate badly enough that it can't be drawn: list why. Never a demo. */
function BrokenProject() {
  const check = useStudio((s) => s.check);
  const root = useStudio((s) => s.root);
  return (
    <main className="broken">
      <h2>This project can't be opened for editing</h2>
      <p className="muted">
        {root} has {check.findings.length} structural finding(s). Fix them in project.json (or run <code>uv run xds migrate</code> for an
        old project); the editor reloads as soon as the file changes.
      </p>
      <ul className="findings">
        {check.findings.map((f, i) => (
          <FindingItem key={i} f={f} />
        ))}
      </ul>
      <button type="button" className="btn" onClick={() => useStudio.getState().setProjectBrowser("open")}>
        Open another project…
      </button>
    </main>
  );
}

/** An older project: the editor can't draw it until `xds migrate` upgrades project.json. */
function NeedsMigration() {
  const root = useStudio((s) => s.root);
  const finding = useStudio((s) => s.check.findings.find((f) => f.rule === "MIGRATION_NEEDED"));
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const migrate = async () => {
    setBusy(true);
    try {
      const { report } = await api.migrate();
      const unresolved = (report.unresolved ?? []).map((u) =>
        typeof u === "object" && u && "message" in u ? String((u as { message: unknown }).message) : String(u),
      );
      setProblems(unresolved);
      if (report.written) useStudio.getState().notify("success", `Migrated. The old project.json is saved at ${report.backup}.`);
      await useStudio.getState().load("refresh");
    } catch (e) {
      useStudio.getState().notify("error", `Migration failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="broken">
      <h2>This project needs migrating</h2>
      <p className="muted">
        {root} was made with an older XDS ({finding?.message}). Migrating upgrades project.json to the current format and keeps a backup
        of the old file in <code>.migrate-backup/</code>. It's the same as running <code>uv run xds migrate</code>.
      </p>
      {problems.length > 0 && (
        <ul className="findings">
          <li className="small">Not migrated. Nothing was changed:</li>
          {problems.map((p, i) => (
            <li key={i} className="muted small">
              {p}
            </li>
          ))}
        </ul>
      )}
      <div className="dialog-actions" style={{ justifyContent: "flex-start" }}>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void migrate()}>
          {busy ? "Migrating…" : "Migrate project"}
        </button>
        <button type="button" className="btn" onClick={() => useStudio.getState().setProjectBrowser("open")}>
          Open another project…
        </button>
      </div>
    </main>
  );
}

export default function App() {
  useDocumentSync();
  useGuideSync();
  useShortcuts();
  const status = useStudio((s) => s.status);
  const loadError = useStudio((s) => s.loadError);
  const hasProject = useStudio((s) => !!s.project);
  const needsMigration = useStudio((s) => s.check.findings.some((f) => f.rule === "MIGRATION_NEEDED"));

  let body: ReactNode;
  if (status === "loading") body = <div className="splash">Loading project…</div>;
  else if (status === "error")
    body = (
      <div className="splash error">
        <h2>Can't load the project</h2>
        <p>{loadError}</p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => void useStudio.getState().load("initial")}>
            Retry
          </button>
          <button type="button" className="btn" onClick={() => useStudio.getState().setProjectBrowser("open")}>
            Open project…
          </button>
        </div>
      </div>
    );
  else if (needsMigration) body = <NeedsMigration />;
  else if (!hasProject) body = <BrokenProject />;
  else
    body = (
      <div className="shell">
        <ErrorBoundary label="The slide rail">
          <SlideRail />
        </ErrorBoundary>
        <ErrorBoundary label="The stage">
          <StageArea />
        </ErrorBoundary>
        <ErrorBoundary label="The side panel">
          <SidePanel />
        </ErrorBoundary>
        <ErrorBoundary label="The inspector">
          <Inspector />
        </ErrorBoundary>
      </div>
    );

  return (
    <div className="app">
      {body}
      <StatusBar />
      <CommandPalette />
      <ProjectBrowser />
      <ExportBlockedDialog />
      <PromptDialog />
    </div>
  );
}
