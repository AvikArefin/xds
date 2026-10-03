import { useEffect, useState } from "react";
import { api } from "../api";
import type { FormatProfile } from "../types";
import { useStudio } from "../store";
import { NumberField } from "./ui";

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
      <select
        className="select"
        value={value}
        disabled={readOnly}
        onChange={(e) => {
          if (e.target.value === "__custom") {
            setCustom(true);
            return;
          }
          const p = catalog.find((c) => c.key === e.target.value);
          if (p) {
            setCustom(false);
            setFormat({ preset: p.key, width: p.width, height: p.height });
          }
        }}
      >
        {GROUPS.map((g) => (
          <optgroup key={g} label={g}>
            {catalog
              .filter((p) => p.group === g)
              .map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label} · {p.width}×{p.height}
                </option>
              ))}
          </optgroup>
        ))}
        <optgroup label="Custom">
          <option value="__custom">Custom…{isCustom ? ` · ${format.width}×${format.height}` : ""}</option>
        </optgroup>
      </select>
      {isCustom && (
        <div className="format-custom">
          <NumberField
            label="W"
            value={format.width}
            min={16}
            max={20000}
            disabled={readOnly}
            onChange={(v) => v && setFormat({ width: Math.round(v), height: format.height })}
          />
          <NumberField
            label="H"
            value={format.height}
            min={16}
            max={20000}
            disabled={readOnly}
            onChange={(v) => v && setFormat({ width: format.width, height: Math.round(v) })}
          />
        </div>
      )}
    </div>
  );
}
