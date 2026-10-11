/**
 * The Variant section (human-interaction §4 "One source, several formats"): whether the selected
 * 2D nodes carry an override for the format's orientation class (data-models §2.5c). While they
 * do, every edit made here goes into that override and the base keeps the other orientations'
 * values.
 */
import type { Node } from "@xds/protocol";
import { hasVariant, orientationOf } from "@xds/editor-core";
import { useStudio } from "../../store";
import { Checkbox, MIXED, Row, Section } from "../ui";

export function VariantInspector({ nodes }: { nodes: Node[] }) {
  const project = useStudio((s) => s.project)!;
  const readOnly = useStudio((s) => s.readOnly);
  const { setVariant } = useStudio.getState();
  const two = nodes.filter((n) => n.layer !== "render");
  if (!two.length) return null;
  const o = orientationOf(project.format);
  const on = two.filter((n) => hasVariant(n, o)).length;
  const others = new Set(two.flatMap((n) => Object.keys(n.variants ?? {}).filter((k) => k !== o)));
  const label = o[0].toUpperCase() + o.slice(1);
  return (
    <Section title="Variant" defaultOpen={on > 0}>
      <Row
        label="Format"
        hint={
          on
            ? `edits here change the ${o} override only; the base keeps the other formats' values`
            : others.size
              ? `overrides for ${[...others].join(", ")}; this format shows the base`
              : "one source for every format: pins and stacks re-resolve, an override tunes one orientation"
        }
      >
        <Checkbox
          checked={on === two.length ? true : on ? MIXED : false}
          disabled={readOnly}
          label={`Override for ${label.toLowerCase()}`}
          onChange={(v) => void setVariant(two.map((n) => n.id), v)}
        />
      </Row>
    </Section>
  );
}
