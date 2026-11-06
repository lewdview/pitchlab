// Representative starting grips. Pitchers use many variations; these are reasonable, editable starting points,
// not definitive grips. Reference release values are rounded, typical MLB-like values for a right-hander with a
// 3/4 arm slot (REF_ARM_SLOT) and a 94 mph fastball. Movement comes from the physics model, not from these tables.

import type { Quat } from '../physics/vec';
import { qFromTo, qMul, qAxisAngle, qRotate, qNorm, dot } from '../physics/vec';
import { seamSamples } from '../physics/seamGeometry';
import { spinAxis, type ReleaseSpec } from '../physics/simulate';
import type { FingerContact, FingerId, Grip, PitchFamily } from './types';
import { contactVector } from './types';

export const REF_ARM_SLOT = 40; // degrees from vertical
export const REF_FASTBALL_MPH = 94;

export interface PresetRelease {
  /** Release speed as a fraction of the pitcher's fastball (arm-speed) velocity. */
  speedFactor: number;
  spinRpm: number;
  tiltDeg: number;
  gyroDeg: number;
}

export interface Preset {
  id: string;
  name: string;
  family: PitchFamily;
  blurb: string;
  fingers: Record<FingerId, FingerContact>;
  /** Body axis aligned with the spin axis: 'z' gives a four-seam pattern, 'x' a two-seam pattern. */
  seamAxis: 'z' | 'x';
  release: PresetRelease;
  /** Representative throwing cues (grip, release, feel). */
  howTo: string[];
  /** Knuckleball presets: nominal knuckle grip variant. */
  knuckleVariant?: 'two-finger' | 'three-finger';
}

const F = (lon: number, lat: number, pressure: number, dirDeg = 0, contact: FingerContact['contact'] = 'pad', enabled = true): FingerContact =>
  ({ lon, lat, pressure, dirDeg, contact, enabled });

