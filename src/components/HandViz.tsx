import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';
import type { FingerContact, FingerId } from '../grip/types';
import type { Hand } from '../physics/simulate';
import { buildHandPose, type FingerPose } from '../grip/handModel';
import { buildSkinField } from '../grip/handSkin';

export type HandStyle = 'off' | 'ghost' | 'solid';

const RES = 128;
const noRaycast = () => null;

function Nail({ f, mat }: { f: FingerPose; mat: THREE.Material }) {
  const along = new THREE.Vector3(...f.nail.along), out = new THREE.Vector3(...f.nail.out);
  const lat = new THREE.Vector3().crossVectors(along, out).normalize();
  const y = along.clone().normalize();
  const z = new THREE.Vector3().crossVectors(lat, y).normalize();
  if (z.dot(out) < 0) { lat.negate(); z.negate(); }
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(lat, y, z));
  // seat the nail slightly into the skin so it reads as part of the finger
  const pos = new THREE.Vector3(...f.nail.center).add(out.clone().multiplyScalar(-f.radius * 0.12)).add(along.clone().multiplyScalar(f.radius * 0.12));
  return (
    <mesh position={pos} quaternion={q} scale={[f.radius * 0.62, f.radius * 0.82, f.radius * 0.14]} material={mat} raycast={noRaycast}>
      <sphereGeometry args={[1, 24, 16]} />
    </mesh>
  );
}

/** Anatomical hand as one continuous skin surface (display only; see grip/handModel.ts and grip/handSkin.ts). */
export function HandViz({ fingers, hand, size, style }: { fingers: Record<FingerId, FingerContact>; hand: Hand; size: number; style: HandStyle }) {
  const pose = useMemo(() => buildHandPose(fingers, hand, size), [fingers, hand, size]);
  const solid = style === 'solid';
  const { skin, nail } = useMemo(() => {
    const ghost = { transparent: !solid, opacity: solid ? 1 : 0.45, depthWrite: solid };
    return {
      skin: new THREE.MeshPhysicalMaterial({
        color: '#d8a07f', roughness: 0.58, metalness: 0, sheen: 0.7, sheenRoughness: 0.5, sheenColor: new THREE.Color('#ffd3bf'), ...ghost,
      }),
      nail: new THREE.MeshPhysicalMaterial({ color: '#efc8ba', roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.25, ...ghost, opacity: solid ? 1 : 0.6 }),
    };
  }, [solid]);

  const mc = useMemo(() => {
    const m = new MarchingCubes(RES, skin, false, false, 220000);
    m.isolation = 0;
    m.raycast = noRaycast;
    return m;
  }, [skin]);
  useEffect(() => () => { mc.geometry.dispose(); }, [mc]);

  useMemo(() => {
    const sf = buildSkinField(pose, RES, mc.field);
    (mc as unknown as { normal_cache: Float32Array }).normal_cache.fill(0);
    mc.position.set(sf.center[0], sf.center[1], sf.center[2]);
    mc.scale.setScalar(sf.half);
    mc.update();
  }, [pose, mc]);

  if (style === 'off') return null;
  return (
    <group>
      <primitive object={mc} />
      {pose.fingers.map((f) => <Nail key={f.id} f={f} mat={nail} />)}
    </group>
  );
}
