// Seam-dependent aerodynamic force — dedicated low-spin (knuckleball) model.
//
// STATUS: QUALITATIVE APPROXIMATION WITH REPLACEABLE COEFFICIENTS. It has not been fitted to a measured
// coefficient table.
//
// What the published measurements tell us (and what this model encodes):
//  * Watts & Sawyer (1975), "Aerodynamics of a knuckleball", Am. J. Phys. 43, 960. Wind-tunnel tests on a
//    non-spinning baseball at ~21 m/s found a steady lateral force of order 0.1 lbf (~0.45 N) whose size and sign
//    depend on where the stitches sit relative to the flow. Near certain critical angles (~52°) the force
//    fluctuated in time. We model the steady, orientation-dependent part only. The fluctuating part is
//    deliberately NOT modelled with random noise (see "assumptions").
//  * Morrissey (2009, Marquette thesis) and Borg & Morrissey (2014), Am. J. Phys. 82, 921: lift and lateral
//    forces on slowly rotating (~50 rpm) two-seam and four-seam baseballs. The force direction changes as the
//    seams rotate slowly through the flow, and the size of the deflection depends on how far the ball
//    rotates during flight.
//  * Nathan (2012), PITCHf/x knuckleball analysis (Procedia Eng. 34): measured knuckleball paths are smooth.
//    Most do not change direction repeatedly.
//
// Model: each seam sample point sits at polar angle phi from the front stagnation point (phi = 0 faces into
// the flow). A seam just upstream of laminar separation trips the boundary layer. Separation is then delayed
// on that side, the wake shifts away, and the ball is pushed TOWARD that side (positive kernel lobe at
// phi_trip). A seam sitting at the separation line instead promotes early separation and pushes the ball AWAY
// from that side (negative lobe at phi_sep). Summing the kernel-weighted transverse direction of every seam sample gives a vector
// that cancels exactly for symmetric seam arrangements and varies continuously with orientation:
//
//   S = (1/N) * sum_i w(phi_i) * n_i,   w(phi) = exp(-((phi - phiTrip)/wTrip)^2) - kSep * exp(-((phi - phiSep)/wSep)^2)
//   F_seam = 1/2 rho A |v|^2 * C_peak * S / S_max
//
// where n_i is the unit vector from the flow axis toward seam point i, and S_max is the largest |S| over all
// orientations (computed numerically). That makes C_peak the peak lateral force coefficient. The default
// C_peak = 0.20 is a qualitative choice. Watts & Sawyer's ~0.45 N at 21 m/s corresponds to C ~ 0.4 at its
// most favourable orientation, so we default below that to stay conservative.
//
// Supported seam configurations (where the model is documented): two-seam and four-seam orientations rotating
// slowly (≲ 2 rev during flight) about an axis roughly perpendicular to the flight path. These are the
// configurations studied in the wind-tunnel work above. Other orientations and gyro-dominated axes are
// computed with the same geometry but are labelled as extrapolation.
//
// Assumptions: coefficient independent of Reynolds number over 25–40 m/s; quasi-steady (force follows
// the instantaneous orientation with no wake lag); no time-fluctuating or random component; seam height and
// seam width fixed; the force is perpendicular to the air-relative velocity.

import type { Vec3, Mat3 } from './vec';
import { seamSamples } from './seamGeometry';
import { dot, matMulVec } from './vec';

export interface SeamModelParams {
  /** Peak seam lateral-force coefficient C_peak (dimensionless). */
  peakCoeff: number;
  /** Trip-lobe centre angle from the front stagnation point (deg). */
  tripAngleDeg: number;
  tripWidthDeg: number;
  /** Separation-lobe centre angle (deg). */
  sepAngleDeg: number;
  sepWidthDeg: number;
  /** Relative weight of the separation lobe (dimensionless). */
  sepWeight: number;
}

export const DEFAULT_SEAM_PARAMS: SeamModelParams = {
  peakCoeff: 0.2,
  tripAngleDeg: 75,
  tripWidthDeg: 12,
  sepAngleDeg: 106,
  sepWidthDeg: 8,
  sepWeight: 0.6,
};

export const SEAM_N = 120;
const BODY_SEAM = seamSamples(SEAM_N);

/** Un-normalised seam asymmetry vector S (world frame) for body->world rotation matrix R and flow direction vHat
 *  (unit vector of the ball's air-relative velocity). */
export function seamAsymmetry(R: Mat3, vHat: Vec3, p: SeamModelParams): Vec3 {
  const toRad = Math.PI / 180;
  const pt = p.tripAngleDeg * toRad, wt = p.tripWidthDeg * toRad;
  const ps = p.sepAngleDeg * toRad, ws = p.sepWidthDeg * toRad;
  let sx = 0, sy = 0, sz = 0;
  for (let i = 0; i < SEAM_N; i++) {
    const s = matMulVec(R, BODY_SEAM[i]);
    const c = dot(s, vHat);
    const phi = Math.acos(c > 1 ? 1 : c < -1 ? -1 : c);
    const a = (phi - pt) / wt;
    const b = (phi - ps) / ws;
    const w = Math.exp(-a * a) - p.sepWeight * Math.exp(-b * b);
    if (Math.abs(w) < 1e-6) continue;
    // transverse direction from the flow axis toward the seam point
    let nx = s[0] - c * vHat[0], ny = s[1] - c * vHat[1], nz = s[2] - c * vHat[2];
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-9) continue;
    nx /= nl; ny /= nl; nz /= nl;
    sx += w * nx; sy += w * ny; sz += w * nz;
  }
  return [sx / SEAM_N, sy / SEAM_N, sz / SEAM_N];
}

const smaxCache = new Map<string, number>();

/** Largest |S| over a deterministic, dense set of flow directions in the body frame. */
export function seamAsymmetryMax(p: SeamModelParams): number {
  const key = [p.tripAngleDeg, p.tripWidthDeg, p.sepAngleDeg, p.sepWidthDeg, p.sepWeight].join('|');
  const hit = smaxCache.get(key);
  if (hit !== undefined) return hit;
  const I: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  let best = 1e-9;
  const n = 1500;
  for (let i = 0; i < n; i++) {
    const th = Math.acos(1 - (2 * (i + 0.5)) / n);
    const ph = i * 2.399963229728653; // golden angle
    const d: Vec3 = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
    const S = seamAsymmetry(I, d, p);
    best = Math.max(best, Math.hypot(S[0], S[1], S[2]));
  }
  smaxCache.set(key, best);
  return best;
}

/** Seam force coefficient vector (dimensionless, world frame): multiply by 1/2 rho A |v|^2 for newtons. */
export function seamForceCoefficient(R: Mat3, vHat: Vec3, p: SeamModelParams): Vec3 {
  const S = seamAsymmetry(R, vHat, p);
  const k = p.peakCoeff / seamAsymmetryMax(p);
  return [S[0] * k, S[1] * k, S[2] * k];
}
