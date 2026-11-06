// Hand pose for the grip visualisation (display only — never feeds the estimate or the physics).
//
// Units: ball radius = 1 (a baseball is ~2.9 in across, so 1 unit ≈ 1.45 in). Segment lengths are typical adult
// proportions: middle finger MCP→tip ≈ 3.2 in, thumb CMC→tip ≈ 4.0 in, palm ≈ 3.3 in wide.
//
// Method
//  1. Palm frame from the contacts: the palm faces the ball from between the finger-pad centroid g and the thumb t
//     (d = normalize(g + t)); fingers point along u ∝ (g − t) ⟂ d; the little-finger side is fixed anatomically
//     (w = u × d for a right hand, mirrored for a left hand), so crossing fingers on the ball looks crossed.
//  2. Palm distance is solved so each finger's wrap-around path length best matches its real length.
//  3. Each finger follows a "belt" path: a straight run from its knuckle to the tangent point on an offset sphere
//     (ball + finger thickness), then along the great circle to the contact. Joints are placed along that path at
//     anatomical phalanx proportions, so fingers bend around the ball instead of passing through it.
//  4. Contact type changes the distal phalanx: pad (lies along the surface), fingertip (≈50° to the surface),
//     fingernail (nearly perpendicular, nail digs in), bent finger (the DIP knuckle touches, tip curls back).
//     Disabled fingers curl into the palm.

import type { Vec3 } from '../physics/vec';
import { add, sub, scale, dot, cross, len, norm, qAxisAngle, qRotate } from '../physics/vec';
import { FINGERS, toWorld, type FingerContact, type FingerId } from './types';
import type { Hand } from '../physics/simulate';

export const FINGER_LEN: Record<FingerId, number> = { thumb: 2.75, index: 2.0, middle: 2.2, ring: 2.05, little: 1.65 };
// Half the finger width at the base, in ball radii (adult male: ~0.8 in across the middle-finger knuckle).
export const FINGER_RADIUS: Record<FingerId, number> = { thumb: 0.29, index: 0.25, middle: 0.255, ring: 0.24, little: 0.21 };
const PROPORTIONS: Record<FingerId, [number, number, number]> = {
  thumb: [0.44, 0.31, 0.25], index: [0.46, 0.29, 0.25], middle: [0.46, 0.3, 0.24], ring: [0.46, 0.29, 0.25], little: [0.45, 0.3, 0.25],
};
const MCP_OFFSET: Record<Exclude<FingerId, 'thumb'>, [number, number]> = {
  // [across palm (index side −, little side +) as fraction of half-width, drop below the knuckle line]
  index: [-0.76, 0.06], middle: [-0.25, 0], ring: [0.26, 0.07], little: [0.74, 0.22],
};
export const PALM = { width: 2.25, length: 2.55, thickness: 0.62 };

export interface FingerPose {
  id: FingerId;
  enabled: boolean;
  /** Base (MCP; CMC for the thumb), then 3 joints ending at the fingertip. */
  joints: Vec3[];
  radius: number;
  /** Nail plate on the distal phalanx: centre, along-finger axis, outward (dorsal) normal. */
  nail: { center: Vec3; along: Vec3; out: Vec3 };
  contactGap: number; // distance from fingertip surface to the contact point (diagnostic)
}

export interface HandPose {
  palmCenter: Vec3;
  u: Vec3; // toward the fingers
  w: Vec3; // toward the little finger
  n: Vec3; // palm normal, toward the ball
  size: number;
  wrist: Vec3;
  forearmEnd: Vec3;
  thenar: { center: Vec3; radius: number };
  fingers: FingerPose[];
}

const rotate = (v: Vec3, axis: Vec3, a: number) => qRotate(qAxisAngle(axis, a), v);
const angle = (a: Vec3, b: Vec3) => Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b)))));
const perp = (v: Vec3, n: Vec3) => sub(v, scale(n, dot(v, n)));
const anyPerp = (v: Vec3): Vec3 => norm(Math.abs(v[1]) < 0.9 ? cross(v, [0, 1, 0]) : cross(v, [1, 0, 0]));

