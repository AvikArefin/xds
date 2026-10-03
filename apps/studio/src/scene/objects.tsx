/**
 * Render nodes as Three.js objects: glTF models (drei useGLTF with local Draco + Meshopt decoders),
 * cloned per render node with pose, `parts`, `animation` and `screens` applied; and primitive
 * shapes with project materials. Every root gets `userData.objectId` and `userData.nodeId`.
 */
import { Component, Suspense, useContext, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import {
  AnimationMixer,
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Euler,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PropertyBinding,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  type Group,
  type Material,
  type Mesh,
  type Object3D,
  type Texture,
} from "three";
import { useGLTF, useTexture } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import type { Project, RenderNode, SceneObject } from "@xds/protocol";
import { eulerDegToRad, resolvePose } from "@xds/editor-core";
import { fileUrl, screenUrl } from "../api";
import { Pending, ReadinessContext } from "../stage/readiness";
import { SceneRegistryContext } from "./registry";

export const DRACO_PATH = "/draco/";

/** Find a glTF node by its file name (GLTFLoader sanitizes names) or its three name. */
export function findPart(root: Object3D, name: string): Object3D | undefined {
  return root.getObjectByName(PropertyBinding.sanitizeNodeName(name)) ?? root.getObjectByName(name);
}

export function meshesUnder(o: Object3D): Mesh[] {
  const out: Mesh[] = [];
  o.traverse((c) => {
    if ((c as Mesh).isMesh) out.push(c as Mesh);
  });
  return out;
}

class ErrorBoundary extends Component<{ id: string; label: string; children: ReactNode }, { error: string | null }> {
  static contextType = ReadinessContext;
  declare context: React.ContextType<typeof ReadinessContext>;
  state = { error: null as string | null };
  static getDerivedStateFromError(e: Error) {
    return { error: e?.message ?? String(e) };
  }
  componentDidCatch(e: Error) {
    this.context?.fail(`object:${this.props.id}`, `${this.props.label}: ${e?.message ?? e}`);
  }
  componentWillUnmount() {
    this.context?.clearError(`object:${this.props.id}`);
  }
  render() {
    return this.state.error ? null : this.props.children;
  }
}

interface NodeProps {
  node: RenderNode;
  object: SceneObject;
  project: Project;
  hash?: string;
}

/** The posed root group, registered in the scene registry. */
function PosedRoot({ node, object, children }: { node: RenderNode; object: SceneObject; children: ReactNode }) {
  const ref = useRef<Group>(null);
  const registry = useContext(SceneRegistryContext);
  const pose = resolvePose(object.pose, node.data.pose);
  const rot = eulerDegToRad(pose.rotation);
  const scale = pose.scale.map((s) => (s === 0 ? 1e-6 : s)) as [number, number, number];
  useLayoutEffect(() => {
    const g = ref.current!;
    registry?.register(node.id, g);
    return () => registry?.unregister(node.id, g);
  }, [registry, node.id]);
  useLayoutEffect(() => {
    registry?.bump();
  });
  return (
    <group
      ref={ref}
      name={`xds:${node.id}`}
      userData={{ objectId: object.id, nodeId: node.id }}
      position={pose.position}
      rotation={new Euler(rot[0], rot[1], rot[2], "XYZ")}
      scale={scale}
    >
      {children}
    </group>
  );
}

function ScreenTexture({ root, mesh, url, onMissing }: { root: Object3D; mesh: string; url: string; onMissing: (m: string) => void }) {
  const tex = useTexture(url) as Texture;
  useLayoutEffect(() => {
    const target = findPart(root, mesh);
    if (!target) {
      onMissing(mesh);
      return;
    }
    tex.flipY = false; // glTF UV convention
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    const mat = new MeshBasicMaterial({ map: tex, toneMapped: false });
    const meshes = meshesUnder(target);
    const before = meshes.map((m) => m.material);
    for (const m of meshes) {
      m.material = mat;
      m.userData.xdsScreen = true;
    }
    return () => {
      meshes.forEach((m, i) => {
        m.material = before[i];
        delete m.userData.xdsScreen;
      });
      mat.dispose();
    };
  }, [root, mesh, tex, onMissing]);
  return null;
}

function Model({ node, object, project, hash }: NodeProps) {
  const asset = project.assets?.find((a) => a.id === object.asset);
  if (!asset) throw new Error(`object '${object.id}' names unknown asset '${object.asset}'`);
  const gltf = useGLTF(fileUrl(asset.path), DRACO_PATH, true);
  const scene = useMemo(() => {
    const s = SkeletonUtils.clone(gltf.scene) as Object3D;
    // The studio environment is the only light: drop KHR_lights_punctual lights and cameras.
    const strip: Object3D[] = [];
    s.traverse((o) => {
      if ((o as { isLight?: boolean }).isLight || (o as { isCamera?: boolean }).isCamera) strip.push(o);
    });
    for (const o of strip) o.removeFromParent();
    s.traverse((o) => {
      if ((o as Mesh).isMesh) {
        (o as Mesh).castShadow = true;
        (o as Mesh).receiveShadow = false;
      }
    });
    return s;
  }, [gltf]);
  // rest transforms of every node of the clone, to re-apply parts/animation from scratch
  const rest = useMemo(() => {
    const m = new Map<Object3D, { p: [number, number, number]; r: [number, number, number]; s: [number, number, number]; v: boolean }>();
    scene.traverse((o) =>
      m.set(o, {
        p: [o.position.x, o.position.y, o.position.z],
        r: [o.rotation.x, o.rotation.y, o.rotation.z],
        s: [o.scale.x, o.scale.y, o.scale.z],
        v: o.visible,
      }),
    );
    return m;
  }, [scene]);
  const mixer = useMemo(() => new AnimationMixer(scene), [scene]);
  const partsKey = JSON.stringify(node.data.parts ?? {});
  const animKey = JSON.stringify(node.data.animation ?? null);
  useLayoutEffect(() => {
    for (const [o, t] of rest) {
      o.position.set(...t.p);
      o.rotation.set(t.r[0], t.r[1], t.r[2]);
      o.scale.set(...t.s);
      o.visible = t.v;
    }
    mixer.stopAllAction();
    const anim = node.data.animation;
    if (anim) {
      const clip = gltf.animations.find((c) => c.name === anim.clip);
      if (!clip) console.warn(`xds: model '${object.id}' has no clip '${anim.clip}'`);
      else {
        mixer.clipAction(clip).play();
        mixer.setTime(anim.time);
      }
    }
    for (const [name, part] of Object.entries(node.data.parts ?? {})) {
      const o = findPart(scene, name);
      if (!o) {
        console.warn(`xds: model '${object.id}' has no part '${name}'`);
        continue;
      }
      if (part.rotate) {
        const [x, y, z] = part.rotate.map((v) => (Number(v) * Math.PI) / 180);
        o.rotation.set(o.rotation.x + x, o.rotation.y + y, o.rotation.z + z);
      }
      if (part.move) {
        const [x, y, z] = part.move.map(Number);
        o.position.set(o.position.x + x, o.position.y + y, o.position.z + z);
      }
      if (part.hidden) o.visible = false;
    }
    scene.updateMatrixWorld(true);
  }, [scene, rest, mixer, gltf, partsKey, animKey, object.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const screens = Object.entries(node.data.screens ?? {});
  const onMissing = useMemo(() => (m: string) => console.warn(`xds: model '${object.id}' has no screen mesh '${m}'`), [object.id]);
  return (
    <>
      <primitive object={scene} />
      {hash !== undefined &&
        screens.map(([mesh, screenId]) => (
          <Suspense key={mesh} fallback={<Pending k={`screen:${node.id}:${mesh}`} label={`screen: ${screenId}`} />}>
            <ScreenTexture root={scene} mesh={mesh} url={screenUrl(screenId, hash)} onMissing={onMissing} />
          </Suspense>
        ))}
    </>
  );
}

function primitiveGeometry(object: SceneObject): BufferGeometry {
  const p = object.params ?? {};
  const n = (k: string, d: number) => (typeof p[k] === "number" && p[k] > 0 ? p[k] : d);
  let g: BufferGeometry;
  switch (object.kind) {
    case "box":
      g = new BoxGeometry(n("width", 1), n("height", 1), n("depth", 1));
      break;
    case "sphere":
      g = new SphereGeometry(n("radius", 0.5), 64, 32);
      break;
    case "cylinder": {
      const r = n("radius", 0.5);
      g = new CylinderGeometry(n("radiusTop", r), n("radiusBottom", r), n("height", 1), Math.round(n("radialSegments", 96)));
      break;
    }
    case "torus":
      g = new TorusGeometry(n("radius", 0.4), n("tube", 0.1), 48, 128);
      break;
    case "plane":
    default:
      g = new PlaneGeometry(n("width", 1), n("height", 1));
      break;
  }
  // Same convention as models: origin at the bottom center, so y = 0 stands on the floor.
  g.computeBoundingBox();
  g.translate(0, -g.boundingBox!.min.y, 0);
  g.computeBoundingBox();
  return g;
}

function Primitive({ object, project }: NodeProps) {
  const paramsKey = JSON.stringify(object.params ?? {});
  const geometry = useMemo(() => primitiveGeometry(object), [object.kind, paramsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const def = project.materials?.find((m) => m.id === object.material);
  const material = useMemo<Material>(
    () =>
      new MeshStandardMaterial({
        color: def?.color ?? "#c8c8c8",
        metalness: def?.metalness ?? 0,
        roughness: def?.roughness ?? 0.5,
        side: object.kind === "plane" ? 2 : 0,
      }),
    [def?.color, def?.metalness, def?.roughness, object.kind],
  );
  useLayoutEffect(() => () => geometry.dispose(), [geometry]);
  useLayoutEffect(() => () => material.dispose(), [material]);
  return <mesh geometry={geometry} material={material} castShadow name={object.id} />;
}

/** One render node: error boundary + suspense (pending "model: <id>") + posed root. */
export function RenderObject({ node, project, hash }: { node: RenderNode; project: Project; hash?: string }) {
  const object = project.objects?.find((o) => o.id === node.data.object);
  const label = `model: ${node.data.object}`;
  if (!object) return <MissingObject node={node} />;
  return (
    <ErrorBoundary id={node.id} label={label}>
      <Suspense fallback={<Pending k={`model:${node.id}`} label={label} />}>
        <PosedRoot node={node} object={object}>
          {object.kind === "model" ? (
            <Model node={node} object={object} project={project} hash={hash} />
          ) : (
            <Primitive node={node} object={object} project={project} hash={hash} />
          )}
        </PosedRoot>
      </Suspense>
    </ErrorBoundary>
  );
}

function MissingObject({ node }: { node: RenderNode }) {
  const r = useContext(ReadinessContext);
  useLayoutEffect(() => {
    r?.fail(`object:${node.id}`, `render node '${node.id}': unknown object '${node.data.object}'`);
    return () => r?.clearError(`object:${node.id}`);
  }, [r, node.id, node.data.object]);
  return null;
}
