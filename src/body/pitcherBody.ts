// Pitcher body at release (display + delivery geometry; never feeds the flight physics directly).
//
// A simple, documented anthropometric model scaled by standing height H (segment ratios after Winter,
// "Biomechanics and Motor Control of Human Movement"): upper arm 0.186 H, forearm 0.146 H, thigh 0.245 H,
// shank 0.246 H, shoulder width 0.20 H. Release posture is a representative one, not a measured motion capture:
//   * stride length 0.85 H toward the plate, front knee flexed, trunk tilted forward ~30°;
//   * throwing shoulder height above the mound ≈ 0.58 H (forward trunk tilt lowers it from 0.82 H standing);
//   * the arm reaches 0.42 H from shoulder to ball, angled ~35° forward of the frontal plane.
//
// Arm slot θ is the angle of the shoulder→ball line from vertical, seen from behind the pitcher
// (0° = over the top, ~45° = three-quarter, ~90° = sidearm, >100° = submarine). With "link to body" on,
// release height and side follow from θ and H; editing height or side gives the implied θ instead.

import type { Vec3 } from '../physics/vec';
import { add, sub, scale, norm, len, cross, dot } from '../physics/vec';
import { MOUND_HEIGHT, RUBBER_TO_PLATE } from '../physics/constants';
import { armSideX, type Hand } from '../physics/simulate';

export interface BodySettings {
  /** Standing height, m. */
  heightM: number;
  /** Keep release height/side and arm slot consistent with the body. */
  link: boolean;
}

export const DEFAULT_BODY: BodySettings = { heightM: 1.88, link: true };

const REACH_FWD = (35 * Math.PI) / 180;
export const armReach = (H: number) => 0.42 * H;
export const shoulderHeight = (H: number) => MOUND_HEIGHT + 0.58 * H;
export const shoulderLateral = (H: number) => 0.17 * (H / 1.88);

/** Release height and arm-side offset for an arm slot (deg). */
export function releaseFromSlot(H: number, slotDeg: number): { releaseHeight: number; releaseSide: number } {
  const t = (slotDeg * Math.PI) / 180;
  const f = armReach(H) * Math.cos(REACH_FWD);
  return { releaseHeight: shoulderHeight(H) + f * Math.cos(t), releaseSide: shoulderLateral(H) + f * Math.sin(t) };
}

/** Arm slot (deg) implied by a release height / side for this body. */
export function slotFromRelease(H: number, releaseHeight: number, releaseSide: number): number {
  return (Math.atan2(releaseSide - shoulderLateral(H), releaseHeight - shoulderHeight(H)) * 180) / Math.PI;
}

export function slotName(slotDeg: number): string {
  if (slotDeg < 20) return 'over the top';
  if (slotDeg < 38) return 'high three-quarter';
  if (slotDeg < 62) return 'three-quarter';
  if (slotDeg < 80) return 'low three-quarter';
  if (slotDeg < 102) return 'sidearm';
  return 'submarine';
}

export interface BodyPose {
  H: number;
  head: Vec3; neck: Vec3; chest: Vec3; pelvis: Vec3;
  shoulderT: Vec3; elbowT: Vec3; wristT: Vec3; // throwing arm
  shoulderG: Vec3; elbowG: Vec3; wristG: Vec3; // glove arm
  hipB: Vec3; kneeB: Vec3; ankleB: Vec3; toeB: Vec3; // back (drive) leg
  hipF: Vec3; kneeF: Vec3; ankleF: Vec3; toeF: Vec3; // front (landing) leg
  forward: Vec3; lateral: Vec3; // lateral = toward the arm side
}

/** Two-bone IK: joint position between a and target with segment lengths l1, l2, bending toward pole. */
export function twoBone(a: Vec3, target: Vec3, l1: number, l2: number, pole: Vec3): Vec3 {
  const d = sub(target, a);
  const dist = Math.min(len(d), (l1 + l2) * 0.9999);
  const dir = norm(d);
  const x = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  let p = sub(pole, scale(dir, dot(pole, dir)));
  p = len(p) < 1e-6 ? norm(cross(dir, [0, 1, 0])) : norm(p);
  return add(add(a, scale(dir, x)), scale(p, h));
}

