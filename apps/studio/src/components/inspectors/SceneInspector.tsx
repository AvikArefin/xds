import type { FreeCamera, Pose, RenderNode, Vec3 } from "@xds/protocol";
import { PLACE_DEFAULTS, renderNodePose, resolvePlace } from "@xds/editor-core";
import { fileUrl } from "../../api";
import { FRAME_DEFAULTS, effectiveCamera, effectiveLighting, getSlide, useStudio } from "../../store";
import { Icon } from "../Icon";
import { Checkbox, MIXED, NumberField, Row, Section, Segmented, shared } from "../ui";
import { LightingControls } from "./LightingControls";

const AXES = ["x", "y", "z"] as const;

function PoseFields({ nodes }: { nodes: RenderNode[] }) {
  const project = useStudio((s) => s.project)!;
  const readOnly = useStudio((s) => s.readOnly);
  const commitPoses = useStudio((s) => s.commitPoses);
  const poses = nodes.map((n) => ({ id: n.id, pose: renderNodePose(project, n) }));

  const set = (key: keyof Pose, axis: number, v: number | undefined) => {
    if (v === undefined) return;
    if (key === "scale" && v === 0) return;
    const out: Record<string, Pose> = {};
    for (const p of poses) {
      const vec = [...p.pose[key]] as Vec3;
      vec[axis] = v;
      out[p.id] = { [key]: vec };
    }
    commitPoses(out);
  };
  const row = (key: keyof Pose, label: string, step: number, unit: string) => (
    <Row label={label}>
      <div className="vec3">
        {AXES.map((a, i) => (
          <NumberField
            key={a}
            label={a.toUpperCase()}
            value={shared(poses, (p) => Math.round(p.pose[key][i] * 10000) / 10000) as number | typeof MIXED}
            step={step}
            unit={unit}
            disabled={readOnly}
            onChange={(v) => set(key, i, v)}
          />
        ))}
      </div>
    </Row>
  );
  return (
    <Section title={nodes.length > 1 ? `Pose · ${nodes.length} objects` : "Pose (this slide)"}>
      {row("position", "Position", 0.01, "m")}
      {row("rotation", "Rotation", 1, "°")}
      {row("scale", "Scale", 0.01, "")}
    </Section>
  );
}

/** `data.place`: put this object on the canvas by percentage; the camera still sets the view. */
function PlaceFields({ node }: { node: RenderNode }) {
  const readOnly = useStudio((s) => s.readOnly);
  const patchData = useStudio((s) => s.patchData);
  const place = node.data.place ? resolvePlace(node.data.place) : null;
  const set = (k: "x" | "y" | "height", v: number | undefined) =>
    v !== undefined && place && patchData([node.id], { place: { ...place, [k]: v } });
  return (
    <Section title="Place on canvas">
      <Checkbox
        label="Place this object by canvas %"
        checked={!!place}
        disabled={readOnly}
        onChange={(on) => patchData([node.id], { place: on ? { ...PLACE_DEFAULTS } : undefined })}
      />
      {place && (
        <>
          <div className="field-grid">
            <NumberField label="X" value={place.x} step={0.5} unit="%" disabled={readOnly} onChange={(v) => set("x", v)} />
            <NumberField label="Y" value={place.y} step={0.5} unit="%" disabled={readOnly} onChange={(v) => set("y", v)} />
            <NumberField label="Height" value={place.height} step={0.5} min={1} max={200} unit="%" disabled={readOnly} onChange={(v) => set("height", v)} />
          </div>
          <div className="muted small">Position and scale follow the place; rotation still applies.</div>
        </>
      )}
    </Section>
  );
}

function Articulation({ node }: { node: RenderNode }) {
  const project = useStudio((s) => s.project)!;
  const { parts, animation, screens } = node.data;
  if (!parts && !animation && !screens) return null;
  const fmtVec = (v?: unknown[]) => (v ? v.map((x) => Math.round(Number(x) * 100) / 100).join(", ") : "");
  return (
    <Section title="Set in the file (read-only)">
      <ul className="readonly-list">
        {Object.entries(parts ?? {}).map(([name, p]) => (
          <li key={name}>
            <span className="ro-key">{name}</span>
            <span className="muted">
              {p.hidden ? "hidden " : ""}
              {p.rotate ? `rotated ${fmtVec(p.rotate)}° ` : ""}
              {p.move ? `moved ${fmtVec(p.move)} m` : ""}
            </span>
          </li>
        ))}
        {animation && (
          <li>
            <span className="ro-key">Animation</span>
            <span className="muted">
              {animation.clip} @ {animation.time}s
            </span>
          </li>
        )}
        {Object.entries(screens ?? {}).map(([mesh, id]) => {
          const scr = project.screens?.find((s) => s.id === id);
          return (
            <li key={mesh}>
              <span className="ro-key">Screen ({mesh})</span>
              <span className="muted">{id}</span>
              {scr && (
                <a className="link-btn" href={fileUrl(scr.path)} target="_blank" rel="noreferrer">
                  Open screen file <Icon name="external" size={11} />
                </a>
              )}
            </li>
          );
        })}
      </ul>
      <div className="muted small">Articulation and screens are edited in project.json by an agent; saving keeps them.</div>
    </Section>
  );
}

