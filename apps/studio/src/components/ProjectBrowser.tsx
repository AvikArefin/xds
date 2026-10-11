import { useEffect, useState } from "react";
import { api } from "../api";
import type { ProjectListItem, Snapshot } from "../types";
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
              {p.schemaVersion !== 3 && <span className="badge sev-warn">v{p.schemaVersion ?? "?"} · needs migrate</span>}
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

function describe(s: Snapshot): string {
  if (s.label) return s.label;
  if (s.migrateBackup) return "Before migrate";
  if (s.reason.startsWith("auto: ")) return `Before a big save: ${s.reason.slice(6)}`;
  if (s.reason.startsWith("before restore")) return "Before a restore";
  return "Snapshot";
}

function when(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Snapshots of the open project: restore one, take one, delete one. */
function RestoreTab() {
  const [items, setItems] = useState<Snapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const readOnly = useStudio((s) => s.readOnly);
  const refresh = () =>
    api
      .snapshots()
      .then((r) => setItems(r.snapshots))
      .catch((e) => setError((e as Error).message));
  useEffect(() => void refresh(), []);

  const take = async () => {
    const st = useStudio.getState();
    if (isDirty(st) && !(await st.save())) return;
    const label = await useStudio.getState().ask({
      title: "Snapshot now",
      message: "Copies project.json, designs/ and screens/ into .snapshots/. A labelled snapshot is kept until you delete it.",
      label: "Label (optional)",
      confirm: "Snapshot",
    });
    if (label === null) return;
    setBusy("take");
    try {
      const r = await api.takeSnapshot(label.trim() || undefined);
      useStudio.getState().notify("success", `Snapshot ${r.snapshot.id} saved.`);
      await refresh();
    } catch (e) {
      useStudio.getState().notify("error", `Snapshot failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const restore = async (s: Snapshot) => {
    const st = useStudio.getState();
    const r = await st.ask({
      title: `Restore “${describe(s)}”?`,
      message: `${when(s.createdAt)} · ${s.summary.slides ?? "?"} slides · ${s.summary.nodes ?? "?"} nodes. The project on disk is replaced${
        isDirty(st) ? ", and your unsaved edits are lost" : ""
      }. The current state is snapshotted first, so this can be undone from this list.`,
      input: false,
      confirm: "Restore",
      danger: true,
    });
    if (r === null) return;
    setBusy(s.id);
    try {
      const res = await api.restoreSnapshot(s.id);
      useStudio.getState().setProjectBrowser(null);
      await useStudio.getState().load("refresh");
      useStudio.getState().notify("success", `Restored ${describe(s)}. The state before is snapshot ${res.safety.id}.`);
    } catch (e) {
      useStudio.getState().notify("error", `Restore failed: ${(e as Error).message}`);
      setBusy(null);
    }
  };

  const remove = async (s: Snapshot) => {
    const r = await useStudio.getState().ask({
      title: `Delete snapshot “${describe(s)}”?`,
      message: "This cannot be undone.",
      input: false,
      confirm: "Delete",
      danger: true,
    });
    if (r === null) return;
    try {
      await api.deleteSnapshot(s.id);
      await refresh();
    } catch (e) {
      useStudio.getState().notify("error", `Delete failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className="pb-tab">
      {error && <div className="callout sev-error">{error}</div>}
      <div className="muted small">
        Snapshots are taken by hand, before a big save (a format change, a slide added or removed, many nodes changed) and before a
        restore. They hold project.json, designs and screens.
      </div>
      <ul className="pb-list">
        {items?.map((s) => (
          <li key={s.id} className="pb-item pb-snapshot">
            <div className="pb-snapshot-main">
              <span className="pb-name">{describe(s)}</span>
              <span className="muted small">
                {when(s.createdAt)} · {s.summary.slides ?? "?"} slides · {s.summary.nodes ?? "?"} nodes
                {s.summary.format?.preset ? ` · ${s.summary.format.preset}` : s.summary.format?.width ? ` · ${s.summary.format.width}×${s.summary.format.height}` : ""}
                {s.summary.schemaVersion !== undefined && s.summary.schemaVersion !== 3 ? ` · schema v${s.summary.schemaVersion}` : ""}
              </span>
            </div>
            <button type="button" className="btn small" disabled={busy !== null || readOnly} onClick={() => void restore(s)}>
              {busy === s.id ? "Restoring…" : "Restore"}
            </button>
            {!s.migrateBackup && <IconButton icon="trash" title="Delete snapshot" size={12} disabled={busy !== null} onClick={() => void remove(s)} />}
          </li>
        ))}
        {items && !items.length && <li className="muted small pad">No snapshots yet.</li>}
      </ul>
      <div className="dialog-actions">
        <button type="button" className="btn primary" disabled={busy !== null || readOnly} onClick={() => void take()}>
          {busy === "take" ? "Saving…" : "Snapshot now…"}
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
            <button type="button" className={tab === "restore" ? "active" : ""} onClick={() => set("restore")}>
              Restore
            </button>
          </div>
          <IconButton icon="x" title="Close" onClick={() => set(null)} />
        </div>
        {tab === "open" ? <OpenTab /> : tab === "new" ? <NewTab /> : <RestoreTab />}
      </div>
    </div>
  );
}
