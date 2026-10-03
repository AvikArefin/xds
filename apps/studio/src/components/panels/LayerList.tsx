import { useEffect, useState } from "react";
import type { Layer, Node } from "@xds/protocol";
import { LAYER_LABELS } from "@xds/protocol";
import { api } from "../../api";
import { nodeLabel, nodesOf, useActiveSlide, useStudio } from "../../store";
import { addStarterBackground } from "../commands";
import { Icon } from "../Icon";
import { IconButton, Menu, MenuItem } from "../ui";

export function NodeRow({
  node,
  selected,
  locked,
  onSelect,
  extra,
  draggable,
  onDrop,
}: {
  node: Node;
  selected: boolean;
  locked: boolean;
  onSelect: (e: React.MouseEvent) => void;
  extra?: React.ReactNode;
  draggable?: boolean;
  onDrop?: (fromId: string) => void;
}) {
  const project = useStudio((s) => s.project);
  const readOnly = useStudio((s) => s.readOnly);
  const { toggleHidden, toggleLock } = useStudio.getState();
  const [over, setOver] = useState(false);
  return (
    <li
      className={`node-row${selected ? " selected" : ""}${node.hidden ? " is-hidden" : ""}${over ? " drop" : ""}`}
      onClick={onSelect}
      draggable={draggable && !readOnly}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/x-xds-node", node.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (!onDrop || !e.dataTransfer.types.includes("text/x-xds-node")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = e.dataTransfer.getData("text/x-xds-node");
        if (id && id !== node.id) onDrop?.(id);
      }}
    >
      {draggable && <Icon name="grip" size={12} className="grip" />}
      <span className="node-name" title={node.id}>
        {nodeLabel(node, project)}
      </span>
      <span className="node-actions">
        {extra}
        <IconButton
          icon={node.hidden ? "eyeOff" : "eye"}
          title={node.hidden ? "Show" : "Hide"}
          size={12}
          disabled={readOnly}
          active={!!node.hidden}
          onClick={(e) => {
            e.stopPropagation();
            toggleHidden(node.id);
          }}
        />
        <IconButton
          icon={locked ? "lock" : "unlock"}
          title={locked ? "Unlock (editor only)" : "Lock (editor only)"}
          size={12}
          active={locked}
          onClick={(e) => {
            e.stopPropagation();
            toggleLock(node.id);
          }}
        />
      </span>
    </li>
  );
}

function AddMenu({ layer }: { layer: Layer }) {
  const project = useStudio((s) => s.project)!;
  const designs = useStudio((s) => s.designs);
  const readOnly = useStudio((s) => s.readOnly);
  const { addText, addImage, addBackground, setMode } = useStudio.getState();
  const [starters, setStarters] = useState<string[] | null>(null);
  const [showStarters, setShowStarters] = useState(false);
  useEffect(() => {
    if (showStarters && !starters) api.starters().then((r) => setStarters(r.designs)).catch(() => setStarters([]));
  }, [showStarters, starters]);

  if (layer === "type") {
    const roles = Object.entries(project.brand.typography ?? {});
    return (
      <Menu
        trigger={(toggle) => (
          <button type="button" className="btn small block" disabled={readOnly} onClick={toggle}>
            <Icon name="plus" size={12} /> New text…
          </button>
        )}
      >
        {(close) =>
          roles.length ? (
            roles.map(([name, role]) => (
              <MenuItem
                key={name}
                hint={role.level}
                onClick={() => {
                  addText(name);
                  close();
                }}
              >
                {name}
              </MenuItem>
            ))
          ) : (
            <div className="menu-note">
              No type roles yet. Declare one in{" "}
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setMode("present");
                  close();
                }}
              >
                Present → Brand → Typography
              </button>
              .
            </div>
          )
        }
      </Menu>
    );
  }
  if (layer === "image") {
    const assets = (project.assets ?? []).filter((a) => a.kind === "image" || a.kind === "svg");
    return (
      <Menu
        trigger={(toggle) => (
          <button type="button" className="btn small block" disabled={readOnly} onClick={toggle}>
            <Icon name="plus" size={12} /> New image…
          </button>
        )}
      >
        {(close) =>
          assets.length ? (
            assets.map((a) => (
              <MenuItem
                key={a.id}
                hint={a.path}
                onClick={() => {
                  addImage(a.id);
                  close();
                }}
              >
                {a.id}
              </MenuItem>
            ))
          ) : (
            <div className="menu-note">No image assets. Put files in assets/ and register them in project.json.</div>
          )
        }
      </Menu>
    );
  }
  // ground
  const ids = Object.keys(designs);
  return (
    <Menu
      trigger={(toggle) => (
        <button type="button" className="btn small block" disabled={readOnly} onClick={toggle}>
          <Icon name="plus" size={12} /> New background…
        </button>
      )}
    >
      {(close) => (
        <>
          {ids.map((id) => (
            <MenuItem
              key={id}
              hint={designs[id].error ? "error" : designs[id].manifest?.name}
              onClick={() => {
                addBackground(id);
                close();
              }}
            >
              {id}
            </MenuItem>
          ))}
          {!ids.length && <div className="menu-note">No designs in this project yet.</div>}
          <div className="menu-sep" />
          {!showStarters ? (
            <MenuItem onClick={() => setShowStarters(true)}>From starters…</MenuItem>
          ) : (
            <>
              <div className="menu-label">Starters (copied into designs/)</div>
              {starters === null && <div className="menu-note">Loading…</div>}
              {starters?.map((s) => (
                <MenuItem
                  key={s}
                  onClick={() => {
                    close();
                    void addStarterBackground(s);
                  }}
                >
                  {s}
                </MenuItem>
              ))}
            </>
          )}
        </>
      )}
    </Menu>
  );
}

/** The current layer's nodes on the active slide, front → back. */
export function LayerList({ layer }: { layer: Layer }) {
  const slide = useActiveSlide();
  const selectedIds = useStudio((s) => s.selectedIds);
  const locked = useStudio((s) => s.locked);
  const readOnly = useStudio((s) => s.readOnly);
  const { select, reorder, deleteSelection } = useStudio.getState();
  const all = nodesOf(slide).filter((n) => n.layer === layer);
  const frontToBack = [...all].reverse();

  return (
    <div className="side-panel">
      <div className="panel-head">
        <span className="panel-title">{LAYER_LABELS[layer]}</span>
        <span className="muted small">{all.length} on this slide</span>
      </div>
      <ul className="node-list">
        {frontToBack.map((n) => (
          <NodeRow
            key={n.id}
            node={n}
            selected={selectedIds.includes(n.id)}
            locked={!!locked[n.id]}
            draggable
            onSelect={(e) => select([n.id], { toggle: e.shiftKey || e.metaKey })}
            onDrop={(fromId) => reorder(fromId, all.indexOf(n))}
            extra={
              selectedIds.includes(n.id) && !readOnly ? (
                <>
                  <IconButton icon="up" title="Bring forward" size={12} onClick={(e) => (e.stopPropagation(), reorder(n.id, "forward"))} />
                  <IconButton icon="down" title="Send backward" size={12} onClick={(e) => (e.stopPropagation(), reorder(n.id, "backward"))} />
                  <IconButton icon="trash" title="Delete (⌫)" size={12} onClick={(e) => (e.stopPropagation(), deleteSelection())} />
                </>
              ) : null
            }
          />
        ))}
        {!all.length && <li className="muted small pad">Nothing on this layer yet.</li>}
      </ul>
      <div className="panel-foot">
        <AddMenu layer={layer} />
      </div>
    </div>
  );
}
