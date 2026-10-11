import { useState } from "react";
import { isDirty, useCanRedo, useCanUndo, useDirty, useStudio } from "../store";
import { AuditPanel } from "./AuditPanel";
import { FormatSelect } from "./FormatSelect";
import { Icon } from "./Icon";
import { SlideThumb } from "./SlideThumb";
import { IconButton } from "./ui";

function SlideList() {
  const project = useStudio((s) => s.project);
  const activeSlideId = useStudio((s) => s.activeSlideId);
  const report = useStudio((s) => s.report);
  const hash = useStudio((s) => s.hash);
  const readOnly = useStudio((s) => s.readOnly);
  const dirty = useDirty();
  const { setActiveSlide, addSlide, duplicateSlide, deleteSlide, moveSlide, renameSlide } = useStudio.getState();
  const [drag, setDrag] = useState<{ id: string; over: number | null } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  if (!project) return null;

  const cached = report && report.sourceHash === hash && !dirty ? hash : null;
  const counts = new Map<string, { e: number; w: number }>();
  for (const f of report?.findings ?? []) {
    if (f.status === "waived" || !f.slideId) continue;
    const c = counts.get(f.slideId) ?? { e: 0, w: 0 };
    if (f.severity === "error") c.e++;
    else if (f.severity === "warn") c.w++;
    counts.set(f.slideId, c);
  }

  return (
    <div className="slide-list-wrap">
      <div className="rail-head">
        <span className="rail-title">
          Slides <span className="muted">{project.slides.length}</span>
        </span>
        <IconButton icon="plus" title="Add slide" disabled={readOnly} onClick={() => addSlide()} />
      </div>
      <ol className="slide-list">
        {project.slides.map((slide, i) => {
          const c = counts.get(slide.id);
          return (
            <li
              key={slide.id}
              className={`slide-item${slide.id === activeSlideId ? " active" : ""}${drag?.over === i ? " drop" : ""}`}
              draggable={!readOnly && editing !== slide.id}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/x-xds-slide", slide.id);
                setDrag({ id: slide.id, over: null });
              }}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                if (drag.over !== i) setDrag({ ...drag, over: i });
              }}
              onDragEnd={() => setDrag(null)}
              onDrop={(e) => {
                e.preventDefault();
                if (drag) moveSlide(drag.id, i);
                setDrag(null);
              }}
              onClick={() => setActiveSlide(slide.id)}
            >
              <span className="slide-num">{i + 1}</span>
              <div className="slide-body">
                <SlideThumb project={project} slide={slide} index={i} cachedHash={cached} />
                <div className="slide-meta">
                  {editing === slide.id ? (
                    <input
                      className="text-input slim"
                      autoFocus
                      defaultValue={slide.name ?? ""}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => {
                        if (e.target.value !== (slide.name ?? "")) renameSlide(slide.id, e.target.value);
                        setEditing(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                  ) : (
                    <span className="slide-name" onDoubleClick={() => !readOnly && setEditing(slide.id)} title="Double-click to rename">
                      {slide.name || slide.id}
                    </span>
                  )}
                  <span className="slide-badges">
                    {c?.e ? <span className="badge sev-error">{c.e}</span> : null}
                    {c?.w ? <span className="badge sev-warn">{c.w}</span> : null}
                  </span>
                  {!readOnly && (
                    <span className="slide-actions">
                      <IconButton
                        icon="copy"
                        title="Duplicate slide (⌘D with nothing selected)"
                        size={12}
                        onClick={(e) => {
                          e.stopPropagation();
                          duplicateSlide(slide.id);
                        }}
                      />
                      {project.slides.length > 1 && (
                        <IconButton
                          icon="trash"
                          title="Delete slide"
                          size={12}
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteSlide(slide.id);
                          }}
                        />
                      )}
                    </span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Toolbar() {
  const saving = useStudio((s) => s.saving);
  const readOnly = useStudio((s) => s.readOnly);
  const dirty = useDirty();
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();
  const st = useStudio.getState();
  return (
    <div className="rail-toolbar">
      <IconButton icon="open" title="Open project (⌘O)" onClick={() => st.setProjectBrowser("open")} />
      <IconButton icon="search" title="Search commands (⌘K)" onClick={() => st.setPalette(true)} />
      <IconButton icon="history" title="Snapshots: restore a previous state" onClick={() => st.setProjectBrowser("restore")} />
      <IconButton icon="undo" title="Undo (⌘Z)" className="rail-undo" disabled={!canUndo} onClick={st.undo} />
      <IconButton icon="redo" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={st.redo} />
      <button
        type="button"
        className={`btn small${dirty ? " primary" : ""}`}
        disabled={readOnly || saving || !isDirty(useStudio.getState())}
        onClick={() => st.save()}
        title="Save (⌘S)"
      >
        <Icon name="save" size={13} /> {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

export function SlideRail() {
  return (
    <aside className="rail">
      <SlideList />
      <AuditPanel />
      <div className="rail-format">
        <span className="rail-title">Format</span>
        <FormatSelect />
      </div>
      <Toolbar />
    </aside>
  );
}
