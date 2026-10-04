import { useEffect, useState } from "react";
import { api } from "../api";
import type { ProjectListItem } from "../types";
import { isDirty, useStudio } from "../store";
import { formatOptions, useFormatCatalog } from "./FormatSelect";
import { Icon } from "./Icon";
import { IconButton, Select } from "./ui";

async function confirmSwitch(): Promise<boolean> {
  const st = useStudio.getState();
  if (!isDirty(st)) return true;
  const r = await st.ask({
    title: "Discard unsaved edits?",
    message: "This project has unsaved edits. Switching projects discards them.",
    input: false,
    confirm: "Discard and switch",
    danger: true,
  });
  return r !== null;
}

async function openPath(path: string) {
  if (!(await confirmSwitch())) return false;
  try {
    await api.openProject(path);
    useStudio.getState().setProjectBrowser(null);
    await useStudio.getState().load("switch");
    return true;
  } catch (e) {
    useStudio.getState().notify("error", `Can't open ${path}: ${(e as Error).message}`);
    return false;
  }
}

function OpenTab() {
  const [data, setData] = useState<{ dir: string; projects: ProjectListItem[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState("");
  useEffect(() => {
    api
      .projects()
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, []);
  return (
    <div className="pb-tab">
      {error && <div className="callout sev-error">{error}</div>}
      {data && <div className="muted small">Projects in {data.dir}</div>}
      <ul className="pb-list">
        {data?.projects.map((p) => (
          <li key={p.path}>
            <button type="button" className="pb-item" onClick={() => void openPath(p.path)}>
              <span className="pb-name">{p.name}</span>
              {p.active && <span className="badge active">Active</span>}
              {p.schemaVersion !== 2 && <span className="badge sev-warn">v{p.schemaVersion ?? "?"} · needs migrate</span>}
              <span className="muted mono small">{p.path}</span>
            </button>
          </li>
        ))}
        {data && !data.projects.length && <li className="muted small pad">No projects yet. Create one in the New project tab.</li>}
      </ul>
      <div className="pb-path">
        <input className="text-input" placeholder="/path/to/project" value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === "Enter" && path && void openPath(path)} />
        <button type="button" className="btn small" disabled={!path} onClick={() => void openPath(path)}>
          Open
        </button>
        <button
          type="button"
          className="btn small"
          onClick={async () => {
            try {
              const r = await api.chooseFolder();
              if (r.path) await openPath(r.path);
            } catch (e) {
              useStudio.getState().notify("error", (e as Error).message);
            }
          }}
        >
          <Icon name="open" size={12} /> Browse…
        </button>
      </div>
    </div>
  );
}

function NewTab() {
  const catalog = useFormatCatalog();
  const [dir, setDir] = useState("");
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [touched, setTouched] = useState(false);
  const [format, setFormat] = useState("instagram-portrait");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api
      .projects()
      .then((r) => setDir(r.dir))
      .catch(() => {});
  }, []);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const path = touched ? folder : dir && slug ? `${dir}/${slug}` : "";
  const create = async () => {
    if (!name.trim() || !path) return;
    if (!(await confirmSwitch())) return;
    setBusy(true);
    try {
      await api.initProject({ path, name: name.trim(), format });
      useStudio.getState().setProjectBrowser(null);
      await useStudio.getState().load("switch");
      useStudio.getState().notify("success", `Created ${name}.`);
    } catch (e) {
      useStudio.getState().notify("error", `Can't create the project: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pb-tab form">
      <label>
        <span>Name</span>
        <input className="text-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Launch campaign" />
      </label>
      <label>
        <span>Folder</span>
        <input
          className="text-input mono"
          value={path}
          onChange={(e) => {
            setTouched(true);
            setFolder(e.target.value);
          }}
          placeholder={`${dir || "~/xd-projects"}/<name>`}
        />
      </label>
      <label>
        <span>Format</span>
        <Select value={format} options={formatOptions(catalog)} onChange={(v) => v && setFormat(v)} />
      </label>
      <div className="dialog-actions">
        <button type="button" className="btn primary" disabled={busy || !name.trim() || !path} onClick={create}>
          {busy ? "Creating…" : "Create"}
        </button>
      </div>
    </div>
  );
}

export function ProjectBrowser() {
  const tab = useStudio((s) => s.projectBrowser);
  const set = useStudio((s) => s.setProjectBrowser);
  if (!tab) return null;
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && set(null)}>
      <div className="dialog wide" role="dialog" aria-label="Projects">
        <div className="dialog-head">
          <div className="tabs">
            <button type="button" className={tab === "open" ? "active" : ""} onClick={() => set("open")}>
              Open project
            </button>
            <button type="button" className={tab === "new" ? "active" : ""} onClick={() => set("new")}>
              New project
            </button>
          </div>
          <IconButton icon="x" title="Close" onClick={() => set(null)} />
        </div>
        {tab === "open" ? <OpenTab /> : <NewTab />}
      </div>
    </div>
  );
}