interface Path { length: number; at: (s: number) => Vec3 }

/** Shortest path from M to T that does not enter the sphere of radius rho (straight run + great-circle arc). */
export function wrapPath(M: Vec3, T: Vec3, rho: number): Path {
  const m = len(M);
  const straight = (): Path => {
    const L = len(sub(T, M));
    return { length: L, at: (s) => add(M, scale(sub(T, M), L > 0 ? s / L : 0)) };
  };
  if (m <= rho * 1.0001) return straight();
  const Mh = scale(M, 1 / m), Th = norm(T);
  const theta = angle(Mh, Th);
  const alpha = Math.acos(rho / m);
  // straight segment clear of the sphere?
  if (theta <= alpha) return straight();
  let axis = cross(Mh, Th);
  axis = len(axis) < 1e-9 ? anyPerp(Mh) : norm(axis);
  const W = scale(rotate(Mh, axis, alpha), rho);
  const sLen = Math.sqrt(m * m - rho * rho);
  const phi = theta - alpha;
  const rT = len(T);
  const total = sLen + rho * phi;
  return {
    length: total,
    at: (s) => {
      if (s <= sLen) return add(M, scale(sub(W, M), sLen > 0 ? s / sLen : 0));
      const k = Math.min(1, (s - sLen) / Math.max(1e-9, rho * phi));
      const r = rho + (rT - rho) * k;
      return scale(rotate(norm(W), axis, k * phi), r);
    },
  };
}

export function placeJoints(path: Path, props: number[]): Vec3[] {
  const total = props.reduce((a, b) => a + b, 0);
  const pts: Vec3[] = [path.at(0)];
  let acc = 0;
  for (const p of props) {
    acc += p;
    pts.push(path.at((acc / total) * path.length));
  }
  return pts;
}

/** Middle phalanx: from the DIP joint back toward the knuckle M, leaving the ball's surface at angle `lift`. */
function middleBack(dip: Vec3, M: Vec3, lift: number, Lm: number, r: number): Vec3 {
  const dh = norm(dip);
  let tb = perp(sub(M, dip), dh);
  tb = len(tb) < 1e-6 ? anyPerp(dh) : norm(tb);
  const dir = norm(add(scale(tb, Math.cos(lift)), scale(dh, Math.sin(lift))));
  return clearOfBall(add(dip, scale(dir, Lm)), r);
}

/** Distal phalanx pad lying on the ball: DIP is Ld back from the tip along the great circle toward M. */
function distalOnSurface(T: Vec3, M: Vec3, Ld: number, rho: number): Vec3 {
  const Th = norm(T);
  let axis = cross(Th, norm(M));
  axis = len(axis) < 1e-6 ? anyPerp(Th) : norm(axis);
  // never wrap past the knuckle's direction (short thumbs/close knuckles)
  const maxA = 0.75 * angle(Th, M);
  // the pad touches at the tip; the DIP sits slightly off the leather so the finger reads as curled
  return scale(rotate(Th, axis, Math.min(Ld / rho, maxA)), rho * 1.05);
}

/** Push any joint that ended up inside the ball (plus finger thickness) back out to the surface. */
function clearOfBall(p: Vec3, r: number): Vec3 {
  const l = len(p);
  return l < 1 + r ? scale(norm(p), 1 + r) : p;
}

interface Frame { d: Vec3; u: Vec3; w: Vec3; n: Vec3 }

