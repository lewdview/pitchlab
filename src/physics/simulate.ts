// Flight physics engine. Input: release conditions (SI). Output: a fixed-step trajectory.
// No dependence on rendering, grip estimation or UI state.
//
// Forces: gravity, aerodynamic drag, Magnus (from spin perpendicular to the air-relative velocity), and an
// optional seam-dependent force (see seamModel.ts). Integration: classical RK4 with a fixed time step
// (default 1 ms), independent of frame rate. The ball's orientation is computed analytically: spin is
// constant in the world frame (spin decay over a ~0.5 s flight is a few percent and is neglected), so
// q(t) = Rot(omega_hat, |omega| t) * q0 exactly. That lets slowly rotating seams change the
// seam force continuously during flight.

import type { Vec3, Quat, Mat3 } from './vec';
import {
  add, scale, sub, dot, cross, len, norm, qAxisAngle, qMul, qToMat, matMul, matToQuat, MIRROR_X, rad, qNorm,
} from './vec';
import { BALL_AREA, BALL_MASS, G, PLATE_FRONT_Z, RUBBER_TO_PLATE } from './constants';
import { NATHAN_AERO, dragCoefficient, liftCoefficient, type AeroCoefficients } from './aero';
import { seamForceCoefficient, type SeamModelParams } from './seamModel';

export type Hand = 'R' | 'L';

/** Release conditions in human terms (SI units, handed). Built either from a grip estimate or entered manually. */
export interface ReleaseSpec {
  hand: Hand;
  /** Release speed, m/s. */
  speed: number;
  spinRpm: number;
  /** Direction of the Magnus (transverse-spin) force, degrees clockwise from straight up as seen from behind
   *  the pitcher, measured toward the pitcher's ARM side. 0 = pure backspin (force up), 180 = pure topspin,
   *  +90 = force toward the arm side. */
  tiltDeg: number;
  /** Angle between the spin axis and the plane perpendicular to the flight direction. 0 = all spin is
   *  transverse (100% efficiency), 90 = pure gyro ("bullet") spin. Spin efficiency = cos(gyro). */
  gyroDeg: number;
  /** Vertical release angle, degrees above horizontal. */
  vAngleDeg: number;
  /** Horizontal release angle, degrees toward the pitcher's arm side. */
  hAngleDeg: number;
  /** Release height above home-plate level, m. */
  releaseHeight: number;
  /** Lateral release position, m toward the pitcher's arm side (from the rubber centre line). */
  releaseSide: number;
  /** Extension: distance in front of the rubber at release, m. */
  extension: number;
  /** Ball orientation at release in the right-handed hand frame (body -> world for a RHP). */
  seamQuat: Quat;
}

export interface PhysicsOptions {
  dt: number;
  airDensity: number;
  wind: Vec3;
  magnus: boolean;
  /** null = seam-dependent force disabled. */
  seam: SeamModelParams | null;
  aero?: AeroCoefficients;
  /** Stop integrating this far past the front of the plate (m). */
  overrun?: number;
}

export interface InitialState {
  p: Vec3;
  v: Vec3;
  /** Angular velocity, rad/s, world frame. */
  omega: Vec3;
  q0: Quat;
}

export interface Sample {
  t: number;
  p: Vec3;
  v: Vec3;
  fDrag: Vec3;
  fMagnus: Vec3;
  fSeam: Vec3;
}

export interface Crossing {
  t: number;
  p: Vec3;
  v: Vec3;
}

export interface Trajectory {
  init: InitialState;
  dt: number;
  samples: Sample[];
  crossing: Crossing | null;
  /** True if the ball reached the ground before the plate. */
  grounded: boolean;
}

/** World x sign of the pitcher's arm side: a right-hander's arm side is the pitcher's right = +x. */
export const armSideX = (hand: Hand) => (hand === 'R' ? 1 : -1);

/** Body-frame reflection x <-> y. The seam curve is invariant under it, so it maps a mirrored ball onto itself. */
const MIRROR_BODY: Mat3 = [0, 1, 0, 1, 0, 0, 0, 0, 1];

/** World orientation of the ball for the given hand. A left-hander's grip is the mirror image of the stored
 *  (right-hand frame) grip. */
export function worldSeamQuat(seamQuat: Quat, hand: Hand): Quat {
  if (hand === 'R') return qNorm(seamQuat);
  return matToQuat(matMul(matMul(MIRROR_X, qToMat(seamQuat)), MIRROR_BODY));
}

