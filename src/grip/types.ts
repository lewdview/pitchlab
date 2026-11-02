import type { Quat, Vec3 } from '../physics/vec';

export type FingerId = 'thumb' | 'index' | 'middle' | 'ring' | 'little';
export const FINGERS: FingerId[] = ['thumb', 'index', 'middle', 'ring', 'little'];

export const FINGER_META: Record<FingerId, { label: string; short: string; color: string }> = {
  thumb: { label: 'Thumb', short: 'T', color: '#f5b942' },
  index: { label: 'Index', short: 'I', color: '#3fb6ff' },
  middle: { label: 'Middle', short: 'M', color: '#4be3a4' },
  ring: { label: 'Ring', short: 'R', color: '#c38bff' },
  little: { label: 'Little', short: 'L', color: '#ff7aa8' },
};

/** pad = normal finger-pad contact; fingertip / fingernail / knuckle (bent finger) are knuckleball contacts. */
export type ContactType = 'pad' | 'fingertip' | 'fingernail' | 'knuckle';
export const CONTACT_LABELS: Record<ContactType, string> = {
  pad: 'Finger pad',
  fingertip: 'Fingertip',
  fingernail: 'Fingernail',
  knuckle: 'Bent finger (knuckle)',
};

/** One finger contact. Position is in the HAND frame, written for the throwing hand so the same grip mirrors
 *  automatically for left-handers:
 *   lon: degrees around the vertical axis. 0 = back of the ball (facing the pitcher), +90 = arm side, ±180 = front.
 *   lat: degrees above the ball's horizontal equator (+90 = top, -90 = bottom). */
export interface FingerContact {
  enabled: boolean;
  lon: number;
  lat: number;
  /** Relative pressure 0..1. */
  pressure: number;
  /** Direction the finger points along the surface, degrees. 0 = toward the top of the ball (along the meridian). */
  dirDeg: number;
  contact: ContactType;
}

export type PitchFamily =
  | 'fourSeam' | 'twoSeam' | 'cutter' | 'slider' | 'curveball' | 'changeup' | 'splitter' | 'knuckleball';

export const FAMILY_LABELS: Record<PitchFamily, string> = {
  fourSeam: 'Four-seam fastball',
  twoSeam: 'Two-seam / sinker',
  cutter: 'Cutter',
  slider: 'Slider',
  curveball: 'Curveball',
  changeup: 'Changeup',
  splitter: 'Splitter',
  knuckleball: 'Knuckleball',
};

export interface Grip {
  id: string;
  name: string;
  /** Preset this grip started from (used by "Reset"). */
  presetId: string;
  fingers: Record<FingerId, FingerContact>;
  /** Ball orientation in the hand (right-hand frame), body -> world. */
  seamQuat: Quat;
  /** Knuckleball only: user-adjusted residual spin assumption (rpm). null = use the grip heuristic. */
  residualSpinOverride: number | null;
  custom: boolean;
}

/** Hand-frame unit vector for a contact, right-hand frame (arm side = +x, back = +z). */
export function contactVector(lon: number, lat: number): Vec3 {
  const lo = (lon * Math.PI) / 180, la = (lat * Math.PI) / 180;
  return [Math.sin(lo) * Math.cos(la), Math.sin(la), Math.cos(lo) * Math.cos(la)];
}

export function vectorToContact(v: Vec3): { lon: number; lat: number } {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  const x = v[0] / l, y = v[1] / l, z = v[2] / l;
  return {
    lat: (Math.asin(Math.max(-1, Math.min(1, y))) * 180) / Math.PI,
    lon: (Math.atan2(x, z) * 180) / Math.PI,
  };
}

/** Hand-frame (right-hand) contact -> world-frame vector for the given throwing hand (left = x-mirror). */
export function toWorld(f: { lon: number; lat: number }, hand: 'R' | 'L'): Vec3 {
  const v = contactVector(f.lon, f.lat);
  return hand === 'R' ? v : [-v[0], v[1], v[2]];
}
