/**
 * The studio rig (lighting-and-backgrounds §1.2): image-based light from a procedural
 * environment of Lightformer softboxes on a mid-gray backdrop. There are no direct lights:
 * the environment is the only light source, so its energy can't stack up.
 */
import { memo, useEffect, useMemo, useRef } from "react";
import { BackSide, Color } from "three";
import { useFrame } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import { LOOKS, softboxPosition, type ResolvedLighting } from "./looks";

const WHITE = new Color(1, 1, 1);

export interface StudioRigProps {
  lighting: ResolvedLighting;
  /** Resolved hex of `lighting.tint` (a brand token), or null. */
  tintHex: string | null;
  onReady?: () => void;
}

/** Calls `onReady` after `frames` rendered frames following each change of `dep`. */
function AfterFrames({ dep, frames = 2, onReady }: { dep: string; frames?: number; onReady?: () => void }) {
  const count = useRef(0);
  const fired = useRef(false);
  useEffect(() => {
    count.current = 0;
    fired.current = false;
  }, [dep]);
  useFrame(() => {
    if (fired.current) return;
    if (++count.current >= frames) {
      fired.current = true;
      onReady?.();
    }
  });
  return null;
}

export const StudioRig = memo(function StudioRig({ lighting, tintHex, onReady }: StudioRigProps) {
  const look = LOOKS[lighting.look];
  const { backdrop, fill } = useMemo(() => {
    const backdrop = new Color().setRGB(look.backdrop, look.backdrop, look.backdrop, "srgb");
    const fill = WHITE.clone();
    if (tintHex) {
      const tint = new Color(tintHex);
      backdrop.lerp(tint.clone().multiplyScalar(look.backdrop * 1.6), 0.35);
      fill.lerp(tint, 0.45);
    }
    return { backdrop, fill };
  }, [look, tintHex]);

  const sig = `${lighting.look}|${lighting.angle}|${lighting.elevation}|${tintHex}`;
  return (
    <>
      <Environment resolution={256} frames={1}>
        <mesh scale={50}>
          <sphereGeometry args={[1, 32, 16]} />
          <meshBasicMaterial color={backdrop} side={BackSide} toneMapped={false} />
        </mesh>
        {look.lights.map((l, i) => (
          <Lightformer
            key={i}
            form={l.form ?? "rect"}
            intensity={l.intensity}
            color={l.role === "fill" ? fill : WHITE}
            position={softboxPosition(l, lighting.angle, lighting.elevation)}
            scale={[l.w, l.h, 1]}
            target={[0, 0, 0]}
          />
        ))}
      </Environment>
      <AfterFrames dep={sig} onReady={onReady} />
    </>
  );
});
