import type { Lighting, Project, TypeRole } from "@xds/protocol";
import { LEVELS, LIGHTING_DEFAULTS, getSlide, useStudio, type Level } from "../../store";
import { fetchFont } from "../commands";
import { ColorTokenSelect, IconButton, NumberField, Row, Section, Select, TextField } from "../ui";
import { LightingControls } from "./LightingControls";

const HEX = /^#[0-9a-fA-F]{6}$/;

function colorUsage(p: Project, name: string): number {
  let n = 0;
  const s = JSON.stringify({ slides: p.slides, typography: p.brand.typography, lighting: p.lighting });
  const re = new RegExp(`"(background|color|tint)":"${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "g");
  n += (s.match(re) ?? []).length;
  return n;
}

export function SlideSection() {
  const project = useStudio((s) => s.project)!;
  const slide = useStudio((s) => getSlide(s.project, s.activeSlideId));
  const readOnly = useStudio((s) => s.readOnly);
  const { editProject, renameSlide } = useStudio.getState();
  if (!slide) return null;
  return (
    <Section title="Slide">
      <Row label="Name">
        <TextField value={slide.name ?? ""} disabled={readOnly} onChange={(v) => renameSlide(slide.id, v)} />
      </Row>
      <Row label="Background">
        <ColorTokenSelect
          project={project}
          value={slide.background}
          disabled={readOnly}
          onChange={(v) =>
            v &&
            editProject((p) => ({
              ...p,
              slides: p.slides.map((s) => (s.id === slide.id ? { ...s, background: v } : s)) as Project["slides"],
            }))
          }
        />
      </Row>
    </Section>
  );
}

export function BrandInspector() {
  const project = useStudio((s) => s.project)!;
  const guide = useStudio((s) => s.guide);
  const readOnly = useStudio((s) => s.readOnly);
  const { editProject, notify, ask } = useStudio.getState();
  const brand = project.brand;
  const roles = brand.typography ?? {};
  const families = [...new Set((project.fonts ?? []).map((f) => f.family))];

  const setColors = (colors: Project["brand"]["colors"]) =>
    editProject((p) => ({ ...p, brand: { ...p.brand, colors } }));
  const setRole = (name: string, role: TypeRole | null) =>
    editProject((p) => {
      const typography = { ...(p.brand.typography ?? {}) };
      if (role) typography[name] = role;
      else delete typography[name];
      return { ...p, brand: { ...p.brand, typography } };
    });
  const patchRole = (name: string, patch: Partial<TypeRole>) => {
    const next = { ...roles[name], ...patch } as TypeRole;
    for (const k of Object.keys(patch) as (keyof TypeRole)[]) if (patch[k] === undefined) delete next[k];
    setRole(name, next);
  };

  const addColor = async () => {
    const name = await ask({ title: "Add color", label: "Token name (e.g. ink, accent)", confirm: "Add" });
    if (!name?.trim()) return;
    if (brand.colors.some((c) => c.name === name.trim())) return notify("warning", `A color named “${name}” exists.`);
    setColors([...brand.colors, { name: name.trim(), hex: "#888888" }]);
  };
  const addRole = async () => {
    if (!families.length)
      return notify("warning", "A type role needs a font. Fetch one from Fontshare (the download button on Typography) or add files under fonts/ first.");
    const name = await ask({ title: "Add type role", label: "Role name (e.g. headline, kicker, price)", confirm: "Add" });
    if (!name?.trim()) return;
    if (roles[name.trim()]) return notify("warning", `A role named “${name}” exists.`);
    setRole(name.trim(), { level: "headline", font: families[0] ?? "" });
  };

  const usedRoles = new Set(project.slides.flatMap((s) => (s.nodes ?? []).flatMap((n) => (n.layer === "type" ? [n.data.role] : []))));
  const lighting: typeof LIGHTING_DEFAULTS = { ...LIGHTING_DEFAULTS, ...(project.lighting ?? {}) };

  return (
    <div className="inspector-body">
      <SlideSection />
      <Section
        title="Colors"
        actions={<IconButton icon="plus" title="Add color" size={12} disabled={readOnly} onClick={addColor} />}
      >
        <ul className="color-list">
          {brand.colors.map((c, i) => (
            <li key={c.name} className="color-row">
              <label className="swatch big" style={{ background: c.hex }}>
                <input
                  type="color"
                  value={HEX.test(c.hex) ? c.hex.toLowerCase() : "#000000"}
                  disabled={readOnly}
                  onChange={(e) => {
                    const colors = [...brand.colors] as Project["brand"]["colors"];
                    colors[i] = { ...c, hex: e.target.value.toUpperCase() };
                    setColors(colors);
                  }}
                />
              </label>
              <span className="color-name">{c.name}</span>
              <TextField
                value={c.hex}
                disabled={readOnly}
                onChange={(v) => {
                  const hex = v.startsWith("#") ? v : `#${v}`;
                  if (!HEX.test(hex)) return notify("warning", "Colors are #rrggbb.");
                  const colors = [...brand.colors] as Project["brand"]["colors"];
                  colors[i] = { ...c, hex: hex.toUpperCase() };
                  setColors(colors);
                }}
              />
              <IconButton
                icon="trash"
                title="Delete color"
                size={12}
                disabled={readOnly || brand.colors.length <= 1}
                onClick={() => {
                  const used = colorUsage(project, c.name);
                  if (used) return notify("warning", `“${c.name}” is used ${used} time(s); change those first.`);
                  setColors(brand.colors.filter((x) => x.name !== c.name) as Project["brand"]["colors"]);
                }}
              />
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Typography"
        actions={
          <>
            <IconButton icon="download" title="Fetch a font from Fontshare…" size={12} disabled={readOnly} onClick={() => fetchFont()} />
            <IconButton icon="plus" title="Add type role" size={12} disabled={readOnly} onClick={addRole} />
          </>
        }
      >
        {!Object.keys(roles).length && <div className="muted small">No roles yet. Add one, pick its level, and new text uses it.</div>}
        {Object.entries(roles).map(([name, role]) => {
          const band = guide?.bands?.[role.level as Level];
          return (
            <div key={name} className="role-card">
              <div className="role-head">
                <span className="role-name">{name}</span>
                <IconButton
                  icon="trash"
                  title="Delete role"
                  size={12}
                  disabled={readOnly}
                  onClick={() =>
                    usedRoles.has(name) ? notify("warning", `Role “${name}” is used by text on a slide.`) : setRole(name, null)
                  }
                />
              </div>
              <Row label="Font">
                <Select
                  value={role.font}
                  options={families.includes(role.font) || !role.font ? families : [...families, role.font]}
                  disabled={readOnly}
                  placeholder={families.length ? undefined : "No fonts"}
                  onChange={(v) => v && patchRole(name, { font: v })}
                />
              </Row>
              <Row label="Size range">
                <Select
                  value={role.level}
                  options={LEVELS.map((l) => {
                    const b = guide?.bands?.[l];
                    return { value: l, label: b ? `${l} · ${b.min}–${b.max} px` : l };
                  })}
                  disabled={readOnly}
                  onChange={(v) => v && patchRole(name, { level: v })}
                />
              </Row>
              <div className="field-grid">
                <NumberField label="Weight" value={role.weight} placeholder={400} step={100} min={100} max={900} disabled={readOnly} onChange={(weight) => patchRole(name, { weight })} />
                <NumberField
                  label="Size"
                  value={role.size}
                  placeholder={band?.default}
                  range={band ? [band.min, band.max] : undefined}
                  rangeLabel={false}
                  min={1}
                  unit="px"
                  disabled={readOnly}
                  onChange={(size) => patchRole(name, { size })}
                />
              </div>
              <Row label="Color">
                <ColorTokenSelect project={project} value={role.color} allowNone noneLabel="Auto" disabled={readOnly} onChange={(color) => patchRole(name, { color })} />
              </Row>
            </div>
          );
        })}
      </Section>

      <Section title="Default lighting">
        <LightingControls
          project={project}
          value={lighting}
          overridden={project.lighting}
          disabled={readOnly}
          onPatch={(patch, remove = []) =>
            editProject((p) => {
              const l = { ...(p.lighting ?? {}), ...patch } as Record<string, unknown>;
              for (const k of remove) delete l[k];
              return { ...p, lighting: l as Lighting };
            })
          }
        />
      </Section>
    </div>
  );
}
