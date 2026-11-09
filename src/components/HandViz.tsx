import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';
import type { FingerContact, FingerId } from '../grip/types';
import type { Hand } from '../physics/simulate';
import { buildHandPose, type FingerPose, type HandPoseMode } from '../grip/handModel';
import { buildSkinField } from '../grip/handSkin';

export type HandStyle = 'off' | 'ghost' | 'solid';

const RES = 128;
const RES_PREVIEW = 76;
const noRaycast = () => null;

function Nail({ f, mat }: { f: FingerPose; mat: THREE.Material }) {
  const along = new THREE.Vector3(...f.nail.along), out = new THREE.Vector3(...f.nail.out);
  const lat = new THREE.Vector3().crossVectors(along, out).normalize();
  const y = along.clone().normalize();
  const z = new THREE.Vector3().crossVectors(lat, y).normalize();
  if (z.dot(out) < 0) { lat.negate(); z.negate(); }
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(lat, y, z));
  // seat the nail slightly into the skin so it reads as part of the finger
  const pos = new THREE.Vector3(...f.nail.center).add(out.clone().multiplyScalar(-f.radius * 0.2)).add(along.clone().multiplyScalar(f.radius * 0.1));
  return (
    <mesh position={pos} quaternion={q} scale={[f.radius * 0.68, f.radius * 0.86, f.radius * 0.12]} material={mat} raycast={noRaycast}>
      <sphereGeometry args={[1, 24, 16]} />
    </mesh>
  );
}

/** Anatomical hand as one continuous skin surface (display only; see grip/handModel.ts and grip/handSkin.ts). */
export function HandViz({ fingers, hand, size, style, mode = 'hold' }: { fingers: Record<FingerId, FingerContact>; hand: Hand; size: number; style: HandStyle; mode?: HandPoseMode }) {
  const pose = useMemo(() => buildHandPose(fingers, hand, size, mode), [fingers, hand, size, mode]);
  const solid = style === 'solid';
  const { skin, nail } = useMemo(() => {
    const ghost = { transparent: !solid, opacity: solid ? 1 : 0.45, depthWrite: solid };
    return {
      // vertex colours carry the skin tones (knuckles, pads, palm); sheen fakes the soft scattering of skin
      skin: new THREE.MeshPhysicalMaterial({
        vertexColors: true, roughness: 0.55, metalness: 0, sheen: 0.55, sheenRoughness: 0.45, sheenColor: new THREE.Color('#ffb8a0'),
        clearcoat: 0.08, clearcoatRoughness: 0.6, ...ghost,
      }),
      nail: new THREE.MeshPhysicalMaterial({ color: '#e6b8a8', roughness: 0.35, clearcoat: 0.35, clearcoatRoughness: 0.4, ...ghost, opacity: solid ? 1 : 0.6 }),
    };
  }, [solid]);

  // Two resolutions: a fast preview mesh follows finger drags, the full-quality mesh is built once edits pause.
  const meshes = useMemo(() => {
    const make = (res: number, polys: number) => {
      const m = new MarchingCubes(res, skin, false, true, polys);
      m.isolation = 0;
      m.raycast = noRaycast;
      return m;
    };
    return { lo: make(RES_PREVIEW, 90000), hi: make(RES, 240000) };
  }, [skin]);
  useEffect(() => () => { meshes.lo.geometry.dispose(); meshes.hi.geometry.dispose(); }, [meshes]);
  const [showHi, setShowHi] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    const build = (m: MarchingCubes, res: number) => {
      const sf = buildSkinField(pose, res, m.field, m.palette);
      (m as unknown as { normal_cache: Float32Array }).normal_cache.fill(0);
      m.position.set(sf.center[0], sf.center[1], sf.center[2]);
      m.scale.setScalar(sf.half);
      m.update();
    };
    if (first.current) {
      // first paint goes straight to full quality
      first.current = false;
      build(meshes.hi, RES);
      setShowHi(true);
      return;
    }
    build(meshes.lo, RES_PREVIEW);
    setShowHi(false);
    const id = window.setTimeout(() => { build(meshes.hi, RES); setShowHi(true); }, 220);
    return () => window.clearTimeout(id);
  }, [pose, meshes]);

  if (style === 'off') return null;
  return (
    <group>
      <primitive object={showHi ? meshes.hi : meshes.lo} />
      {pose.fingers.map((f) => <Nail key={f.id} f={f} mat={nail} />)}
    </group>
  );
}