export function releaseDirection(spec: ReleaseSpec): Vec3 {
  const sx = armSideX(spec.hand);
  const v = rad(spec.vAngleDeg), h = rad(spec.hAngleDeg);
  return [sx * Math.cos(v) * Math.sin(h), Math.sin(v), -Math.cos(v) * Math.cos(h)];
}

/** Unit spin axis (world) from tilt/gyro relative to the release direction. */
export function spinAxis(spec: ReleaseSpec): Vec3 {
  const sx = armSideX(spec.hand);
  const d = releaseDirection(spec);
  const t = rad(spec.tiltDeg);
  let f: Vec3 = [sx * Math.sin(t), Math.cos(t), 0];
  f = norm(sub(f, scale(d, dot(f, d))));
  const wt = norm(cross(d, f)); // omega_t x d is parallel to f, so Magnus pushes along f
  // Angular velocity is a pseudovector: mirroring a right-hander's pitch flips the sign of its gyro component
  // (the transverse part already mirrors correctly through the cross product). gyroDeg > 0 means a right-hand
  // rule rotation about the flight direction for a RHP, and the mirror-image rotation for a LHP.
  const g = rad(spec.gyroDeg) * sx;
  return norm(add(scale(wt, Math.cos(g)), scale(d, Math.sin(g))));
}

export function initialState(spec: ReleaseSpec): InitialState {
  const sx = armSideX(spec.hand);
  const p: Vec3 = [sx * spec.releaseSide, spec.releaseHeight, RUBBER_TO_PLATE - spec.extension];
  const v = scale(releaseDirection(spec), spec.speed);
  const omega = scale(spinAxis(spec), (spec.spinRpm * 2 * Math.PI) / 60);
  return { p, v, omega, q0: worldSeamQuat(spec.seamQuat, spec.hand) };
}

/** Orientation at time t (exact for constant spin). */
export function orientationAt(init: InitialState, t: number): Quat {
  const w = len(init.omega);
  if (w < 1e-12) return init.q0;
  return qNorm(qMul(qAxisAngle(init.omega, w * t), init.q0));
}

interface Forces {
  a: Vec3;
  fDrag: Vec3;
  fMagnus: Vec3;
  fSeam: Vec3;
}

function forces(init: InitialState, t: number, v: Vec3, o: PhysicsOptions): Forces {
  const aero = o.aero ?? NATHAN_AERO;
  const vr = sub(v, o.wind);
  const speed = len(vr);
  const k = 0.5 * o.airDensity * BALL_AREA;
  const wMag = len(init.omega);
  const cd = dragCoefficient(wMag, aero);
  const fDrag = scale(vr, -k * cd * speed);
  let fMagnus: Vec3 = [0, 0, 0];
  let fSeam: Vec3 = [0, 0, 0];
  if (speed > 1e-9) {
    const vh = scale(vr, 1 / speed);
    if (o.magnus && wMag > 0) {
      const wPerp = sub(init.omega, scale(vh, dot(init.omega, vh)));
      const wp = len(wPerp);
      if (wp > 1e-12) {
        const cl = liftCoefficient(wp, speed, aero);
        fMagnus = scale(norm(cross(wPerp, vh)), k * cl * speed * speed);
      }
    }
    if (o.seam) {
      const R = qToMat(orientationAt(init, t));
      fSeam = scale(seamForceCoefficient(R, vh, o.seam), k * speed * speed);
    }
  }
  const fTot = add(add(fDrag, fMagnus), fSeam);
  const a: Vec3 = [fTot[0] / BALL_MASS, fTot[1] / BALL_MASS - G, fTot[2] / BALL_MASS];
  return { a, fDrag, fMagnus, fSeam };
}

/** Cubic Hermite position between two samples at fraction s. */
function hermite(p0: Vec3, v0: Vec3, p1: Vec3, v1: Vec3, h: number, s: number): Vec3 {
  const s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  return [0, 1, 2].map((i) => h00 * p0[i] + h10 * h * v0[i] + h01 * p1[i] + h11 * h * v1[i]) as Vec3;
}
function hermiteVel(p0: Vec3, v0: Vec3, p1: Vec3, v1: Vec3, h: number, s: number): Vec3 {
  const s2 = s * s;
  const d00 = 6 * s2 - 6 * s, d10 = 3 * s2 - 4 * s + 1, d01 = -6 * s2 + 6 * s, d11 = 3 * s2 - 2 * s;
  return [0, 1, 2].map((i) => (d00 * p0[i] + d01 * p1[i]) / h + d10 * v0[i] + d11 * v1[i]) as Vec3;
}

