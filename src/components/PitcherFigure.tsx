import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { Html, Line } from '@react-three/drei';
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';
import { useStore } from '../state/store';
import { poseBody, slotName, type BodyPose } from '../body/pitcherBody';
import { buildHandPose } from '../grip/handModel';
import { ellipsoid, roundCone, fieldFromPrims, type Prim } from '../grip/handSkin';
import { HandViz } from './HandViz';
import { Baseball } from './Baseball';
import type { Trajectory } from '../physics/simulate';
import { BALL_RADIUS, MOUND_HEIGHT, RUBBER_TO_PLATE } from '../physics/constants';
import type { Vec3 } from '../physics/vec';
import { add, scale, sub, norm, cross } from '../physics/vec';
import { fmtLong } from '../util/units';

const RES = 112;
const noRaycast = () => null;

/** Uniform colours (sRGB hex -> linear for vertex colours). */
const UNIFORM = {
  jersey: '#f3f1ea', pants: '#e6e3da', socks: '#1b2d57', undershirt: '#1b2d57', belt: '#13213f', cleats: '#151515', skin: '#d39b78',
};
const lin = (hex: string): Vec3 => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const C = Object.fromEntries(Object.entries(UNIFORM).map(([k, v]) => [k, lin(v)])) as Record<keyof typeof UNIFORM, Vec3>;
const paint = (pr: Prim, color: Vec3): Prim => ({ ...pr, color });
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => add(a, scale(sub(b, a), t));

function bodyPrims(p: BodyPose): Prim[] {
  const k = p.H / 1.88;
  const up = norm(sub(p.neck, p.pelvis));
  const lat = norm(sub(p.shoulderT, p.shoulderG));
  const fwd = norm(cross(lat, up));
  const lat2 = norm(cross(up, fwd));
  const headUp = norm(sub(p.head, p.neck));
  const sleeveT = lerp3(p.shoulderT, p.elbowT, 0.45), sleeveG = lerp3(p.shoulderG, p.elbowG, 0.45);
  const belt = add(p.pelvis, scale(up, 0.13 * k));
  return [
    // head and neck
    paint(ellipsoid(p.head, lat2, headUp, fwd, [0.078 * k, 0.1 * k, 0.09 * k]), C.skin),
    paint(roundCone(p.neck, add(p.neck, scale(headUp, 0.09 * k)), 0.055 * k, 0.048 * k), C.skin),
    // jersey: chest, back, shoulders, short sleeves
    paint(ellipsoid(p.chest, lat2, up, fwd, [0.18 * k, 0.22 * k, 0.125 * k]), C.jersey),
    paint(roundCone(belt, p.neck, 0.15 * k, 0.15 * k), C.jersey),
    paint(roundCone(p.shoulderG, p.shoulderT, 0.064 * k, 0.064 * k), C.jersey),
    paint(roundCone(p.shoulderT, sleeveT, 0.058 * k, 0.05 * k), C.jersey),
    paint(roundCone(p.shoulderG, sleeveG, 0.058 * k, 0.05 * k), C.jersey),
    // undershirt sleeves to the elbow, then bare forearms
    paint(roundCone(sleeveT, p.elbowT, 0.046 * k, 0.041 * k), C.undershirt),
    paint(roundCone(sleeveG, p.elbowG, 0.046 * k, 0.041 * k), C.undershirt),
    paint(roundCone(p.elbowT, p.wristT, 0.04 * k, 0.026 * k), C.skin),
    paint(roundCone(p.elbowG, p.wristG, 0.04 * k, 0.03 * k), C.skin),
    // belt and pants
    paint(roundCone(add(belt, scale(lat2, -0.14 * k)), add(belt, scale(lat2, 0.14 * k)), 0.03 * k, 0.03 * k), C.belt),
    paint(ellipsoid(add(p.pelvis, scale(up, 0.03 * k)), lat2, up, fwd, [0.17 * k, 0.13 * k, 0.12 * k]), C.pants),
    paint(roundCone(p.hipF, p.kneeF, 0.088 * k, 0.06 * k), C.pants),
    paint(roundCone(p.hipB, p.kneeB, 0.088 * k, 0.06 * k), C.pants),
    paint(roundCone(p.kneeF, lerp3(p.kneeF, p.ankleF, 0.22), 0.058 * k, 0.054 * k), C.pants),
    paint(roundCone(p.kneeB, lerp3(p.kneeB, p.ankleB, 0.22), 0.058 * k, 0.054 * k), C.pants),
    // high socks and cleats
    paint(roundCone(lerp3(p.kneeF, p.ankleF, 0.22), p.ankleF, 0.052 * k, 0.04 * k), C.socks),
    paint(roundCone(lerp3(p.kneeB, p.ankleB, 0.22), p.ankleB, 0.052 * k, 0.04 * k), C.socks),
    paint(roundCone(p.ankleF, p.toeF, 0.047 * k, 0.037 * k), C.cleats),
    paint(roundCone(p.ankleB, p.toeB, 0.047 * k, 0.037 * k), C.cleats),
  ];
}

function Label({ at, children, tone = 'y' }: { at: Vec3; children: React.ReactNode; tone?: 'y' | 'w' }) {
  return (
    <Html position={at} center style={{ pointerEvents: 'none' }} zIndexRange={[5, 0]}>
      <div className={`guide-lbl ${tone}`}>{children}</div>
    </Html>
  );
}