function palmFrame(vec: Record<FingerId, Vec3>, fingers: Record<FingerId, FingerContact>, hand: Hand): Frame {
  let g: Vec3 = [0, 0, 0];
  for (const id of FINGERS) {
    if (id === 'thumb' || !fingers[id].enabled) continue;
    g = add(g, scale(vec[id], 0.25 + fingers[id].pressure));
  }
  if (len(g) < 1e-6) g = [0, 0.6, 0.8];
  g = norm(g);
  const t = fingers.thumb.enabled ? vec.thumb : norm(add(scale(g, -1), [0, 0, 0.6]));
  let d = add(g, t);
  if (len(d) < 0.15) d = add(d, perp([0, 0, 1], g)); // fingers and thumb diametrically opposed
  d = norm(d);
  let u = perp(sub(g, t), d);
  if (len(u) < 1e-6) u = perp([0, 1, 0], d);
  u = norm(u);
  const w = scale(norm(cross(u, d)), hand === 'R' ? 1 : -1);
  return { d, u, w, n: scale(d, -1) };
}

function basePoints(f: Frame, D: number, s: number) {
  // The knuckle line sits at distance D along d; the palm hangs below it (toward the wrist).
  const halfL = (PALM.length * s) / 2, halfW = (PALM.width * s) / 2;
  const K = scale(f.d, D);
  const P = sub(K, scale(f.u, halfL * 0.95));
  const mcp = {} as Record<FingerId, Vec3>;
  for (const id of ['index', 'middle', 'ring', 'little'] as const) {
    const [o, drop] = MCP_OFFSET[id];
    mcp[id] = add(add(add(K, scale(f.u, -drop * s)), scale(f.w, o * halfW)), scale(f.n, 0.05 * s));
  }
  // thumb CMC: at the heel of the palm on the index side, set forward toward the ball (thenar)
  mcp.thumb = add(add(add(P, scale(f.u, -0.45 * halfL)), scale(f.w, -0.62 * halfW)), scale(f.n, 0.42 * s));
  return { P, mcp };
}

function tipTarget(id: FingerId, c: Vec3, s: number) {
  const r = FINGER_RADIUS[id] * s;
  return { T: scale(c, 1 + r * 0.92), r };
}

/** Pose of one finger reaching contact c from base M. */
function fingerPose(id: FingerId, f: FingerContact, M: Vec3, c: Vec3, frame: Frame, s: number): FingerPose {
  const L = FINGER_LEN[id] * s;
  const props = PROPORTIONS[id];
  const r = FINGER_RADIUS[id] * s;
  const rho = 1 + r * 1.12;
  const Ld = props[2] * L;
  let joints: Vec3[];
  if (!f.enabled) {
    // curled into the palm
    const segs = props.map((p) => p * L);
    const angles = id === 'thumb' ? [0.35, 0.9, 1.3] : [1.15, 2.45, 3.45];
    const base = id === 'thumb' ? norm(add(frame.u, scale(frame.w, -0.6))) : frame.u;
    joints = [M];
    let p = M;
    for (let i = 0; i < 3; i++) {
      const dir = norm(add(scale(base, Math.cos(angles[i])), scale(frame.n, Math.sin(angles[i]))));
      p = add(p, scale(dir, segs[i]));
      joints.push(p);
    }
  } else {
    const { T } = tipTarget(id, c, s);
    let tanToBase = perp(sub(M, T), c); // along the surface, back toward the knuckle
    tanToBase = len(tanToBase) < 1e-6 ? anyPerp(c) : norm(tanToBase);
    const Lm = props[1] * L;
    if (f.contact === 'pad' || id === 'thumb') {
      // finger pad on the ball; middle phalanx rises off the surface toward the knuckle (flexed PIP)
      const dip = distalOnSurface(T, M, Ld, rho);
      joints = [M, middleBack(dip, M, id === 'thumb' ? 0.35 : 0.55, Lm, r), dip, T];
    } else if (f.contact === 'knuckle') {
      // bent finger: the DIP knuckle presses the ball, the distal phalanx folds back toward the palm
      const dip = scale(c, 1 + r * 0.95);
      const tipDir = norm(add(add(scale(c, 0.55), scale(tanToBase, 0.7)), scale(frame.n, -0.2)));
      joints = [M, middleBack(dip, M, 0.55, Lm, r), dip, add(dip, scale(tipDir, Ld))];
    } else {
      // fingertip / fingernail: distal phalanx stands up off the surface
      const lean = f.contact === 'fingernail' ? 0.25 : 0.8; // radians from the surface normal
      const dip = add(T, scale(norm(add(scale(c, Math.cos(lean)), scale(tanToBase, Math.sin(lean)))), Ld));
      joints = [M, middleBack(dip, M, 0.35, Lm, r), dip, T];
    }
  }
  joints = joints.map((p, i) => (i === 0 ? p : clearOfBall(p, r * 0.98)));
  // nail on the dorsal side of the distal phalanx
  const a = joints[2], b = joints[3];
  const along = norm(sub(b, a));
  const prox = norm(sub(joints[1], joints[0]));
  let palmSide = perp(sub(along, prox), along); // flexion bends toward the palm side
  if (len(palmSide) < 1e-3) palmSide = perp(frame.n, along);
  if (len(palmSide) < 1e-6) palmSide = anyPerp(along);
  let out = scale(norm(palmSide), -1);
  if (f.enabled && f.contact === 'pad' && id !== 'thumb') {
    // pad contact: the nail must face away from the ball
    const mid = scale(add(a, b), 0.5);
    if (dot(out, norm(mid)) < 0) out = scale(out, -1);
  }
  if (f.enabled && f.contact === 'fingernail') {
    // the nail edge is what touches: tilt the nail toward the ball
    out = norm(add(out, scale(norm(b), -0.4)));
  }
  const nailCenter = add(add(b, scale(along, -Ld * 0.28)), scale(out, r * 0.82));
  const gap = len(b) - r - 1;
  return { id, enabled: f.enabled, joints, radius: r, nail: { center: nailCenter, along, out }, contactGap: gap };
}

