// Minimal vector / quaternion / matrix helpers. Pure functions, no rendering dependencies.
// World frame (SI, metres): origin at the back tip of home plate, ground level.
//   +x = pitcher's right = catcher's LEFT (third-base side), +y = up, +z = from plate toward the pitcher.
// (Right-handed: an observer at the plate facing +z has -x on their right.)
// A pitch travels in the -z direction.

export type Vec3 = [number, number, number];
/** Quaternion [w, x, y, z], unit length, rotating body-frame vectors into world frame. */
export type Quat = [number, number, number, number];
/** Row-major 3x3 matrix. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const v3 = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: Vec3): Vec3 => {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
export const deg = (r: number) => (r * 180) / Math.PI;
export const rad = (d: number) => (d * Math.PI) / 180;
export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export const qIdentity = (): Quat => [1, 0, 0, 0];
export const qMul = (a: Quat, b: Quat): Quat => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];
export const qNorm = (q: Quat): Quat => {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
};
export const qConj = (q: Quat): Quat => [q[0], -q[1], -q[2], -q[3]];
export const qAxisAngle = (axis: Vec3, angle: number): Quat => {
  const a = norm(axis);
  if (a[0] === 0 && a[1] === 0 && a[2] === 0) return qIdentity();
  const s = Math.sin(angle / 2);
  return [Math.cos(angle / 2), a[0] * s, a[1] * s, a[2] * s];
};
export const qRotate = (q: Quat, v: Vec3): Vec3 => {
  const [w, x, y, z] = q;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
};
export const qToMat = (q: Quat): Mat3 => {
  const [w, x, y, z] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
};
export const matMulVec = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
export const matMul = (a: Mat3, b: Mat3): Mat3 => {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
};
export const matToQuat = (m: Mat3): Quat => {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [0.25 * s, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [(m21 - m12) / s, 0.25 * s, (m01 + m10) / s, (m02 + m20) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m02 - m20) / s, (m01 + m10) / s, 0.25 * s, (m12 + m21) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, 0.25 * s];
  }
  return qNorm(q);
};

/** Euler angles (degrees) in Y-X-Z order: R = Ry(yaw) * Rx(pitch) * Rz(roll). */
export const qFromEuler = (yawDeg: number, pitchDeg: number, rollDeg: number): Quat =>
  qNorm(
    qMul(qMul(qAxisAngle([0, 1, 0], rad(yawDeg)), qAxisAngle([1, 0, 0], rad(pitchDeg))), qAxisAngle([0, 0, 1], rad(rollDeg))),
  );
export const qToEuler = (q: Quat): { yaw: number; pitch: number; roll: number } => {
  const m = qToMat(q);
  // For YXZ: m12 = -sin(pitch)
  const pitch = Math.asin(clamp(-m[5], -1, 1));
  let yaw: number, roll: number;
  if (Math.abs(m[5]) < 0.99999) {
    yaw = Math.atan2(m[2], m[8]);
    roll = Math.atan2(m[3], m[4]);
  } else {
    yaw = Math.atan2(-m[6], m[0]);
    roll = 0;
  }
  return { yaw: deg(yaw), pitch: deg(pitch), roll: deg(roll) };
};

/** Reflection across the world x = 0 plane. */
export const MIRROR_X: Mat3 = [-1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Shortest rotation taking unit vector a onto unit vector b. */
export const qFromTo = (a: Vec3, b: Vec3): Quat => {
  const u = norm(a), w = norm(b);
  const d = dot(u, w);
  if (d < -0.999999) {
    let axis = cross([1, 0, 0], u);
    if (len(axis) < 1e-6) axis = cross([0, 1, 0], u);
    return qAxisAngle(axis, Math.PI);
  }
  const c = cross(u, w);
  return qNorm([1 + d, c[0], c[1], c[2]]);
};
