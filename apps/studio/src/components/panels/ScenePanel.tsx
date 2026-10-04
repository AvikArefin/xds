import { useRef, useState } from "react";
import type { SceneObject } from "@xds/protocol";
import { nodesOf, useActiveSlide, useStudio } from "../../store";
import { api, type LibraryModel } from "../../api";
import { addLibraryModel, importModel } from "../commands";
import { Icon } from "../Icon";
import { IconButton, Menu, MenuItem } from "../ui";
import { NodeRow } from "./LayerList";

const SHAPES: SceneObject["kind"][] = ["box", "sphere", "cylinder", "torus", "plane"];

export function ScenePanel() {
  const slide = useActiveSlide();
  const project = useStudio((s) => s.project)!;
  const selectedIds = useStudio((s) => s.selectedIds);
  const locked = useStudio((s) => s.locked);
  const readOnly = useStudio((s) => s.readOnly);
  const { select, deleteSelection, addShape, addObjectToSlide } = useStudio.getState();
  const fileRef = useRef<HTMLInputElement>(null);
  const [library, setLibrary] = useState<LibraryModel[] | null>(null);
  const nodes = nodesOf(slide).filter((n) => n.layer === "render");
  const onSlide = new Set(nodes.map((n) => (n.layer === "render" ? n.data.object : "")));
  const offSlide = (project.objects ?? []).filter((o) => !onSlide.has(o.id));

  return (
    <div className="side-panel">
      <div className="panel-head">
        <span className="panel-title">3D objects</span>
        <span className="muted small">{nodes.length} on this slide</span>
      </div>
      <ul className="node-list">
        {nodes.map((n) => (
          <NodeRow
            key={n.id}
            node={n}
            selected={selectedIds.includes(n.id)}
            locked={!!locked[n.id]}
            onSelect={(e) => select([n.id], { toggle: e.shiftKey || e.metaKey })}
            extra={
              !readOnly ? (
                <IconButton
                  icon="x"
                  title="Remove from this slide"
                  size={12}
                  onClick={(e) => {
                    e.stopPropagation();
                    select([n.id]);
                    deleteSelection();
                  }}
                />
              ) : null
            }
          />
        ))}
        {!nodes.length && <li className="muted small pad">No 3D object on this slide.</li>}
      </ul>
      {offSlide.length > 0 && (
        <>
          <div className="panel-sub">In the project, not on this slide</div>
          <ul className="node-list">
            {offSlide.map((o) => (
              <li key={o.id} className="node-row ghost">
                <span className="node-name">{o.name}</span>
                <span className="muted small">{o.kind}</span>
                <IconButton icon="plus" title="Add to this slide" size={12} disabled={readOnly} onClick={() => addObjectToSlide(o.id)} />
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="panel-foot">
        <input
          ref={fileRef}
          type="file"
          accept=".glb,.gltf,.dae,model/gltf-binary,model/gltf+json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void importModel(f);
          }}
        />
        <Menu
          trigger={(toggle) => (
            <button
              type="button"
              className="btn small block"
              disabled={readOnly}
              onClick={() => {
                if (!library) api.library().then((r) => setLibrary(r.models), () => setLibrary([]));
                toggle();
              }}
            >
              <Icon name="upload" size={12} /> Add model…
            </button>
          )}
        >
          {(close) => (
            <>
              <div className="menu-label">Library</div>
              {library === null && <div className="menu-note">Loading…</div>}
              {library?.map((m) => (
                <MenuItem
                  key={m.id}
                  hint={`${(m.bytes / 1e6).toFixed(1)} MB`}
                  onClick={() => {
                    close();
                    void addLibraryModel(m);
                  }}
                >
                  {m.name}
                </MenuItem>
              ))}
              <div className="menu-sep" />
              <MenuItem
                onClick={() => {
                  close();
                  fileRef.current?.click();
                }}
              >
                From file…
              </MenuItem>
            </>
          )}
        </Menu>
        <Menu
          trigger={(toggle) => (
            <button type="button" className="btn small block" disabled={readOnly} onClick={toggle}>
              <Icon name="plus" size={12} /> Add shape…
            </button>
          )}
        >
          {(close) =>
            SHAPES.map((k) => (
              <MenuItem
                key={k}
                onClick={() => {
                  addShape(k);
                  close();
                }}
              >
                {k[0].toUpperCase() + k.slice(1)}
              </MenuItem>
            ))
          }
        </Menu>
        <div className="muted small">Drag in the viewport: left orbit · right pan · scroll size · L+drag light.</div>
      </div>
    </div>
  );
}
