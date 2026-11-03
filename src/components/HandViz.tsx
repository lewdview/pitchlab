import { useMemo } from 'react';
import * as THREE from 'three';
import type { FingerContact, FingerId } from '../grip/types';
import type { Hand } from '../physics/simulate';
import { buildHandPose, PALM, type FingerPose } from '../grip/handModel';
import type { Vec3 } from '../physics/vec';

export type HandStyle = 'off' | 'ghost' | 'solid';

const V = (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2]);
const noRaycast = () => null;
/** Fingers are wider than they are deep. */
const FLAT = 0.8;

/** Orthonormal frame (x = lateral, y = along, z = dorsal), right-handed. */
function frame(along: THREE.Vector3, lateralHint: THREE.Vector3, dorsalHint: THREE.Vector3) {
  const y = along.clone().normalize();
  let x = lateralHint.clone().sub(y.clone().multiplyScalar(lateralHint.dot(y)));
  if (x.lengthSq() < 1e-8) x = new THREE.Vector3(1, 0, 0).cross(y);
  if (x.lengthSq() < 1e-8) x = new THREE.Vector3(0, 0, 1).cross(y);
  x.normalize();
  let z = new THREE.Vector3().crossVectors(x, y).normalize();
  if (z.dot(dorsalHint) < 0) { x.negate(); z.negate(); }
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/** Tapered, slightly flattened limb segment from a (radius r0) to b (radius r1). Joints are covered by spheres. */
function Segment({ a, b, r0, r1, lat, dorsal, mat, flat = FLAT }: { a: THREE.Vector3; b: THREE.Vector3; r0: number; r1: number; lat: THREE.Vector3; dorsal: THREE.Vector3; mat: THREE.Material; flat?: number }) {
  const d = b.clone().sub(a);
  const L = d.length();
  if (L < 1e-6) return null;
  return (
    <mesh position={a.clone().add(b).multiplyScalar(0.5)} quaternion={frame(d, lat, dorsal)} scale={[1, 1, flat]} material={mat} raycast={noRaycast}>
      <cylinderGeometry args={[r1, r0, L, 24, 1, true]} />
    </mesh>
  );
}

function Blob({ at, r, q, scale, mat }: { at: THREE.Vector3; r: number; q: THREE.Quaternion; scale: [number, number, number]; mat: THREE.Material }) {
  return (
    <mesh position={at} quaternion={q} scale={scale} material={mat} raycast={noRaycast}>
      <sphereGeometry args={[r, 28, 20]} />
    </mesh>
  );
}

function Finger({ f, w, mat, nailMat }: { f: FingerPose; w: Vec3; mat: THREE.Material; nailMat: THREE.Material }) {
  const J = f.joints.map(V);
  const segs = [0, 1, 2].map((i) => J[i + 1].clone().sub(J[i]));
  const thumb = f.id === 'thumb';
  const r = f.radius * (thumb ? 1.08 : 1);
  // radii along the finger: knuckle -> tip taper
  const rad = thumb ? [r * 1.15, r * 1.0, r * 0.94, r * 0.86] : [r * 1.0, r * 0.93, r * 0.86, r * 0.8];
  // flexion plane: lateral axis is perpendicular to the plane the finger bends in
  let lat = new THREE.Vector3().crossVectors(segs[0], segs[2]);
  if (lat.length() < 0.05 * segs[0].length() * segs[2].length()) lat = V(w);
  lat.normalize();
  const dorsalHint = V(f.nail.out);
  const dorsals = segs.map((s) => {
    const dz = new THREE.Vector3().crossVectors(lat, s).normalize();
    return dz.dot(dorsalHint) < 0 ? dz.negate() : dz;
  });
  const qs = segs.map((s, i) => frame(s, lat, dorsals[i]));
  const along = V(f.nail.along), out = V(f.nail.out);
  const nailQ = frame(along, new THREE.Vector3().crossVectors(along, out), out);
  const nailPos = V(f.nail.center).add(out.clone().multiplyScalar(-f.radius * 0.06)).add(along.clone().multiplyScalar(f.radius * 0.15));
  return (
    <group>
      {[0, 1, 2].map((i) => <Segment key={i} a={J[i]} b={J[i + 1]} r0={rad[i]} r1={rad[i + 1]} lat={lat} dorsal={dorsals[i]} mat={mat} />)}
      {/* knuckle joints */}
      <Blob at={J[1]} r={rad[1] * 1.04} q={qs[1]} scale={[1, 1, FLAT]} mat={mat} />
      <Blob at={J[2]} r={rad[2] * 1.03} q={qs[2]} scale={[1, 1, FLAT]} mat={mat} />
      {thumb && <Blob at={J[0]} r={rad[0]} q={qs[0]} scale={[1, 1, FLAT]} mat={mat} />}
      {/* rounded fingertip pad */}
      <Blob at={J[3]} r={rad[3]} q={qs[2]} scale={[1, 1.12, FLAT * 1.05]} mat={mat} />
      {/* curved nail */}
      <Blob at={nailPos} r={1} q={nailQ} scale={[f.radius * 0.66, f.radius * 0.88, f.radius * 0.16]} mat={nailMat} />
    </group>
  );
}

/** Anatomical hand reaching the contact points (display only; see grip/handModel.ts). */
export function HandViz({ fingers, hand, size, style }: { fingers: Record<FingerId, FingerContact>; hand: Hand; size: number; style: HandStyle }) {
  const pose = useMemo(() => buildHandPose(fingers, hand, size), [fingers, hand, size]);
  const solid = style === 'solid';
  const { skin, nail } = useMemo(() => {
    const ghost = { transparent: !solid, opacity: solid ? 1 : 0.42, depthWrite: solid };
    return {
      skin: new THREE.MeshPhysicalMaterial({
        color: '#d9a07f', roughness: 0.6, metalness: 0, sheen: 0.6, sheenRoughness: 0.55, sheenColor: new THREE.Color('#ffd0b8'), ...ghost,
      }),
      nail: new THREE.MeshPhysicalMaterial({ color: '#efc7b8', roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.3, ...ghost, opacity: solid ? 1 : 0.55 }),
    };
  }, [solid]);
  if (style === 'off') return null;

  const s = pose.size;
  const u = V(pose.u), w = V(pose.w), n = V(pose.n);
  const halfW = (PALM.width * s) / 2, halfL = (PALM.length * s) / 2, halfT = (PALM.thickness * s) / 2;
  const palmQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(w, u, n));
  const P = V(pose.palmCenter);
  const mcp = pose.fingers.slice(1).map((f) => V(f.joints[0]));
  const knuckleR = pose.fingers.slice(1).map((f) => f.radius * 1.05);
  const wrist = V(pose.wrist), forearm = V(pose.forearmEnd);
  const sideW = pose.w; // little-finger side

  return (
    <group>
      {/* palm body: a soft ellipsoid rather than a slab */}
      <Blob at={P.clone().add(u.clone().multiplyScalar(0.05 * halfL))} r={1} q={palmQ} scale={[halfW * 0.98, halfL * 1.02, halfT]} mat={skin} />
      {/* fleshy heel on the little-finger side (hypothenar) */}
      <Blob at={P.clone().add(w.clone().multiplyScalar(halfW * 0.48)).add(u.clone().multiplyScalar(-halfL * 0.42)).add(n.clone().multiplyScalar(halfT * 0.25))} r={1} q={palmQ} scale={[halfW * 0.45, halfL * 0.55, halfT * 1.05]} mat={skin} />
      {/* thumb base (thenar) */}
      <Blob at={V(pose.thenar.center)} r={pose.thenar.radius} q={palmQ} scale={[1, 1.4, 0.8]} mat={skin} />
      {/* knuckle ridge joining the finger bases */}
      {mcp.slice(0, -1).map((a, i) => (
        <Segment key={`kr${i}`} a={a} b={mcp[i + 1]} r0={knuckleR[i]} r1={knuckleR[i + 1]} lat={u} dorsal={n.clone().negate()} mat={skin} flat={0.85} />
      ))}
      {mcp.map((a, i) => <Blob key={`k${i}`} at={a} r={knuckleR[i]} q={palmQ} scale={[1, 1, 0.85]} mat={skin} />)}
      {/* wrist tapering into the forearm */}
      <Segment a={wrist} b={forearm} r0={0.6 * s} r1={0.74 * s} lat={V(sideW)} dorsal={n.clone().negate()} mat={skin} flat={0.72} />
      <Blob at={wrist} r={0.6 * s} q={palmQ} scale={[1.05, 0.6, 0.72]} mat={skin} />
      {pose.fingers.map((f) => <Finger key={f.id} f={f} w={pose.w} mat={skin} nailMat={nail} />)}
    </group>
  );
}
