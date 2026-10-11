import { useEffect, useState } from "react";
import { api } from "../api";
import type { FormatProfile } from "../types";
import { useStudio } from "../store";
import type { Format } from "@xds/protocol";
import { NumberField, Select, type SelectOption } from "./ui";

const GROUPS = ["Social", "Video", "Screen", "Print"];

let catalogCache: FormatProfile[] | null = null;
export function useFormatCatalog(): FormatProfile[] {
  const [catalog, setCatalog] = useState<FormatProfile[]>(catalogCache ?? []);
  useEffect(() => {
    if (catalogCache) return;
    api
      .formats()
      .then((r) => {
        catalogCache = r.catalog;
        setCatalog(r.catalog);
      })
      .catch(() => {});
  }, []);
  return catalog;
}

/** The catalog as grouped select options, Social / Video / Screen / Print. */
export function formatOptions(catalog: FormatProfile[]): SelectOption<string>[] {
  return GROUPS.flatMap((g) =>
    catalog.filter((p) => p.group === g).map((p) => ({ value: p.key, label: `${p.label} · ${p.width}×${p.height}`, group: g })),
  );
}

/**
 * Retarget the open project to `target`: ask, reflow it on the server (boxes relative to the
 * margins, type sizes to the new bands; nothing is written) and commit the result as one edit.
 */
export async function reflowTo(target: Format): Promise<boolean> {
  const st = useStudio.getState();
  const project = st.project;
  if (!project || st.readOnly) return false;
  const label = `${target.preset ?? "custom"} ${target.width}×${target.height}`;
  const r = await st.ask({
    title: `Reflow to ${label}?`,
    message:
      "Boxes are laid out again relative to the new margins (images keep their aspect) and px type sizes are rescaled to the new size bands. Scales, stack gaps, pins and the camera are kept. One undo step; Cancel keeps the current format.",
    input: false,
    confirm: "Reflow",
  });
  if (r === null) return false;
  try {
    const res = await api.reflow(project, target);
    const s = useStudio.getState();
    if (s.project !== project) {
      s.notify("warning", "The project changed while reflowing; nothing was applied. Try again.");
      return false;
    }
    if (!s.editProject(() => res.project)) return false;
    const n = res.report.summary;
    s.notify("success", `Reflowed to ${label}: ${n.boxes} boxes, ${n.sizes + n.roles} sizes changed. Run the audit.`);
    return true;
  } catch (e) {
    useStudio.getState().notify("error", `Reflow failed: ${(e as Error).message}`);
    return false;
  }
}

/** Grouped presets (Social / Video / Screen / Print / Custom) plus a custom size. */
export function FormatSelect() {
  const format = useStudio((s) => s.project?.format);
  const readOnly = useStudio((s) => s.readOnly);
  const catalog = useFormatCatalog();
  const [custom, setCustom] = useState(false);
  if (!format) return null;
  const preset = catalog.find((p) => p.key === format.preset);
  const isCustom = custom || !preset || preset.width !== format.width || preset.height !== format.height;
  const value = isCustom ? "__custom" : format.preset!;

  return (
    <div className="format-select">
      <Select
        value={value}
        disabled={readOnly}
        options={[
          ...formatOptions(catalog),
          { value: "__custom", label: `Custom…${isCustom ? ` · ${format.width}×${format.height}` : ""}`, group: "Custom" },
        ]}
        onChange={(v) => {
          if (v === "__custom") {
            setCustom(true);
            return;
          }
          const p = catalog.find((c) => c.key === v);
          if (p) void reflowTo({ preset: p.key, width: p.width, height: p.height }).then((ok) => ok && setCustom(false));
        }}
      />
      {isCustom && (
        <div className="format-custom">
          <NumberField
            label="W"
            value={format.width}
            min={16}
            max={20000}
            track={false}
            disabled={readOnly}
            onChange={(v) => v && Math.round(v) !== format.width && void reflowTo({ width: Math.round(v), height: format.height })}
          />
          <NumberField
            label="H"
            value={format.height}
            min={16}
            max={20000}
            track={false}
            disabled={readOnly}
            onChange={(v) => v && Math.round(v) !== format.height && void reflowTo({ width: format.width, height: Math.round(v) })}
          />
        </div>
      )}
    </div>
  );
}