export const PRESETS: Preset[] = [
  {
    id: 'four-seam', name: 'Four-seam fastball', family: 'fourSeam', seamAxis: 'z',
    blurb: 'Index and middle fingers across the horseshoe seam, thumb underneath. Maximises backspin.',
    fingers: { thumb: F(0, -72, 0.35), index: F(-13, 40, 0.5), middle: F(13, 40, 0.5), ring: F(68, -18, 0.15), little: F(82, -38, 0.05, 0, 'pad', false) },
    release: { speedFactor: 1.0, spinRpm: 2300, tiltDeg: 35, gyroDeg: 20 },
    howTo: [
      'Index and middle fingertips across the horseshoe seam, about a finger-width apart; thumb underneath on the bottom seam.',
      'Hold it in the fingertips, with a small gap between the ball and your palm.',
      'Stay behind the ball: at release your fingers are on the back of the ball and pull straight down through it for clean backspin.',
      'Full arm speed and a firm wrist; finish with your fingers pointing at the target.',
    ],
  },
  {
    id: 'two-seam', name: 'Two-seam fastball / sinker', family: 'twoSeam', seamAxis: 'x',
    blurb: 'Fingers along the narrow seams, slightly more index pressure; the hand pronates through release.',
    fingers: { thumb: F(-8, -70, 0.35), index: F(-6, 42, 0.58), middle: F(12, 38, 0.48), ring: F(66, -15, 0.15), little: F(82, -38, 0.05, 0, 'pad', false) },
    release: { speedFactor: 0.985, spinRpm: 2150, tiltDeg: 62, gyroDeg: 20 },
    howTo: [
      'Index and middle fingers run along the two narrow seams; thumb underneath.',
      'A little more pressure through the index finger.',
      'Throw it like a fastball, but let the hand turn slightly inward (pronate) as it releases, so the fingers come down the inside of the ball.',
      'Do not try to steer it; the grip and hand turn create the arm-side run and sink.',
    ],
  },
  {
    id: 'cutter', name: 'Cutter', family: 'cutter', seamAxis: 'z',
    blurb: 'Four-seam-like grip shifted toward the arm side of the ball, pressure on the middle finger.',
    fingers: { thumb: F(18, -66, 0.35), index: F(14, 34, 0.42), middle: F(36, 28, 0.62), ring: F(80, -20, 0.15), little: F(90, -40, 0.05, 0, 'pad', false) },
    release: { speedFactor: 0.935, spinRpm: 2350, tiltDeg: -12, gyroDeg: 60 },
    howTo: [
      'Start from a four-seam grip and slide both fingers slightly toward the outside (arm side) of the ball.',
      'Pressure on the middle finger.',
      'Throw it with fastball intent; at release the ball comes off the middle finger just off-centre, so do not turn the wrist over.',
      'Think short and late: it should look like a fastball for most of the flight.',
    ],
  },
  {
    id: 'slider', name: 'Slider', family: 'slider', seamAxis: 'z',
    blurb: 'Fingers on the outer (arm-side) third of the ball; the wrist stays firm and the ball spins off the index finger with heavy gyro spin.',
    fingers: { thumb: F(28, -62, 0.35), index: F(30, 22, 0.6), middle: F(52, 12, 0.5), ring: F(92, -25, 0.12), little: F(100, -42, 0.05, 0, 'pad', false) },
    release: { speedFactor: 0.9, spinRpm: 2450, tiltDeg: -95, gyroDeg: 62 },
    howTo: [
      'Grip the outer third of the ball, with the index and middle fingers together along a seam.',
      'Keep the wrist firm and slightly turned, like throwing a football; let the ball spin off the side of the index finger.',
      'Keep fastball arm speed and do not drop the elbow or twist the forearm to force break.',
      'Aim the release at the glove-side edge of the plate and let the spin carry it.',
    ],
  },
  {
    id: 'curveball', name: 'Curveball', family: 'curveball', seamAxis: 'z',
    blurb: 'Hand on the arm side of the ball with the palm facing in; middle finger along a seam over the top, thumb underneath. The fingers pull down over the front for topspin.',
    fingers: { thumb: F(100, -58, 0.35), index: F(78, 62, 0.35), middle: F(112, 52, 0.65), ring: F(150, 18, 0.12), little: F(165, 0, 0.05, 0, 'pad', false) },
    release: { speedFactor: 0.84, spinRpm: 2550, tiltDeg: -150, gyroDeg: 30 },
    howTo: [
      'Middle finger along a seam, index finger relaxed beside it, thumb on the back seam underneath.',
      'At release your palm faces in toward your head, with the hand on the side of the ball.',
      'Pull the middle finger down over the front of the ball for topspin, keeping the elbow up at shoulder height.',
      'Same arm speed as your fastball; finish down and across your body.',
    ],
  },
  {
    id: 'changeup', name: 'Circle changeup', family: 'changeup', seamAxis: 'x',
    blurb: 'Index and thumb form a circle on the side; middle and ring fingers on top. The ball sits deeper in the hand.',
    fingers: { thumb: F(-40, -40, 0.3), index: F(-48, -5, 0.2), middle: F(4, 40, 0.5), ring: F(28, 34, 0.5), little: F(62, -10, 0.2) },
    release: { speedFactor: 0.89, spinRpm: 1750, tiltDeg: 62, gyroDeg: 22 },
    howTo: [
      'Make a circle with the thumb and index finger on the side of the ball; middle and ring fingers on top.',
      'Let the ball sit deeper in the hand than your fastball.',
      'Throw it with full fastball arm speed; the grip takes speed off, not your arm.',
      'Let the hand turn inward slightly at release for fade toward your arm side.',
    ],
  },
  {
    id: 'splitter', name: 'Splitter', family: 'splitter', seamAxis: 'x',
    blurb: 'Index and middle fingers spread wide on either side of the ball, which wedges between them; spin is low.',
    fingers: { thumb: F(0, -72, 0.4), index: F(-34, 24, 0.5), middle: F(34, 24, 0.5), ring: F(78, -22, 0.12), little: F(90, -40, 0.05, 0, 'pad', false) },
    release: { speedFactor: 0.92, spinRpm: 1400, tiltDeg: 40, gyroDeg: 30 },
    howTo: [
      'Spread the index and middle fingers wide on either side of the ball, so it wedges between them.',
      'Thumb underneath for support; do not choke it deep in the hand.',
      'Throw it with fastball arm action and a firm wrist; the fingers come straight down the back of the ball.',
      'Low spin makes it tumble and drop late; keep the release out front.',
    ],
  },
  {
    id: 'knuckle-2', name: 'Knuckleball — two-finger', family: 'knuckleball', seamAxis: 'z', knuckleVariant: 'two-finger',
    blurb: 'Index and middle fingernails dig in behind the horseshoe; thumb supports underneath. The ball is pushed, not spun.',
    fingers: { thumb: F(0, -68, 0.45), index: F(-11, 36, 0.5, 0, 'fingernail'), middle: F(11, 36, 0.5, 0, 'fingernail'), ring: F(66, -16, 0.12), little: F(82, -36, 0.05, 0, 'pad', false) },
    release: { speedFactor: 0.8, spinRpm: 40, tiltDeg: 180, gyroDeg: 15 },
    howTo: [
      'Dig the index and middle fingernails into the leather just behind the horseshoe; thumb supports underneath.',
      'Keep the wrist stiff and push the ball out, rather than snapping it, so it leaves with almost no spin.',
      'Release out front and follow straight through toward the target.',
      'Expect it to move differently every throw; practise for a consistent push, not for a particular break.',
    ],
  },
  {
    id: 'knuckle-3', name: 'Knuckleball — three-finger', family: 'knuckleball', seamAxis: 'z', knuckleVariant: 'three-finger',
    blurb: 'Index, middle and ring fingernails across the back of the ball for a broader, more even push.',
    fingers: { thumb: F(0, -68, 0.45), index: F(-20, 33, 0.34, 0, 'fingernail'), middle: F(0, 37, 0.34, 0, 'fingernail'), ring: F(20, 33, 0.32, 0, 'fingernail'), little: F(78, -24, 0.08) },
    release: { speedFactor: 0.8, spinRpm: 35, tiltDeg: 180, gyroDeg: 15 },
    howTo: [
      'Dig the index, middle and ring fingernails in across the back of the ball; thumb underneath.',
      'Three fingers spread the push more evenly, which helps keep spin down.',
      'Stiff wrist, push through the ball, and follow straight through toward the target.',
      'Expect it to move differently every throw; practise for a consistent push, not for a particular break.',
    ],
  },
];

