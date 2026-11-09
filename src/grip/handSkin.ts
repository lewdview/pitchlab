// One continuous skin surface for the hand (display only).
//
// The hand pose (handModel.ts) is turned into a signed-distance field: every finger bone is a tapered "round cone",
// the palm, fleshy heels and thumb base are ellipsoids, and the knuckle ridge and wrist are round cones. Parts are
// blended with a smooth minimum so they flow into each other like skin:
//   palm parts with each other   k = 0.25 (very soft)
//   bones within one finger      k = 0.05 (smooth knuckles)
//   each finger into the palm    k = 0.14 (webbing at the base of the finger only)
//   fingers with each other      plain min (no webbing between neighbouring fingers)
// The field is sampled on a voxel grid (only near each part, for speed) and polygonised with marching cubes.

import type { Vec3 } from '../physics/vec';
import { add, sub, scale, dot, cross } from '../physics/vec';
import { PALM, type HandPose } from './handModel';

export interface SkinField {
  /** Field values for MarchingCubes: positive inside, isolation 0. Length size^3, index x + y*size + z*size^2. */
  field: Float32Array;
  size: number;
  center: Vec3;
  /** Half the side of the cubic grid in world units. */
  half: number;
}

export type Prim = { lo: Vec3; hi: Vec3; d: (x: number, y: number, z: number) => number; color?: Vec3 };

const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};

/** Exact SDF of a round cone (capsule with different end radii), after Inigo Quilez. */
export function roundCone(a: Vec3, b: Vec3, r1: number, r2: number): Prim {
  const ba = sub(b, a);
  const l2 = dot(ba, ba);
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / Math.max(l2, 1e-12);
  const m = Math.max(r1, r2);
  return {
    lo: [Math.min(a[0], b[0]) - m, Math.min(a[1], b[1]) - m, Math.min(a[2], b[2]) - m],
    hi: [Math.max(a[0], b[0]) + m, Math.max(a[1], b[1]) + m, Math.max(a[2], b[2]) + m],
    d: (x, y, z) => {
      const pax = x - a[0], pay = y - a[1], paz = z - a[2];
      const yy = pax * ba[0] + pay * ba[1] + paz * ba[2];
      const zz = yy - l2;
      const xvx = pax * l2 - ba[0] * yy, xvy = pay * l2 - ba[1] * yy, xvz = paz * l2 - ba[2] * yy;
      const x2 = xvx * xvx + xvy * xvy + xvz * xvz;
      const y2 = yy * yy * l2, z2 = zz * zz * l2;
      const k = Math.sign(rr) * rr * rr * x2;
      if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
      if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
      return (Math.sqrt(Math.max(0, x2 * a2 * il2)) + yy * rr) * il2 - r1;
    },
  };
}

/** Approximate SDF of an ellipsoid with semi-axes r along the orthonormal axes ex, ey, ez. */
export function ellipsoid(c: Vec3, ex: Vec3, ey: Vec3, ez: Vec3, r: Vec3): Prim {
  const m = Math.max(r[0], r[1], r[2]);
  return {
    lo: [c[0] - m, c[1] - m, c[2] - m],
    hi: [c[0] + m, c[1] + m, c[2] + m],
    d: (x, y, z) => {
      const px = x - c[0], py = y - c[1], pz = z - c[2];
      const lx = (px * ex[0] + py * ex[1] + pz * ex[2]) / r[0];
      const ly = (px * ey[0] + py * ey[1] + pz * ey[2]) / r[1];
      const lz = (px * ez[0] + py * ez[1] + pz * ez[2]) / r[2];
      const k0 = Math.sqrt(lx * lx + ly * ly + lz * lz);
      const k1 = Math.sqrt((lx / r[0]) ** 2 + (ly / r[1]) ** 2 + (lz / r[2]) ** 2);
      return k1 < 1e-9 ? -Math.min(r[0], r[1], r[2]) : (k0 * (k0 - 1)) / k1;
    },
  };
}

/** Radii along a finger from knuckle to tip. */
export function fingerRadii(radius: number, thumb: boolean): number[] {
  const r = radius;
  return thumb ? [r * 1.2, r * 1.04, r * 0.96, r * 0.9] : [r * 1.0, r * 0.94, r * 0.89, r * 0.86];
}