/** Pitcher at release: mannequin body whose throwing wrist meets the grip hand holding the ball at the release point. */
export function PitcherFigure({ traj, showGripBall, compact = false }: { traj: Trajectory; showGripBall: boolean; compact?: boolean }) {
  const body = useStore((s) => s.body);
  const hand = useStore((s) => s.hand);
  const fingers = useStore((s) => s.grip.fingers);
  const handSize = useStore((s) => s.handSize);
  const slot = useStore((s) => s.delivery.armSlotDeg);
  const units = useStore((s) => s.view.units);
  const showGuides = useStore((s) => s.view.showGuides);
  const release = traj.init.p;

  const handPose = useMemo(() => buildHandPose(fingers, hand, handSize, 'release'), [fingers, hand, handSize]);
  const wrist = useMemo(() => add(release, scale(handPose.wrist, BALL_RADIUS)), [release, handPose]);
  const pose = useMemo(() => poseBody(body, hand, release, wrist, slot), [body, hand, release, wrist, slot]);

  const material = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 }), []);
  const mc = useMemo(() => {
    const m = new MarchingCubes(RES, material, false, true, 180000);
    m.isolation = 0;
    m.raycast = noRaycast;
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }, [material]);
  useEffect(() => () => { mc.geometry.dispose(); }, [mc]);
  useMemo(() => {
    const sf = fieldFromPrims(bodyPrims(pose), RES, 0.03, mc.field, mc.palette);
    (mc as unknown as { normal_cache: Float32Array }).normal_cache.fill(0);
    mc.position.set(sf.center[0], sf.center[1], sf.center[2]);
    mc.scale.setScalar(sf.half);
    mc.update();
  }, [pose, mc]);

  const q0 = traj.init.q0;
  const k = pose.H / 1.88;
  const sh = pose.shoulderT;
  return (
    <group>
      <primitive object={mc} />
      {/* cap: crown + brim facing the plate */}
      <group position={add(pose.head, [0, 0.045 * k, 0])}>
        <mesh raycast={noRaycast} scale={[1, 0.62, 1.08]} castShadow>
          <sphereGeometry args={[0.092 * k, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.58]} />
          <meshStandardMaterial color="#13284d" roughness={0.75} side={THREE.DoubleSide} />
        </mesh>
        <mesh raycast={noRaycast} position={[0, 0.006 * k, -0.095 * k]} rotation={[0.18, 0, 0]} scale={[1, 1, 0.75]} castShadow>
          <cylinderGeometry args={[0.07 * k, 0.07 * k, 0.008 * k, 28, 1, false, -Math.PI / 2, Math.PI]} />
          <meshStandardMaterial color="#0f2142" roughness={0.7} />
        </mesh>
      </group>
      {/* glove: pocket and finger stalls */}
      <group position={pose.wristG}>
        <mesh raycast={noRaycast} scale={[1, 1.2, 0.62]} castShadow>
          <sphereGeometry args={[0.1 * k, 24, 16]} />
          <meshStandardMaterial color="#7b4a24" roughness={0.68} />
        </mesh>
        <mesh raycast={noRaycast} position={[0, 0.1 * k, 0]} scale={[0.9, 0.9, 0.5]} castShadow>
          <sphereGeometry args={[0.09 * k, 20, 14]} />
          <meshStandardMaterial color="#6a3d1c" roughness={0.7} />
        </mesh>
      </group>
      {/* the grip hand holding the ball at the release point, in the release orientation */}
      <group position={release} scale={BALL_RADIUS}>
        <HandViz fingers={fingers} hand={hand} size={handSize} style="solid" mode="release" />
        {showGripBall && (
          <group quaternion={new THREE.Quaternion(q0[1], q0[2], q0[3], q0[0])}><Baseball radius={1} detail={0.6} /></group>
        )}
      </group>
      {showGuides && (
        <group>
          {/* arm slot: shoulder -> ball line vs vertical */}
          <Line points={[sh, release]} color="#ffd34d" lineWidth={2} dashed dashSize={0.05} gapSize={0.03} />
          <Line points={[sh, add(sh, [0, 0.75, 0])]} color="#ffffff" lineWidth={1} dashed dashSize={0.04} gapSize={0.04} transparent opacity={0.6} />
          {!compact && <Label at={add(add(sh, [0, 0.82, 0]), [release[0] * 0.15, 0, 0])}>Arm slot {slot.toFixed(0)}° · {slotName(slot)}</Label>}
          {!compact && <>
          {/* release height above plate level */}
          <Line points={[[release[0], 0, release[2]], release]} color="#7fd4ff" lineWidth={1.5} dashed dashSize={0.06} gapSize={0.04} />
          <Label at={[release[0], release[1] * 0.45, release[2]]} tone="w">Release height {fmtLong(release[1], units)}</Label>
          {/* side: from the rubber's centre line */}
          <Line points={[[0, release[1], release[2]], release]} color="#7fd4ff" lineWidth={1.5} />
          <Label at={[release[0] / 2, release[1] - 0.22, release[2]]} tone="w">{fmtLong(Math.abs(release[0]), units)} to the arm side</Label>
          {/* extension along the mound */}
          <Line points={[[release[0], MOUND_HEIGHT + 0.01, RUBBER_TO_PLATE], [release[0], MOUND_HEIGHT + 0.01, release[2]]]} color="#4be3a4" lineWidth={2} />
          <Label at={[release[0], MOUND_HEIGHT + 0.08, (RUBBER_TO_PLATE + release[2]) / 2]} tone="w">Extension {fmtLong(RUBBER_TO_PLATE - release[2], units)}</Label>
          </>}
        </group>
      )}
    </group>
  );
}


