import type { Vec3 } from '../physics/vec';
import type { Trajectory } from '../physics/simulate';

/** Reference-trajectory position at a given z (linear interpolation of fixed-step samples; z decreases with t). */
export function refAtZ(ref: Trajectory, z: number): Vec3 {
  const S = ref.samples;
  if (z >= S[0].p[2]) return S[0].p;
  let lo = 0, hi = S.length - 1;
  if (z <= S[hi].p[2]) return S[hi].p;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (S[mid].p[2] > z) lo = mid; else hi = mid;
  }
  const a = S[lo].p, b = S[hi].p;
  const s = (a[2] - z) / (a[2] - b[2]);
  return [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, z];
}

/** Exaggerate lateral/vertical deviation from the no-lift reference by factor k (display only). */
export function exaggerate(p: Vec3, ref: Trajectory, k: number): Vec3 {
  if (k === 1) return p;
  const r = refAtZ(ref, p[2]);
  return [r[0] + (p[0] - r[0]) * k, r[1] + (p[1] - r[1]) * k, p[2]];
}

export function pathPoints(traj: Trajectory, ref: Trajectory, k: number, stride = 3, tMax?: number): Vec3[] {
  const out: Vec3[] = [];
  const S = traj.samples;
  const end = tMax ?? Infinity;
  for (let i = 0; i < S.length; i += stride) {
    if (S[i].t > end) break;
    out.push(exaggerate(S[i].p, ref, k));
  }
  const last = S[S.length - 1];
  if (last.t <= end && out.length && out[out.length - 1] !== last.p) out.push(exaggerate(last.p, ref, k));
  return out;
}