function interpolateCrossing(a: Sample, b: Sample, h: number, zTarget: number): Crossing {
  // Solve z(s) = zTarget on [0, 1] by bisection + Newton on the Hermite cubic (monotone over one step).
  let lo = 0, hi = 1, s = (a.p[2] - zTarget) / (a.p[2] - b.p[2]);
  for (let i = 0; i < 40; i++) {
    const z = hermite(a.p, a.v, b.p, b.v, h, s)[2] - zTarget;
    if (Math.abs(z) < 1e-12) break;
    if (z > 0) lo = s; else hi = s;
    const dzds = hermiteVel(a.p, a.v, b.p, b.v, h, s)[2] * h; // dz/ds = v_z * h
    let ns = dzds !== 0 ? s - z / dzds : (lo + hi) / 2;
    if (!(ns > lo && ns < hi)) ns = (lo + hi) / 2;
    s = ns;
  }
  return { t: a.t + s * h, p: hermite(a.p, a.v, b.p, b.v, h, s), v: hermiteVel(a.p, a.v, b.p, b.v, h, s) };
}

export function simulate(init: InitialState, o: PhysicsOptions): Trajectory {
  const h = o.dt;
  const overrun = o.overrun ?? 0.6;
  let t = 0;
  let p = init.p, v = init.v;
  const f0 = forces(init, 0, v, o);
  const samples: Sample[] = [{ t, p, v, fDrag: f0.fDrag, fMagnus: f0.fMagnus, fSeam: f0.fSeam }];
  let crossing: Crossing | null = null;
  let grounded = false;
  const maxSteps = Math.ceil(3 / h);
  for (let n = 0; n < maxSteps; n++) {
    // RK4 on (p, v); acceleration depends on (t, v) only.
    const k1v = forces(init, t, v, o).a, k1p = v;
    const v2 = add(v, scale(k1v, h / 2));
    const k2v = forces(init, t + h / 2, v2, o).a, k2p = v2;
    const v3 = add(v, scale(k2v, h / 2));
    const k3v = forces(init, t + h / 2, v3, o).a, k3p = v3;
    const v4 = add(v, scale(k3v, h));
    const k4v = forces(init, t + h, v4, o).a, k4p = v4;
    p = add(p, scale(add(add(k1p, scale(k2p, 2)), add(scale(k3p, 2), k4p)), h / 6));
    v = add(v, scale(add(add(k1v, scale(k2v, 2)), add(scale(k3v, 2), k4v)), h / 6));
    t = (n + 1) * h; // avoid accumulated floating-point drift in t
    const f = forces(init, t, v, o);
    const s: Sample = { t, p, v, fDrag: f.fDrag, fMagnus: f.fMagnus, fSeam: f.fSeam };
    const prev = samples[samples.length - 1];
    samples.push(s);
    if (!crossing && prev.p[2] >= PLATE_FRONT_Z && p[2] < PLATE_FRONT_Z) {
      crossing = interpolateCrossing(prev, s, h, PLATE_FRONT_Z);
    }
    if (p[1] <= 0) { if (!crossing) grounded = true; break; }
    if (p[2] < PLATE_FRONT_Z - overrun) break;
  }
  return { init, dt: h, samples, crossing, grounded };
}

/** Trajectory state at an arbitrary time by Hermite interpolation of the fixed-step samples. */
export function stateAt(traj: Trajectory, t: number): { p: Vec3; v: Vec3; i: number; s: number } {
  const S = traj.samples;
  if (t <= 0) return { p: S[0].p, v: S[0].v, i: 0, s: 0 };
  const last = S[S.length - 1];
  if (t >= last.t) return { p: last.p, v: last.v, i: S.length - 1, s: 0 };
  const i = Math.min(S.length - 2, Math.floor(t / traj.dt));
  const a = S[i], b = S[i + 1];
  const s = (t - a.t) / (b.t - a.t);
  return { p: hermite(a.p, a.v, b.p, b.v, b.t - a.t, s), v: hermiteVel(a.p, a.v, b.p, b.v, b.t - a.t, s), i, s };
}

export function flightEnd(traj: Trajectory): number {
  return traj.crossing ? traj.crossing.t : traj.samples[traj.samples.length - 1].t;
}
