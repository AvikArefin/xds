import { useEffect, useState } from "react";
import type { Layer, Node } from "@xds/protocol";
import { LAYER_LABELS } from "@xds/protocol";
import { api, type LibraryLogo } from "../../api";
import { isMasterNode } from "@xds/editor-core";
import { nodeLabel, slideNodes, useActiveSlide, useStudio } from "../../store";
import { SHAPES, SHAPE_LABELS, ShapePreview } from "../../stage/shapes";
import { addStarterBackground } from "../commands";
import { Icon } from "../Icon";
import { IconButton, ListRow, Menu, MenuItem } from "../ui";

export function NodeRow({
  node,
  selected,
  locked,
  onSelect,
  extra,
  draggable,
  onDrop,
  tags,
}: {
  node: Node;
  selected: boolean;
  locked: boolean;
  onSelect: (e: React.MouseEvent) => void;
  extra?: React.ReactNode;
  draggable?: boolean;
  onDrop?: (fromId: string) => void;
  /** Small muted words after the name: a flow group's name, "master". */
  tags?: string[];
}) {
  const project = useStudio((s) => s.project);
  const readOnly = useStudio((s) => s.readOnly);
  const { toggleHidden, toggleLock } = useStudio.getState();
  return (
    <ListRow
      label={
        tags?.length ? (
          <>
            {nodeLabel(node, project)}
            {tags.map((t) => (
              <span key={t} className="row-tag">
                {t}
              </span>
            ))}
          </>
        ) : (
          nodeLabel(node, project)
        )
      }
      title={node.id}
      selected={selected}
      hidden={!!node.hidden}
      dragType={draggable ? "text/x-xds-node" : undefined}
      dragId={node.id}
      onDropFrom={onDrop}
      onClick={onSelect}
      actions={
        <>
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
        </>
      }
    />
  );
}

function AddMenu({ layer }: { layer: Layer }) {
  const project = useStudio((s) => s.project)!;
  const designs = useStudio((s) => s.designs);
  const readOnly = useStudio((s) => s.readOnly);
  const { addText, addImage, addLibraryLogo, addBackground, addShapeNode, setMode } = useStudio.getState();
  const [logos, setLogos] = useState<LibraryLogo[] | null>(null);
  const [starters, setStarters] = useState<string[] | null>(null);
  const [showStarters, setShowStarters] = useState(false);
  const [showShapes, setShowShapes] = useState(false);
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
    // library logos are offered from the library list, registered or not
    const assets = (project.assets ?? []).filter((a) => (a.kind === "image" || a.kind === "svg") && !a.path.startsWith("xds:"));
    return (
      <Menu
        trigger={(toggle) => (
          <button
            type="button"
            className="btn small block"
            disabled={readOnly}
            onClick={() => {
              if (!logos) api.library().then((r) => setLogos(r.logos), () => setLogos([]));
              toggle();
            }}
          >
            <Icon name="plus" size={12} /> New image…
          </button>
        )}
      >
        {(close) => (
          <>
            <div className="menu-label">Library</div>
            {logos === null && <div className="menu-note">Loading…</div>}
            {logos?.map((l) => (
              <MenuItem
                key={l.id}
                hint={l.brand}
                onClick={() => {
                  addLibraryLogo(l);
                  close();
                }}
              >
                {l.file.replace(/\.[^.]+$/, "")}
              </MenuItem>
            ))}
            <div className="menu-sep" />
            <div className="menu-label">Project</div>
            {assets.length ? (
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
            )}
            <div className="menu-sep" />
            {!showShapes ? (
              <MenuItem onClick={() => setShowShapes(true)}>Shape…</MenuItem>
            ) : (
              <>
                <div className="menu-label">Shape (drawn, no file)</div>
                {SHAPES.map((shape) => (
                  <MenuItem
                    key={shape}
                    hint={<ShapePreview shape={shape} />}
                    onClick={() => {
                      addShapeNode(shape);
                      close();
                    }}
                  >
                    {SHAPE_LABELS[shape]}
                  </MenuItem>
                ))}
              </>
            )}
          </>
        )}
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
  const project = useStudio((s) => s.project)!;
  const { select, reorder, deleteSelection } = useStudio.getState();
  const all = slideNodes(project, slide).filter((n) => n.layer === layer);
  const own = all.filter((n) => !isMasterNode(project, n.id));
  const frontToBack = [...all].reverse();

  return (
    <div className="side-panel">
      <div className="panel-head">
        <span className="panel-title">{LAYER_LABELS[layer]}</span>
        <span className="muted small">{all.length} on this slide</span>
      </div>
      <ul className="node-list">
        {frontToBack.map((n) => {
          const master = isMasterNode(project, n.id);
          const group = n.layer !== "render" ? n.layout?.group : undefined;
          return (
          <NodeRow
            key={n.id}
            node={n}
            selected={selectedIds.includes(n.id)}
            locked={!!locked[n.id]}
            draggable={!master}
            tags={[...(group ? [group] : []), ...(master ? ["master"] : [])]}
            onSelect={(e) => select([n.id], { toggle: e.shiftKey || e.metaKey })}
            onDrop={(fromId) => reorder(fromId, own.indexOf(n))}
            extra={
              selectedIds.includes(n.id) && !readOnly && !master ? (
                <>
                  <IconButton icon="up" title="Bring forward" size={12} onClick={(e) => (e.stopPropagation(), reorder(n.id, "forward"))} />
                  <IconButton icon="down" title="Send backward" size={12} onClick={(e) => (e.stopPropagation(), reorder(n.id, "backward"))} />
                  <IconButton icon="trash" title="Delete (⌫)" size={12} onClick={(e) => (e.stopPropagation(), deleteSelection())} />
                </>
              ) : null
            }
          />
          );
        })}
        {!all.length && <li className="muted small pad">Nothing on this layer yet.</li>}
      </ul>
      <div className="panel-foot">
        <AddMenu layer={layer} />
      </div>
    </div>
  );
}
