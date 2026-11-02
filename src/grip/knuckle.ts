// Knuckleball residual-spin heuristic (grip layer). QUALITATIVE: knuckleballs typically leave the hand with
// well under one revolution of spin over the whole flight (tens of rpm). This heuristic encodes common coaching
// observations, not measurements:
//  * Fingernail contact gives the cleanest push (lowest spin), bent-finger knuckles next, fingertips more.
//  * Uneven pressure across the fingers (a lateral torque) adds spin.
//  * Firm thumb support underneath steadies the ball; no thumb support adds spin.
//  * Three fingers spread the push more evenly than two.
// The result is an ESTIMATE with a wide range, and the user can replace it with their own residual-spin
// assumption. That replacement is still a grip assumption, distinct from Physics-mode release values.

import { contactVector, FINGERS, type ContactType, type Grip } from './types';

export const CONTACT_BASE_RPM: Record<ContactType, number> = { fingernail: 25, knuckle: 45, fingertip: 80, pad: 160 };

export interface ResidualSpinEstimate {
  rpm: number;
  low: number;
  high: number;
  heuristicRpm: number;
  overridden: boolean;
  explanation: string;
}

export function estimateResidualSpin(grip: Grip): ResidualSpinEstimate {
  let sumP = 0, base = 0, lateral = 0, n = 0;
  for (const id of FINGERS) {
    if (id === 'thumb') continue;
    const f = grip.fingers[id];
    if (!f.enabled || f.pressure <= 0 || f.lat < -10) continue;
    const r = contactVector(f.lon, f.lat);
    sumP += f.pressure;
    base += f.pressure * CONTACT_BASE_RPM[f.contact];
    lateral += f.pressure * r[0]; // arm-side component (right-hand frame)
    n++;
  }
  if (sumP <= 0) {
    const rpm = grip.residualSpinOverride ?? 200;
    return { rpm, low: rpm * 0.6, high: rpm * 1.4, heuristicRpm: 200, overridden: grip.residualSpinOverride != null, explanation: 'No top fingers: spin is poorly controlled.' };
  }
  base /= sumP;
  const asym = Math.abs(lateral / sumP);
  const thumb = grip.fingers.thumb;
  const thumbFactor = thumb.enabled ? 1.2 - 0.4 * Math.min(1, thumb.pressure) : 1.25;
  const fingerFactor = n >= 3 ? 0.85 : 1;
  const heuristic = Math.max(0, Math.min(400, (base + 300 * asym) * thumbFactor * fingerFactor));
  const rpm = grip.residualSpinOverride ?? heuristic;
  const explanation = `Contact base ${base.toFixed(0)} rpm + pressure asymmetry ${(asym * 300).toFixed(0)} rpm, ×${thumbFactor.toFixed(2)} thumb support${n >= 3 ? ', ×0.85 three-finger push' : ''}.${grip.residualSpinOverride != null ? ' User-specified grip assumption replaces the heuristic value.' : ''}`;
  return { rpm, low: rpm * 0.6, high: rpm * 1.4 + 5, heuristicRpm: heuristic, overridden: grip.residualSpinOverride != null, explanation };
}
