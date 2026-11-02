import { useMemo } from 'react';
import * as THREE from 'three';
import { FINGERS, toWorld, type FingerContact, type FingerId } from '../grip/types';
import type { Hand } from '../physics/simulate';

/** Translucent schematic hand: a palm behind the ball and a curved tube per enabled finger ending at its contact.
 *  Purely a spatial aid; it does not feed the estimate. */
export function HandViz({ fingers, hand }: { fingers: Record<FingerId, FingerContact>; hand: Hand }) {
  const { palmPos, palmQuat, tubes } = useMemo(() => {
    const vecs: Partial<Record<FingerId, THREE.Vector3>> = {};
    const sum = new THREE.Vector3();
    for (const id of FINGERS) {
      if (!fingers[id].enabled) continue;
      const v = new THREE.Vector3(...toWorld(fingers[id], hand));
      vecs[id] = v;
      sum.add(id === 'thumb' ? v.clone().multiplyScalar(1.2) : v.clone().multiplyScalar(0.5));
    }
    if (sum.lengthSq() < 1e-6) sum.set(0, 0, 1);
    const palmDir = sum.normalize();
    const palmPos = palmDir.clone().multiplyScalar(1.75);
    const palmQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), palmDir);
    const tubes: THREE.TubeGeometry[] = [];
    const s = hand === 'R' ? 1 : -1;
    const order: Record<FingerId, number> = { thumb: -1.3, index: -0.6, middle: -0.1, ring: 0.4, little: 0.85 };
    for (const id of FINGERS) {
      const v = vecs[id];
      if (!v) continue;
      // knuckle base on the palm, spread across the palm width toward the finger's side
      const lateral = new THREE.Vector3().crossVectors(palmDir, new THREE.Vector3(0, 1, 0));
      if (lateral.lengthSq() < 1e-6) lateral.set(1, 0, 0);
      lateral.normalize().multiplyScalar(0.42 * order[id] * s);
      const base = palmPos.clone().add(lateral).add(new THREE.Vector3(0, id === 'thumb' ? -0.35 : 0.3, 0));
      const end = v.clone().multiplyScalar(1.04);
      const mid = base.clone().add(end).multiplyScalar(0.5);
      mid.normalize().multiplyScalar(Math.max(1.35, mid.length() * 1.1));
      const curve = new THREE.CatmullRomCurve3([base, mid, end]);
      tubes.push(new THREE.TubeGeometry(curve, 24, id === 'thumb' ? 0.15 : 0.12, 10, false));
    }
    return { palmPos, palmQuat, tubes };
  }, [fingers, hand]);
  return (
    <group>
      <mesh position={palmPos} quaternion={palmQuat} scale={[0.85, 1.0, 0.38]}>
        <sphereGeometry args={[1, 24, 16]} />
        <meshStandardMaterial color="#e6b48f" transparent opacity={0.22} depthWrite={false} />
      </mesh>
      {tubes.map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshStandardMaterial color="#e6b48f" transparent opacity={0.3} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}