/** Release posture. `wrist` is where the throwing wrist must be (from the grip hand at the release point). */
export function poseBody(body: BodySettings, hand: Hand, release: Vec3, wrist: Vec3, slotDeg: number): BodyPose {
  const H = body.heightM;
  const sx = armSideX(hand);
  const forward: Vec3 = [0, 0, -1];
  const lateral: Vec3 = [sx, 0, 0];
  const R = RUBBER_TO_PLATE;
  const ground = MOUND_HEIGHT;
  // throwing shoulder: placed so the arm (0.42 H) reaches the release point at the 35° forward angle
  const upper = 0.186 * H, fore = 0.146 * H;
  let shoulderT: Vec3 = [
    sx * shoulderLateral(H),
    shoulderHeight(H),
    release[2] + armReach(H) * Math.sin(REACH_FWD),
  ];
  // If the wrist is out of reach, the shoulder reaches forward toward the hand (protraction / trunk lean),
  // so the arm segments keep their real lengths.
  const toWrist = sub(wrist, shoulderT);
  const maxReach = 0.995 * (upper + fore);
  if (len(toWrist) > maxReach) shoulderT = sub(wrist, scale(norm(toWrist), maxReach));
  // shoulders tilt with arm slot: over-the-top lifts the throwing shoulder, sidearm levels it
  const tilt = (Math.max(-15, Math.min(32, 0.55 * (62 - slotDeg))) * Math.PI) / 180;
  const shoulderDir = norm([sx * Math.cos(tilt), Math.sin(tilt), 0.12]); // glove shoulder slightly ahead
  const shoulderG = sub(shoulderT, scale(shoulderDir, 0.2 * H));
  const neck = scale(add(shoulderT, shoulderG), 0.5);
  // pelvis over the front leg; trunk tilted forward
  const stride = 0.85 * H;
  const ankleF: Vec3 = [-sx * 0.06 * H / 1.88, ground - 0.07, R - stride];
  const ankleB: Vec3 = [sx * 0.16, ground + 0.06, R - 0.25];
  const pelvis: Vec3 = [-sx * 0.04, ground + 0.47 * H, neck[2] + 0.3 * H * Math.sin((30 * Math.PI) / 180) + 0.02];
  const spineUp = norm(sub(neck, pelvis));
  const chest = add(pelvis, scale(sub(neck, pelvis), 0.62));
  const head = add(add(neck, scale(spineUp, 0.11 * H)), scale(forward, 0.03 * H));
  const hipF = add(pelvis, scale(lateral, -0.09 * H));
  const hipB = add(pelvis, scale(lateral, 0.09 * H));
  const thigh = 0.245 * H, shank = 0.246 * H;
  const kneeF = twoBone(hipF, ankleF, thigh, shank, forward);
  const kneeB = twoBone(hipB, ankleB, thigh, shank, add(scale(forward, 0.6), [0, -0.4, 0]));
  const toeF = add(ankleF, [sx * 0.02, -0.04, -0.15 * H / 1.88]);
  const toeB = add(ankleB, [sx * 0.03, -0.06, -0.12 * H / 1.88]);
  // throwing arm: shoulder -> elbow -> wrist (elbow points down/out/back)
  const elbowT = twoBone(shoulderT, wrist, upper, fore, [sx * 0.55, -0.6, 0.55]);
  // glove arm tucked to the chest
  const wristG = add(add(chest, scale(forward, 0.2 * H / 1.88 + 0.12)), scale(lateral, -0.05));
  const elbowG = twoBone(shoulderG, wristG, upper, fore, [-sx * 0.7, -0.6, 0.1]);
  return {
    H, head, neck, chest, pelvis, shoulderT, elbowT, wristT: wrist, shoulderG, elbowG, wristG,
    hipB, kneeB, ankleB, toeB, hipF, kneeF, ankleF, toeF, forward, lateral,
  };
}