export function buildHandPose(fingers: Record<FingerId, FingerContact>, hand: Hand, size = 1): HandPose {
  const s = size;
  const vec = {} as Record<FingerId, Vec3>;
  for (const id of FINGERS) vec[id] = toWorld(fingers[id], hand);
  const frame = palmFrame(vec, fingers, hand);
  // palm distance: best match between wrap-path lengths and real finger lengths
  let bestD = 1.6, bestErr = Infinity;
  const minD = 1 + FINGER_RADIUS.middle * s + 0.05;
  for (let D = minD; D <= 3.4; D += 0.02) {
    const { mcp } = basePoints(frame, D, s);
    let err = 0, n = 0;
    for (const id of FINGERS) {
      if (!fingers[id].enabled) continue;
      const pose = fingerPose(id, fingers[id], mcp[id], vec[id], frame, s);
      const want = PROPORTIONS[id][0] * FINGER_LEN[id] * s;
      const e = (len(sub(pose.joints[1], pose.joints[0])) - want) / want;
      err += (id === 'thumb' ? 0.6 : 1) * e * e;
      n++;
    }
    if (n === 0) { bestD = 1.7; break; }
    if (err < bestErr - 1e-12) { bestErr = err; bestD = D; }
  }
  const { P, mcp } = basePoints(frame, bestD, s);
  const poses = FINGERS.map((id) => fingerPose(id, fingers[id], mcp[id], vec[id], frame, s));
  const halfL = (PALM.length * s) / 2;
  const wrist = add(P, scale(frame.u, -halfL * 1.02));
  const thumb = poses[0];
  return {
    palmCenter: P,
    u: frame.u, w: frame.w, n: frame.n, size: s,
    wrist,
    forearmEnd: add(wrist, scale(frame.u, -3.2 * s)),
    thenar: { center: scale(add(add(thumb.joints[0], thumb.joints[1]), scale(P, 0.6)), 1 / 2.6), radius: 0.55 * s },
    fingers: poses,
  };
}
