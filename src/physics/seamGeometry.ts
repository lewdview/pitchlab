// Baseball seam geometry shared by rendering and the seam-dependent force model.
//
// The seam is modelled with the classic closed "tennis-ball" curve on the unit sphere
//   x = a cos t + b cos 3t,   y = a sin t - b sin 3t,   z = c sin 2t,
// with a = 1 - b and c = 2 sqrt(a b), which lies exactly on the unit sphere and splits it into two
// congruent halves (the two figure-eight leather panels). b = 0.25 gives horseshoe-shaped panels with
// the property that matters for pitching: a four-seam axis (4 crossings/rev) and two-seam axes (2 crossings/rev).
//
// Body frame: the curve has 2-fold symmetry about the body x, y and z axes.
//   * Spin about body z        -> four-seam pattern (four seam crossings per revolution)
//   * Spin about body x or y   -> two-seam pattern (two crossings per revolution)
// (see seamCrossings() — verified in tests.)

import type { Vec3, Quat } from './vec';
import { qRotate, dot, norm, cross } from './vec';

export const SEAM_B = 0.25;

export function seamPoint(t: number, b = SEAM_B): Vec3 {
  const a = 1 - b;
  const c = 2 * Math.sqrt(a * b);
  const p: Vec3 = [a * Math.cos(t) + b * Math.cos(3 * t), a * Math.sin(t) - b * Math.sin(3 * t), c * Math.sin(2 * t)];
  return norm(p);
}

export function seamTangent(t: number): Vec3 {
  const h = 1e-4;
  const p1 = seamPoint(t + h);
  const p0 = seamPoint(t - h);
  return norm([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]);
}

/** Evenly spaced (in parameter t) samples of the seam, body frame, unit sphere. */
export function seamSamples(n: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) out.push(seamPoint((2 * Math.PI * i) / n));
  return out;
}

/** Count how many times the great circle perpendicular to `axisWorld` crosses the seam
 *  for a ball oriented by `q`. This is the number of seams that pass the front of the ball per revolution. */
export function seamCrossings(q: Quat, axisWorld: Vec3, n = 720): number {
  const ax = norm(axisWorld);
  let count = 0;
  const off = 1.234e-4; // avoid sampling exactly on symmetric zero crossings
  let prev = dot(qRotate(q, seamPoint(off)), ax);
  for (let i = 1; i <= n; i++) {
    const cur = dot(qRotate(q, seamPoint(off + (2 * Math.PI * i) / n)), ax);
    if (prev < 0 !== cur < 0) count++;
    prev = cur;
  }
  return count;
}

export type SeamPattern = 'four-seam' | 'two-seam' | 'other';

/** Classify the seam pattern presented to the flow when the ball spins about `axisWorld`. */
export function classifySeamPattern(q: Quat, axisWorld: Vec3): SeamPattern {
  const ax = norm(axisWorld);
  const near = (b: Vec3) => Math.abs(dot(qRotate(q, b), ax)) > 0.85;
  if (near([0, 0, 1])) return 'four-seam';
  if (near([1, 0, 0]) || near([0, 1, 0])) return 'two-seam';
  return seamCrossings(q, ax) >= 4 ? 'four-seam' : 'other';
}

/** Stitch geometry for rendering: for each stitch, two short segments forming a "V" across the seam. */
export function stitchSegments(count: number, radius: number, length: number): Vec3[] {
  const segs: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    const t = (2 * Math.PI * (i + 0.5)) / count;
    const p = seamPoint(t);
    const tan = seamTangent(t);
    const side = norm(cross(p, tan));
    const r = radius;
    const center: Vec3 = [p[0] * r, p[1] * r, p[2] * r];
    for (const s of [-1, 1]) {
      const a: Vec3 = [
        center[0] + side[0] * s * length * 0.9 - tan[0] * length * 0.45,
        center[1] + side[1] * s * length * 0.9 - tan[1] * length * 0.45,
        center[2] + side[2] * s * length * 0.9 - tan[2] * length * 0.45,
      ];
      const b: Vec3 = [
        center[0] + side[0] * s * length * 0.15 + tan[0] * length * 0.15,
        center[1] + side[1] * s * length * 0.15 + tan[1] * length * 0.15,
        center[2] + side[2] * s * length * 0.15 + tan[2] * length * 0.15,
      ];
      segs.push(a, b);
    }
  }
  return segs;
}
