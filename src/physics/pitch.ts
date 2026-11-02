// High-level pitch computation: release spec -> trajectory + no-lift reference + measurements.

import { len, deg, rad, dot, qMul, qAxisAngle, qNorm } from './vec';
import { airDensity, windVector, type EnvironmentSettings } from './atmosphere';
import type { SeamModelParams } from './seamModel';
import {
  initialState, simulate, spinAxis, releaseDirection, armSideX,
  type ReleaseSpec, type Trajectory, type PhysicsOptions,
} from './simulate';
import { PLATE_FRONT_Z } from './constants';

export interface SimSettings {
  env: EnvironmentSettings;
  dt: number;
  /** Seam-dependent force parameters, or null when disabled. */
  seam: SeamModelParams | null;
}

export interface PitchMetrics {
  releaseSpeed: number; // m/s
  plateSpeed: number; // m/s
  flightTime: number; // s
  spinRpm: number;
  spinEfficiency: number; // 0..1
  /** Horizontal movement vs the no-lift reference at the plate, m, + = catcher's right (first-base side), catcher's view. */
  hMove: number;
  /** Same, + = toward the pitcher's arm side. */
  hMoveArmSide: number;
  /** Induced vertical movement vs the no-lift reference at the plate, m. + = less drop than the reference. */
  ivb: number;
  /** Vertical drop below the straight line of the release velocity, at the plate, m. */
  totalDrop: number;
  /** Height change from release to the plate, m. */
  heightChange: number;
  plateX: number; // m, catcher's right +
  plateY: number; // m, height above ground
  /** Vertical approach angle, deg (negative = descending). */
  vaa: number;
  haa: number;
  totalRevolutions: number;
  flightDistance: number; // m, release to front of plate along z
}

export interface PitchResult {
  spec: ReleaseSpec;
  traj: Trajectory;
  /** Same release velocity, gravity + drag only (no Magnus, no seam force). */
  ref: Trajectory;
  metrics: PitchMetrics | null;
}

export function physicsOptions(s: SimSettings, magnus: boolean, seam: boolean): PhysicsOptions {
  return { dt: s.dt, airDensity: airDensity(s.env), wind: windVector(s.env), magnus, seam: seam ? s.seam : null };
}

export function computePitch(spec: ReleaseSpec, s: SimSettings): PitchResult {
  const init = initialState(spec);
  const traj = simulate(init, physicsOptions(s, true, true));
  const ref = simulate(init, physicsOptions(s, false, false));
  return { spec, traj, ref, metrics: computeMetrics(spec, traj, ref) };
}

export function computeMetrics(spec: ReleaseSpec, traj: Trajectory, ref: Trajectory): PitchMetrics | null {
  const c = traj.crossing, r = ref.crossing;
  if (!c || !r) return null;
  const p0 = traj.init.p, v0 = traj.init.v;
  const lineT = (PLATE_FRONT_Z - p0[2]) / v0[2];
  const yLine = p0[1] + v0[1] * lineT;
  const d = releaseDirection(spec);
  const ax = spinAxis(spec);
  const eff = Math.sqrt(Math.max(0, 1 - dot(ax, d) ** 2));
  const dx = c.p[0] - r.p[0];
  return {
    releaseSpeed: len(v0),
    plateSpeed: len(c.v),
    flightTime: c.t,
    spinRpm: spec.spinRpm,
    spinEfficiency: spec.spinRpm > 0 ? eff : 0,
    hMove: -dx,
    hMoveArmSide: dx * armSideX(spec.hand),
    ivb: c.p[1] - r.p[1],
    totalDrop: yLine - c.p[1],
    heightChange: p0[1] - c.p[1],
    plateX: -c.p[0],
    plateY: c.p[1],
    vaa: deg(Math.atan2(c.v[1], -c.v[2])),
    haa: deg(Math.atan2(-c.v[0], -c.v[2])),
    totalRevolutions: (spec.spinRpm / 60) * c.t,
    flightDistance: p0[2] - PLATE_FRONT_Z,
  };
}

/** Solve release angles so the full-physics pitch crosses the plate at (x, y), x in catcher's view (+ = catcher's
 *  right). Deterministic fixed iterations. */