/** Round cone with an elliptical cross-section: squashed by `f` along `dorsal` (fingers are wider than deep). */
function flatRoundCone(a: Vec3, b: Vec3, r1: number, r2: number, dorsal: Vec3, f: number): Prim {
  const k = 1 / f - 1;
  const stretch = (p: Vec3): Vec3 => { const t = (p[0] - a[0]) * dorsal[0] + (p[1] - a[1]) * dorsal[1] + (p[2] - a[2]) * dorsal[2]; return [p[0] + dorsal[0] * t * k, p[1] + dorsal[1] * t * k, p[2] + dorsal[2] * t * k]; };
  const inner = roundCone(a, stretch(b), r1, r2);
  const base = roundCone(a, b, r1, r2);
  return {
    lo: base.lo, hi: base.hi,
    d: (x, y, z) => { const q = stretch([x, y, z]); return inner.d(q[0], q[1], q[2]) * f; },
  };
}

/** Skin tones (linear RGB for vertex colours): knuckles and fingertip pads are a little pinker, the palm lighter. */
const tone = (hex: string): Vec3 => {
  const v = parseInt(hex.slice(1), 16);
  const lin = (c: number) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  return [lin((v >> 16) & 255), lin((v >> 8) & 255), lin(v & 255)];
};
export const SKIN = { base: tone('#d39b7a'), knuckle: tone('#d1937a'), pad: tone('#d89c84'), palm: tone('#d9a385') };
const painted = (pr: Prim, c: Vec3): Prim => ({ ...pr, color: c });

const BIG = 10;
const CLAMP = 0.3;
const MARGIN = 0.32;
let bufA: Float32Array | null = null;
let bufB: Float32Array | null = null;

let nearHand: Float32Array | null = null;

