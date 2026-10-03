/**
 * The ground layer: SVG designs resolved with the 3D subject's layout (lighting-and-backgrounds §3).
 * A ground stays pending until the render layer has reported the subject (or that there is none),
 * so a spotlight lands behind the product in the same frame.
 */
import { useMemo } from "react";
import type { GroundNode, Project } from "@xds/protocol";
import { boxToPx } from "@xds/editor-core";
import { fallbackSubject, resolveDesign, type SubjectLayout } from "../design/resolve";
import type { DesignInfo } from "../types";
import { useFailure, usePending } from "./readiness";

interface GroundBoxProps {
  node: GroundNode;
  project: Project;
  designs: Record<string, DesignInfo>;
  /** undefined = not reported yet; null = no 3D subject (fallback). */
  subject: SubjectLayout | null | undefined;
  width: number;
  height: number;
}

function GroundBox({ node, project, designs, subject, width, height }: GroundBoxProps) {
  const b = boxToPx(node.box, { width, height });
  const design = designs[node.data.design];
  const effective = subject ?? fallbackSubject(width, height);
  const local: SubjectLayout = {
    x: effective.x - b.x,
    y: effective.y - b.y,
    w: effective.w,
    h: effective.h,
    cx: effective.cx - b.x,
    cy: effective.cy - b.y,
    floor: effective.floor - b.y,
  };
  const key = JSON.stringify(local);
  const result = useMemo(() => {
    if (!design) return { error: `ground node '${node.id}': unknown design '${node.data.design}'` };
    if (design.error && !design.svg) return { error: `design '${design.id}': ${design.error}` };
    try {
      return {
        markup: resolveDesign({
          svg: design.svg,
          manifest: design.manifest,
          data: node.data,
          brand: project.brand,
          width: Math.max(1, Math.round(b.w * 1000) / 1000),
          height: Math.max(1, Math.round(b.h * 1000) / 1000),
          subject: local,
          idPrefix: `xds-${node.id}-`,
        }),
      };
    } catch (e) {
      return { error: `design '${node.data.design}' (node '${node.id}'): ${(e as Error).message}` };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design, node.data, node.id, project.brand, b.w, b.h, key]);

  usePending(`ground:${node.id}`, `ground: ${node.id}`, subject === undefined);
  useFailure(`ground:${node.id}`, result.error ?? null);

  return (
    <div
      data-node-id={node.id}
      data-layer="ground"
      style={{
        position: "absolute",
        left: b.x,
        top: b.y,
        width: b.w,
        height: b.h,
        transform: b.rotation ? `rotate(${b.rotation}deg)` : undefined,
        opacity: b.opacity,
        overflow: "hidden",
      }}
      dangerouslySetInnerHTML={result.markup ? { __html: result.markup } : undefined}
    />
  );
}

export function GroundLayer(props: Omit<GroundBoxProps, "node"> & { nodes: GroundNode[] }) {
  const { nodes, ...rest } = props;
  return (
    <>
      {nodes.map((n) => (
        <GroundBox key={n.id} node={n} {...rest} />
      ))}
    </>
  );
}
