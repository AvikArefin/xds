/**
 * One grounded shadow under the subject (lighting-and-backgrounds §1.2, §1.5), drawn on a
 * transparent plane so it lands on the 2D ground underneath:
 * - `contact` (default): drei ContactShadows,
 * - `soft`: AccumulativeShadows + RandomizedLight placed from the rig's angle/elevation, so the
 *   shadow falls away from the key,
 * - `none`.
 * The plane sits at the subject's floor (bounds.min.y) and spans 4× the bounding radius (6× for `soft`,
 * whose raking key throws longer shadows); the contact shadow fades over 1× the radius.
 */
import { memo, useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AccumulativeShadows, ContactShadows, RandomizedLight } from "@react-three/drei";
import type { ResolvedLighting } from "./looks";

export interface ShadowBounds {
  center: [number, number, number];
  minY: number;
  radius: number;
}

export interface ShadowsProps {
  kind: ResolvedLighting["shadow"];
  angle: number;
  elevation: number;
  bounds: ShadowBounds;
  /** Changes whenever the subject's shape/pose changes, so the soft shadow re-accumulates. */
  sig: string;
  temporal?: boolean;
  onReady?: () => void;
}

function ReadyAfter({ frames, onReady, dep }: { frames: number; onReady?: () => void; dep: string }) {
  const n = useRef(0);
  const done = useRef(false);
  useEffect(() => {
    n.current = 0;
    done.current = false;
  }, [dep]);
  useFrame(() => {
    if (done.current) return;
    if (++n.current >= frames) {
      done.current = true;
      onReady?.();
    }
  });
  return null;
}

export const Shadows = memo(function Shadows({ kind, angle, elevation, bounds, sig, temporal, onReady }: ShadowsProps) {
  const r = Math.max(bounds.radius, 1e-3);
  const [cx, , cz] = bounds.center;
  const y = bounds.minY + r * 0.002;
  if (kind === "none") return <ReadyAfter frames={1} onReady={onReady} dep={sig} />;
  if (kind === "contact") {
    return (
      <group position={[cx, y, cz]}>
        <ContactShadows scale={4 * r} far={r} blur={2.4} opacity={0.55} resolution={512} color="#000000" frames={Infinity} />
        <ReadyAfter frames={3} onReady={onReady} dep={sig} />
      </group>
    );
  }
  // soft: the light sits along the key's direction, scaled with the subject.
  const az = (angle * Math.PI) / 180;
  const el = (Math.max(10, elevation) * Math.PI) / 180;
  const dist = 4 * r;
  const lightPos: [number, number, number] = [
    Math.sin(az) * Math.cos(el) * dist,
    Math.sin(el) * dist,
    Math.cos(az) * Math.cos(el) * dist,
  ];
  const frames = temporal ? 60 : 50;
  return (
    <group position={[cx, y, cz]}>
      <AccumulativeShadows
        key={sig}
        temporal={!!temporal}
        frames={frames}
        scale={6 * r} // a raking key throws a longer shadow than the 4× contact plane holds
        opacity={0.75}
        alphaTest={0.85}
        color="#000000"
        colorBlend={2}
        resolution={1024}
      >
        <RandomizedLight
          amount={8}
          radius={r * 0.8}
          ambient={0.35}
          intensity={Math.PI}
          position={lightPos}
          size={2.5 * r}
          near={r * 0.05}
          far={10 * r}
          bias={0.0005}
          mapSize={1024}
        />
      </AccumulativeShadows>
      <ReadyAfter frames={temporal ? frames + 2 : 2} onReady={onReady} dep={sig} />
    </group>
  );
});