export function CameraSection() {
  const slide = useStudio((s) => getSlide(s.project, s.activeSlideId));
  const readOnly = useStudio((s) => s.readOnly);
  const { patchCamera, setCamera } = useStudio.getState();
  const cam = effectiveCamera(slide);
  const set = (k: keyof typeof FRAME_DEFAULTS, v: number | undefined) => {
    if (v === undefined) {
      const c = { ...((slide?.camera as Record<string, unknown>) ?? {}) };
      delete c[k];
      setCamera(Object.keys(c).filter((x) => x !== "mode").length ? (c as never) : null);
    } else patchCamera({ [k]: v });
  };
  const frame = slide?.camera && slide.camera.mode !== "free" ? (slide.camera as Record<string, number | undefined>) : {};
  return (
    <Section
      title="Camera"
      actions={
        slide?.camera ? (
          <button type="button" className="link-btn" disabled={readOnly} onClick={() => setCamera(null)}>
            Auto
          </button>
        ) : (
          <span className="muted small">auto</span>
        )
      }
    >
      <Row label="Mode">
        <Segmented
          value={cam.mode}
          disabled={readOnly}
          options={[
            { value: "frame", label: "Frame", title: "Place the subject; the camera follows" },
            { value: "free", label: "Free", title: "Position and target in meters" },
          ]}
          onChange={(m) => {
            if (m === cam.mode) return;
            if (m === "free") {
              const fc: FreeCamera = { mode: "free", position: [0.8, 0.5, 1.6], target: [0, 0.15, 0], fov: cam.mode === "frame" ? cam.fov : 30 };
              setCamera(fc);
            } else setCamera(null);
          }}
        />
      </Row>
      {cam.mode === "frame" ? (
        <div className="field-grid">
          <NumberField label="X" value={frame.x} placeholder={FRAME_DEFAULTS.x} unit="%" step={0.5} disabled={readOnly} onChange={(v) => set("x", v)} />
          <NumberField label="Y" value={frame.y} placeholder={FRAME_DEFAULTS.y} unit="%" step={0.5} disabled={readOnly} onChange={(v) => set("y", v)} />
          <NumberField
            label="Height"
            value={frame.height}
            placeholder={FRAME_DEFAULTS.height}
            unit="%"
            step={0.5}
            min={1}
            range={[30, 75]}
            disabled={readOnly}
            onChange={(v) => set("height", v)}
          />
          <NumberField label="FOV" value={frame.fov} placeholder={FRAME_DEFAULTS.fov} unit="°" min={5} max={120} disabled={readOnly} onChange={(v) => set("fov", v)} />
          <NumberField label="Yaw" value={frame.yaw} placeholder={FRAME_DEFAULTS.yaw} unit="°" disabled={readOnly} onChange={(v) => set("yaw", v)} />
          <NumberField label="Pitch" value={frame.pitch} placeholder={FRAME_DEFAULTS.pitch} unit="°" min={-89} max={89} disabled={readOnly} onChange={(v) => set("pitch", v)} />
        </div>
      ) : (
        <>
          {(["position", "target"] as const).map((k) => (
            <Row key={k} label={k === "position" ? "Position" : "Target"}>
              <div className="vec3">
                {AXES.map((a, i) => (
                  <NumberField
                    key={a}
                    label={a.toUpperCase()}
                    value={cam[k][i]}
                    step={0.01}
                    disabled={readOnly}
                    onChange={(v) => {
                      if (v === undefined) return;
                      const vec = [...cam[k]] as Vec3;
                      vec[i] = v;
                      setCamera({ ...cam, [k]: vec });
                    }}
                  />
                ))}
              </div>
            </Row>
          ))}
          <NumberField label="FOV" value={cam.fov} unit="°" min={5} max={120} disabled={readOnly} onChange={(v) => v && setCamera({ ...cam, fov: v })} />
        </>
      )}
    </Section>
  );
}

export function SceneInspector({ nodes }: { nodes: RenderNode[] }) {
  const project = useStudio((s) => s.project)!;
  const slide = useStudio((s) => getSlide(s.project, s.activeSlideId));
  const readOnly = useStudio((s) => s.readOnly);
  const { patchLighting, useLightingForAll } = useStudio.getState();
  const obj = nodes.length === 1 ? project.objects?.find((o) => o.id === nodes[0].data.object) : undefined;
  return (
    <div className="inspector-body">
      {nodes.length > 0 ? (
        <>
          {obj && (
            <div className="inspector-title">
              {obj.name} <span className="muted small">{obj.kind}</span>
            </div>
          )}
          <PoseFields nodes={nodes} />
          {nodes.length === 1 && <PlaceFields node={nodes[0]} />}
          {nodes.length === 1 && <Articulation node={nodes[0]} />}
        </>
      ) : (
        <div className="muted small pad">Click an object in the viewport or the list to edit its pose.</div>
      )}
      <CameraSection />
      <Section
        title="Lighting"
        actions={
          slide?.lighting ? (
            <button type="button" className="link-btn" disabled={readOnly} onClick={() => patchLighting({}, Object.keys(slide.lighting!) as never)}>
              Use project default
            </button>
          ) : (
            <span className="muted small">project default</span>
          )
        }
      >
        <LightingControls
          project={project}
          value={effectiveLighting(project, slide)}
          overridden={slide?.lighting}
          disabled={readOnly}
          onPatch={patchLighting}
        />
        <div className="hint-row">
          <span className="muted small">Hold L and drag in the viewport to swing the light.</span>
          <button type="button" className="btn small" disabled={readOnly} onClick={() => useLightingForAll()}>
            Use for all slides
          </button>
        </div>
      </Section>
    </div>
  );
}