export function aimAt(spec: ReleaseSpec, s: SimSettings, target: { x: number; y: number }): ReleaseSpec {
  let cur = { ...spec };
  const sx = armSideX(spec.hand);
  for (let i = 0; i < 8; i++) {
    const init = initialState(cur);
    const tr = simulate(init, { ...physicsOptions(s, true, true), overrun: 0.05 });
    if (!tr.crossing) {
      cur = { ...cur, vAngleDeg: cur.vAngleDeg + 1 };
      continue;
    }
    const dist = init.p[2] - PLATE_FRONT_Z;
    const ex = -target.x - tr.crossing.p[0];
    const ey = target.y - tr.crossing.p[1];
    if (Math.abs(ex) < 1e-4 && Math.abs(ey) < 1e-4) break;
    cur = {
      ...cur,
      vAngleDeg: cur.vAngleDeg + deg(Math.atan(ey / dist)),
      hAngleDeg: cur.hAngleDeg + sx * deg(Math.atan(ex / dist)),
    };
  }
  cur.vAngleDeg = Math.round(cur.vAngleDeg * 100) / 100;
  cur.hAngleDeg = Math.round(cur.hAngleDeg * 100) / 100;
  return cur;
}

// ---------------------------------------------------------------------------------------------
// Variants: "change one variable" and "small release changes".

export type VariantVar =
  | 'spinRpm' | 'tiltDeg' | 'gyroDeg' | 'speed' | 'vAngleDeg' | 'hAngleDeg'
  | 'seamYaw' | 'seamPitch' | 'seamRoll';

export const VARIANT_LABELS: Record<VariantVar, string> = {
  spinRpm: 'Spin rate',
  tiltDeg: 'Spin axis (tilt)',
  gyroDeg: 'Gyro angle',
  speed: 'Release velocity',
  vAngleDeg: 'Vertical release angle',
  hAngleDeg: 'Horizontal release angle',
  seamYaw: 'Seam orientation — yaw',
  seamPitch: 'Seam orientation — pitch',
  seamRoll: 'Seam orientation — roll',
};

/** Apply a delta to one release variable, holding everything else constant. Units: rpm, deg, m/s. */
export function applyVariant(spec: ReleaseSpec, v: VariantVar, delta: number): ReleaseSpec {
  switch (v) {
    case 'spinRpm': return { ...spec, spinRpm: Math.max(0, spec.spinRpm + delta) };
    case 'tiltDeg': return { ...spec, tiltDeg: spec.tiltDeg + delta };
    case 'gyroDeg': return { ...spec, gyroDeg: Math.max(-89, Math.min(89, spec.gyroDeg + delta)) };
    case 'speed': return { ...spec, speed: Math.max(5, spec.speed + delta) };
    case 'vAngleDeg': return { ...spec, vAngleDeg: spec.vAngleDeg + delta };
    case 'hAngleDeg': return { ...spec, hAngleDeg: spec.hAngleDeg + delta };
    case 'seamYaw': return { ...spec, seamQuat: qNorm(qMul(qAxisAngle([0, 1, 0], rad(delta)), spec.seamQuat)) };
    case 'seamPitch': return { ...spec, seamQuat: qNorm(qMul(qAxisAngle([1, 0, 0], rad(delta)), spec.seamQuat)) };
    case 'seamRoll': return { ...spec, seamQuat: qNorm(qMul(qAxisAngle([0, 0, 1], rad(delta)), spec.seamQuat)) };
  }
}

// ---------------------------------------------------------------------------------------------
// Seeded ensemble ("Throw 20 pitches"): simulated sensitivity to assumed release variation.

/** mulberry32 PRNG — deterministic for a given 32-bit seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface EnsembleRanges {
  /** ± uniform half-ranges */
  seamDeg: number; // applied independently to yaw, pitch, roll
  spinRpm: number;
  tiltDeg: number;
  angleDeg: number; // applied to vertical and horizontal release angle
  speedMps: number;
}

export const DEFAULT_ENSEMBLE_RANGES: EnsembleRanges = { seamDeg: 15, spinRpm: 15, tiltDeg: 30, angleDeg: 0.25, speedMps: 0.25 };

export function ensembleSpecs(base: ReleaseSpec, ranges: EnsembleRanges, seed: number, n = 20): ReleaseSpec[] {
  const rnd = mulberry32(seed);
  const u = (r: number) => (rnd() * 2 - 1) * r;
  const out: ReleaseSpec[] = [];
  for (let i = 0; i < n; i++) {
    let s = applyVariant(base, 'seamYaw', u(ranges.seamDeg));
    s = applyVariant(s, 'seamPitch', u(ranges.seamDeg));
    s = applyVariant(s, 'seamRoll', u(ranges.seamDeg));
    s = applyVariant(s, 'spinRpm', u(ranges.spinRpm));
    s = applyVariant(s, 'tiltDeg', u(ranges.tiltDeg));
    s = applyVariant(s, 'vAngleDeg', u(ranges.angleDeg));
    s = applyVariant(s, 'hAngleDeg', u(ranges.angleDeg));
    s = applyVariant(s, 'speed', u(ranges.speedMps));
    out.push(s);
  }
  return out;
}