export function buildSkinField(pose: HandPose, size: number, out?: Float32Array, palette?: Float32Array): SkinField {
  const s = pose.size;
  const { u, w, n } = pose;
  const halfW = (PALM.width * s) / 2, halfL = (PALM.length * s) / 2, halfT = (PALM.thickness * s) / 2;
  const P = pose.palmCenter;

  const palmParts: Prim[] = [
    painted(ellipsoid(add(P, scale(u, 0.05 * halfL)), w, u, n, [halfW * 0.94, halfL * 1.0, halfT * 0.82]), SKIN.palm),
    painted(ellipsoid(add(add(add(P, scale(w, halfW * 0.5)), scale(u, -halfL * 0.42)), scale(n, halfT * 0.25)), w, u, n, [halfW * 0.46, halfL * 0.56, halfT * 1.05]), SKIN.palm),
    painted(ellipsoid(pose.thenar.center, w, u, n, [pose.thenar.radius, pose.thenar.radius * 1.4, pose.thenar.radius * 0.85]), SKIN.palm),
  ];
  const mcp = pose.fingers.slice(1);
  for (let i = 0; i < mcp.length - 1; i++) {
    palmParts.push(painted(roundCone(mcp[i].joints[0], mcp[i + 1].joints[0], mcp[i].radius * 1.08, mcp[i + 1].radius * 1.08), SKIN.base));
  }
  // knuckle heads on the back of the hand
  for (const f of mcp) palmParts.push(painted(ellipsoid(add(f.joints[0], scale(n, -f.radius * 0.3)), w, u, n, [f.radius * 0.75, f.radius * 0.8, f.radius * 0.55]), SKIN.knuckle));
  const forearmCut = add(pose.wrist, scale(sub(pose.forearmEnd, pose.wrist), 0.32));
  palmParts.push(painted(roundCone(add(pose.wrist, scale(u, 0.35 * s)), forearmCut, 0.62 * s, 0.7 * s), SKIN.base));

  const fingerParts: Prim[][] = pose.fingers.map((f) => {
    const thumb = f.id === 'thumb';
    const rad = fingerRadii(f.radius, thumb);
    const J = f.joints;
    const segs = [0, 1, 2].map((i) => sub(J[i + 1], J[i]));
    // lateral axis: perpendicular to the plane the finger bends in; dorsal = back of the finger
    let lat = cross(segs[0], segs[2]);
    if (Math.hypot(...lat) < 0.05 * Math.hypot(...segs[0]) * Math.hypot(...segs[2])) lat = w;
    const latN = scale(lat, 1 / (Math.hypot(...lat) || 1));
    const dorsals = segs.map((sg) => {
      let d = cross(latN, sg);
      const l = Math.hypot(...d) || 1;
      d = scale(d, 1 / l);
      return dot(d, f.nail.out) < 0 ? scale(d, -1) : d;
    });
    const F = 0.84;
    const parts: Prim[] = [0, 1, 2].map((i) => painted(flatRoundCone(J[i], J[i + 1], rad[i] * (i === 0 ? 1 : 0.97), rad[i + 1] * 0.97, dorsals[i], F), SKIN.base));
    // joint knuckles (slightly wider than the shafts) and a rounded fingertip pad
    for (const j of [1, 2]) {
      const along = scale(add(segs[j - 1], segs[j]), 0.5);
      const aN = scale(along, 1 / (Math.hypot(...along) || 1));
      parts.push(painted(ellipsoid(J[j], latN, aN, dorsals[j], [rad[j] * 1.0, rad[j] * 0.95, rad[j] * 0.86]), SKIN.knuckle));
    }
    const tipAlong = scale(segs[2], 1 / (Math.hypot(...segs[2]) || 1));
    parts.push(painted(ellipsoid(sub(J[3], scale(tipAlong, rad[3] * 0.25)), latN, tipAlong, dorsals[2], [rad[3] * 1.02, rad[3] * 1.3, rad[3] * 0.86]), SKIN.pad));
    if (thumb) parts.push(painted(ellipsoid(J[0], latN, scale(segs[0], 1 / (Math.hypot(...segs[0]) || 1)), dorsals[0], [rad[0], rad[0] * 1.2, rad[0] * 0.9]), SKIN.palm));
    return parts;
  });

  // cubic grid around everything
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of [...palmParts, ...fingerParts.flat()]) {
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p.lo[k]); hi[k] = Math.max(hi[k], p.hi[k]); }
  }
  const center: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const half = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 + MARGIN + 0.05;
  const hs = size / 2;
  const toWorld = (i: number, k: number) => center[k] + (half * (i - hs)) / hs;
  const toIndex = (v: number, k: number) => ((v - center[k]) / half) * hs + hs;
  const size2 = size * size, size3 = size2 * size;
  if (!bufA || bufA.length !== size3) { bufA = new Float32Array(size3); bufB = new Float32Array(size3); }
  const palm = bufA, total = bufB!;
  palm.fill(BIG);
  total.fill(BIG);
  if (palette && (!nearHand || nearHand.length !== size3)) nearHand = new Float32Array(size3);
  const near = palette ? nearHand! : null;
  if (palette && near) { near.fill(BIG); palette.fill(0); }
  const paint = (i: number, d: number, c?: Vec3) => {
    if (near && palette && c && d < near[i]) { near[i] = d; palette[i * 3] = c[0]; palette[i * 3 + 1] = c[1]; palette[i * 3 + 2] = c[2]; }
  };

  const range = (p: { lo: Vec3; hi: Vec3 }, k: number): [number, number] => [
    Math.max(1, Math.floor(toIndex(p.lo[k] - MARGIN, k))),
    Math.min(size - 2, Math.ceil(toIndex(p.hi[k] + MARGIN, k))),
  ];
  const visit = (p: { lo: Vec3; hi: Vec3 }, fn: (idx: number, x: number, y: number, z: number) => void) => {
    const [x0, x1] = range(p, 0), [y0, y1] = range(p, 1), [z0, z1] = range(p, 2);
    for (let z = z0; z <= z1; z++) {
      const wz = toWorld(z, 2);
      for (let y = y0; y <= y1; y++) {
        const wy = toWorld(y, 1);
        const row = z * size2 + y * size;
        for (let x = x0; x <= x1; x++) fn(row + x, toWorld(x, 0), wy, wz);
      }
    }
  };

  for (const pr of palmParts) visit(pr, (i, x, y, z) => { const d = pr.d(x, y, z); palm[i] = smin(palm[i], d, 0.22); paint(i, d, pr.color); });
  pose.fingers.forEach((f, fi) => {
    const parts = fingerParts[fi];
    const box = { lo: [...parts[0].lo] as Vec3, hi: [...parts[0].hi] as Vec3 };
    for (const pr of parts) for (let k = 0; k < 3; k++) { box.lo[k] = Math.min(box.lo[k], pr.lo[k]); box.hi[k] = Math.max(box.hi[k], pr.hi[k]); }
    const kPalm = f.id === 'thumb' ? 0.26 : 0.14; // the thumb web is broader than the finger bases
    visit(box, (i, x, y, z) => {
      let df = BIG;
      for (let pi = 0; pi < parts.length; pi++) {
        const d = parts[pi].d(x, y, z);
        df = pi < 3 ? smin(df, d, 0.05) : smin(df, d, 0.035);
        paint(i, d, parts[pi].color);
      }
      const comb = smin(palm[i], df, kPalm);
      if (comb < total[i]) total[i] = comb;
    });
  });
  const field = out && out.length === size3 ? out : new Float32Array(size3);
  for (let i = 0; i < size3; i++) {
    const d = Math.min(total[i], palm[i]);
    field[i] = Math.max(-CLAMP, Math.min(CLAMP, -d));
  }
  return { field, size, center, half };
}