export const presetById = (id: string) => PRESETS.find((p) => p.id === id);

/** Nominal spec used to place seams relative to each preset's reference spin axis. */
export function nominalSpec(r: PresetRelease): ReleaseSpec {
  return {
    hand: 'R', speed: 40, spinRpm: r.spinRpm, tiltDeg: r.tiltDeg, gyroDeg: r.gyroDeg, vAngleDeg: -1, hAngleDeg: 0,
    releaseHeight: 1.8, releaseSide: 0.5, extension: 1.9, seamQuat: [1, 0, 0, 0],
  };
}

const SEAM_PTS = seamSamples(240);

/** Ball orientation for a preset: align the chosen body axis with the reference spin axis, then roll about that
 *  axis to put the index/middle fingertips as close to a seam as possible (deterministic search). */
function presetSeamQuat(p: Preset): Quat {
  const axis = spinAxis(nominalSpec(p.release));
  const base = qFromTo(p.seamAxis === 'z' ? [0, 0, 1] : [1, 0, 0], axis);
  const tips = (['index', 'middle'] as FingerId[]).map((f) => contactVector(p.fingers[f].lon, p.fingers[f].lat));
  let best: Quat = base, bestScore = Infinity;
  for (let r = 0; r < 360; r += 2) {
    const q = qNorm(qMul(qAxisAngle(axis, (r * Math.PI) / 180), base));
    let score = 0;
    for (const tip of tips) {
      let m = -2;
      for (const s of SEAM_PTS) m = Math.max(m, dot(qRotate(q, s), tip));
      score += 1 - m;
    }
    if (score < bestScore - 1e-9) { bestScore = score; best = q; }
  }
  return best;
}

const seamCache = new Map<string, Quat>();
export function presetSeam(p: Preset): Quat {
  let q = seamCache.get(p.id);
  if (!q) { q = presetSeamQuat(p); seamCache.set(p.id, q); }
  return q;
}

let idCounter = 0;
export function newId(): string {
  idCounter++;
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `g-${rnd}-${idCounter}`;
}

export function gripFromPreset(p: Preset): Grip {
  return {
    id: newId(),
    name: p.name,
    presetId: p.id,
    fingers: JSON.parse(JSON.stringify(p.fingers)),
    seamQuat: presetSeam(p),
    residualSpinOverride: null,
    custom: false,
  };
}
