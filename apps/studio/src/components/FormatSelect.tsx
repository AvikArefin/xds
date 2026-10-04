import { useEffect, useState } from "react";
import { api } from "../api";
import type { FormatProfile } from "../types";
import { useStudio } from "../store";
import { NumberField, Select, type SelectOption } from "./ui";

const GROUPS = ["Social", "Video", "Print"];

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

/** The catalog as grouped select options, Social / Video / Print. */
export function formatOptions(catalog: FormatProfile[]): SelectOption<string>[] {
  return GROUPS.flatMap((g) =>
    catalog.filter((p) => p.group === g).map((p) => ({ value: p.key, label: `${p.label} · ${p.width}×${p.height}`, group: g })),
  );
}

/** Grouped presets (Social / Video / Print / Custom) plus a custom size. */
export function FormatSelect() {
  const format = useStudio((s) => s.project?.format);
  const readOnly = useStudio((s) => s.readOnly);
  const setFormat = useStudio((s) => s.setFormat);
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
          if (p) {
            setCustom(false);
            setFormat({ preset: p.key, width: p.width, height: p.height });
          }
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
            onChange={(v) => v && setFormat({ width: Math.round(v), height: format.height })}
          />
          <NumberField
            label="H"
            value={format.height}
            min={16}
            max={20000}
            track={false}
            disabled={readOnly}
            onChange={(v) => v && setFormat({ width: format.width, height: Math.round(v) })}
          />
        </div>
      )}
    </div>
  );
}
