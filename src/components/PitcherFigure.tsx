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

const RES = 96;
const noRaycast = () => null;

function bodyPrims(p: BodyPose): Prim[] {
  const k = p.H / 1.88;
  const up = norm(sub(p.neck, p.pelvis));
  const lat = norm(sub(p.shoulderT, p.shoulderG));
  const fwd = norm(cross(lat, up));
  const lat2 = norm(cross(up, fwd));
  const headUp = norm(sub(p.head, p.neck));
  return [
    ellipsoid(p.head, lat2, headUp, fwd, [0.078 * k, 0.1 * k, 0.09 * k]),
    roundCone(p.neck, add(p.neck, scale(headUp, 0.09 * k)), 0.055 * k, 0.048 * k),
    ellipsoid(p.chest, lat2, up, fwd, [0.18 * k, 0.22 * k, 0.125 * k]),
    ellipsoid(add(p.pelvis, scale(up, 0.06 * k)), lat2, up, fwd, [0.165 * k, 0.14 * k, 0.115 * k]),
    roundCone(p.pelvis, p.neck, 0.15 * k, 0.15 * k),
    roundCone(p.shoulderG, p.shoulderT, 0.062 * k, 0.062 * k),
    roundCone(p.shoulderT, p.elbowT, 0.052 * k, 0.041 * k),
    roundCone(p.elbowT, p.wristT, 0.041 * k, 0.026 * k),
    roundCone(p.shoulderG, p.elbowG, 0.052 * k, 0.041 * k),
    roundCone(p.elbowG, p.wristG, 0.041 * k, 0.03 * k),
    roundCone(p.hipF, p.kneeF, 0.085 * k, 0.058 * k),
    roundCone(p.kneeF, p.ankleF, 0.056 * k, 0.04 * k),
    roundCone(p.ankleF, p.toeF, 0.045 * k, 0.036 * k),
    roundCone(p.hipB, p.kneeB, 0.085 * k, 0.058 * k),
    roundCone(p.kneeB, p.ankleB, 0.056 * k, 0.04 * k),
    roundCone(p.ankleB, p.toeB, 0.045 * k, 0.036 * k),
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

  const handPose = useMemo(() => buildHandPose(fingers, hand, handSize), [fingers, hand, handSize]);
  const wrist = useMemo(() => add(release, scale(handPose.wrist, BALL_RADIUS)), [release, handPose]);
  const pose = useMemo(() => poseBody(body, hand, release, wrist, slot), [body, hand, release, wrist, slot]);

  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: '#e3e8f2', roughness: 0.85, metalness: 0 }), []);
  const mc = useMemo(() => {
    const m = new MarchingCubes(RES, material, false, false, 160000);
    m.isolation = 0;
    m.raycast = noRaycast;
    return m;
  }, [material]);
  useEffect(() => () => { mc.geometry.dispose(); }, [mc]);
  useMemo(() => {
    const sf = fieldFromPrims(bodyPrims(pose), RES, 0.035, mc.field);
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
      {/* cap and glove */}
      <mesh position={add(pose.head, [0, 0.06 * k, -0.01])} raycast={noRaycast} scale={[1, 0.55, 1.1]}>
        <sphereGeometry args={[0.095 * k, 24, 16]} />
        <meshStandardMaterial color="#13284d" roughness={0.7} />
      </mesh>
      <mesh position={pose.wristG} raycast={noRaycast} scale={[1, 1.25, 0.6]}>
        <sphereGeometry args={[0.1 * k, 24, 16]} />
        <meshStandardMaterial color="#7a4a26" roughness={0.75} />
      </mesh>
      {/* the grip hand holding the ball at the release point, in the release orientation */}
      <group position={release} scale={BALL_RADIUS}>
        <HandViz fingers={fingers} hand={hand} size={handSize} style="solid" />
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