/** Signed distance of the hand skin at a world point (for tests; slow). */
export function skinDistanceAt(sf: SkinField, p: Vec3): number {
  const hs = sf.size / 2;
  const idx = (k: number) => Math.round(((p[k] - sf.center[k]) / sf.half) * hs + hs);
  const x = idx(0), y = idx(1), z = idx(2);
  return -sf.field[x + y * sf.size + z * sf.size * sf.size];
}

let genBuf: Float32Array | null = null;
let nearBuf: Float32Array | null = null;

/** Generic smooth-union field of primitives (used for the pitcher's body). Same grid convention as buildSkinField. */
/** If `palette` is given (MarchingCubes.palette, linear RGB), each voxel takes the colour of the nearest primitive,
 *  so one smooth surface can carry several materials (jersey, pants, skin, ...). */
export function fieldFromPrims(prims: Prim[], size: number, k: number, out?: Float32Array, palette?: Float32Array): SkinField {
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of prims) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p.lo[a]); hi[a] = Math.max(hi[a], p.hi[a]); }
  const margin = Math.max(0.05, k * 2.5);
  const center: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const half = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 + margin * 1.5;
  const hs = size / 2, size2 = size * size, size3 = size2 * size;
  if (!genBuf || genBuf.length !== size3) genBuf = new Float32Array(size3);
  const total = genBuf;
  total.fill(BIG);
  if (palette && (!nearBuf || nearBuf.length !== size3)) nearBuf = new Float32Array(size3);
  const near = nearBuf;
  if (palette && near) { near.fill(BIG); palette.fill(0); }
  const toWorld = (i: number, a: number) => center[a] + (half * (i - hs)) / hs;
  const toIndex = (v: number, a: number) => ((v - center[a]) / half) * hs + hs;
  for (const p of prims) {
    const r = (a: number): [number, number] => [Math.max(1, Math.floor(toIndex(p.lo[a] - margin, a))), Math.min(size - 2, Math.ceil(toIndex(p.hi[a] + margin, a)))];
    const [x0, x1] = r(0), [y0, y1] = r(1), [z0, z1] = r(2);
    for (let z = z0; z <= z1; z++) {
      const wz = toWorld(z, 2);
      for (let y = y0; y <= y1; y++) {
        const wy = toWorld(y, 1), row = z * size2 + y * size;
        for (let x = x0; x <= x1; x++) {
          const i = row + x;
          const d = p.d(toWorld(x, 0), wy, wz);
          total[i] = smin(total[i], d, k);
          if (palette && near && p.color && d < near[i]) {
            near[i] = d;
            palette[i * 3] = p.color[0]; palette[i * 3 + 1] = p.color[1]; palette[i * 3 + 2] = p.color[2];
          }
        }
      }
    }
  }
  const voxel = (2 * half) / size;
  const clampV = Math.max(CLAMP * 0.2, voxel * 4);
  const field = out && out.length === size3 ? out : new Float32Array(size3);
  for (let i = 0; i < size3; i++) field[i] = Math.max(-clampV, Math.min(clampV, -total[i]));
  return { field, size, center, half };
}
