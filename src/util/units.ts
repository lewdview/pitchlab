import { FT, IN, MPH } from '../physics/constants';
import type { Units } from '../state/store';

export const fmtSpeed = (mps: number, u: Units) => (u === 'imperial' ? `${(mps / MPH).toFixed(1)} mph` : `${mps.toFixed(1)} m/s`);
export const fmtSmall = (m: number, u: Units, signed = false) => {
  const v = u === 'imperial' ? m / IN : m * 100;
  const s = signed && v > 0 ? '+' : '';
  return `${s}${v.toFixed(1)} ${u === 'imperial' ? 'in' : 'cm'}`;
};
export const fmtLong = (m: number, u: Units) => (u === 'imperial' ? `${(m / FT).toFixed(2)} ft` : `${m.toFixed(2)} m`);
export const fmtAngle = (d: number, digits = 1) => `${d.toFixed(digits)}°`;

/** Clock-face reading of a force direction seen from behind the pitcher (pitcher's view). */
export function tiltToClock(tiltArmSideDeg: number, hand: 'R' | 'L'): string {
  // pitcher's view: clockwise from 12. RHP arm side = pitcher's right = clockwise.
  const cw = hand === 'R' ? tiltArmSideDeg : -tiltArmSideDeg;
  let mins = Math.round(((((cw % 360) + 360) % 360) / 360) * 720);
  mins = mins % 720;
  let h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) h = 12;
  return `${h}:${m.toString().padStart(2, '0')}`;
}

export const speedToDisplay = (mps: number, u: Units) => (u === 'imperial' ? mps / MPH : mps);
export const speedFromDisplay = (x: number, u: Units) => (u === 'imperial' ? x * MPH : x);
export const lenToDisplay = (m: number, u: Units) => (u === 'imperial' ? m / FT : m);
export const lenFromDisplay = (x: number, u: Units) => (u === 'imperial' ? x * FT : x);
export const lenUnit = (u: Units) => (u === 'imperial' ? 'ft' : 'm');
export const speedUnit = (u: Units) => (u === 'imperial' ? 'mph' : 'm/s');
