import { useMemo } from 'react';
import * as THREE from 'three';
import { RoundedBox } from '@react-three/drei';
import { FINGER_META, type FingerContact, type FingerId } from '../grip/types';
import type { Hand } from '../physics/simulate';
import { buildHandPose, PALM } from '../grip/handModel';
import type { Vec3 } from '../physics/vec';

export type HandStyle = 'off' | 'ghost' | 'solid';

const v = (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2]);
const noRaycast = () => null;

function Capsule({ a, b, r, mat }: { a: Vec3; b: Vec3; r: number; mat: THREE.Material }) {
  const A = v(a), B = v(b);
  const dir = B.clone().sub(A);
  const L = dir.length();
  if (L < 1e-6) return null;
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return (
    <mesh position={A.clone().add(B).multiplyScalar(0.5)} quaternion={q} material={mat} raycast={noRaycast}>
      <capsuleGeometry args={[r, L, 6, 14]} />
    </mesh>
  );
}

function basisQuat(x: Vec3, y: Vec3, z: Vec3) {
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(v(x), v(y), v(z)));
}

/** Anatomical hand reaching the contact points (display only; see grip/handModel.ts). */
export function HandViz({ fingers, hand, size, style }: { fingers: Record<FingerId, FingerContact>; hand: Hand; size: number; style: HandStyle }) {
  const pose = useMemo(() => buildHandPose(fingers, hand, size), [fingers, hand, size]);
  const solid = style === 'solid';
  const skin = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#e2ad8a', roughness: 0.55, metalness: 0, transparent: !solid, opacity: solid ? 1 : 0.42, depthWrite: solid }),
    [solid],
  );
  const skinDark = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#c98f6c', roughness: 0.6, transparent: !solid, opacity: solid ? 1 : 0.42, depthWrite: solid }),
    [solid],
  );
  const nailMats = useMemo(() => {
    const m = {} as Record<FingerId, THREE.MeshStandardMaterial>;
    for (const id of Object.keys(FINGER_META) as FingerId[]) {
      // natural nail with a faint tint of the finger's marker colour
      m[id] = new THREE.MeshStandardMaterial({ color: new THREE.Color('#f0cfc2').lerp(new THREE.Color(FINGER_META[id].color), 0.15), roughness: 0.25, transparent: !solid, opacity: solid ? 1 : 0.7 });
    }
    return m;
  }, [solid]);
  if (style === 'off') return null;
  const s = pose.size;
  const palmQ = basisQuat(pose.w, pose.u, pose.n);
  return (
    <group>
      {/* palm */}
      <RoundedBox args={[PALM.width * s, PALM.length * s, PALM.thickness * s]} radius={0.28 * s} smoothness={4} position={v(pose.palmCenter)} quaternion={palmQ} material={skin} raycast={noRaycast} />
      {/* knuckle ridge */}
      {pose.fingers.slice(1).map((f) => (
        <mesh key={`k${f.id}`} position={v(f.joints[0])} material={skin} raycast={noRaycast}>
          <sphereGeometry args={[f.radius * 1.08, 16, 12]} />
        </mesh>
      ))}
      {/* thenar eminence (thumb base) */}
      <mesh position={v(pose.thenar.center)} quaternion={palmQ} scale={[1, 1.35, 0.75]} material={skin} raycast={noRaycast}>
        <sphereGeometry args={[pose.thenar.radius, 20, 14]} />
      </mesh>
      {/* wrist + forearm */}
      <Capsule a={pose.wrist} b={pose.forearmEnd} r={0.72 * s} mat={skinDark} />
      {/* fingers */}
      {pose.fingers.map((f) => {
        const radii = [f.radius * (f.id === 'thumb' ? 1.15 : 1), f.radius * 0.94, f.radius * 0.86];
        const nailQ = basisQuat(norm3(cross3(f.nail.along, f.nail.out)), f.nail.along, f.nail.out);
        return (
          <group key={f.id}>
            {[0, 1, 2].map((i) => <Capsule key={i} a={f.joints[i]} b={f.joints[i + 1]} r={radii[i]} mat={skin} />)}
            <mesh position={v(f.nail.center)} quaternion={nailQ} material={nailMats[f.id]} raycast={noRaycast}>
              <boxGeometry args={[f.radius * 0.85, f.radius * 1.0, f.radius * 0.08]} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a: Vec3): Vec3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
