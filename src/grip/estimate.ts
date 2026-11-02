// GRIP ESTIMATION LAYER — documented, preset-based heuristics. Converts grip + delivery into estimated
// release speed, spin rate, spin axis and initial orientation. Kept separate from the physics engine.
//
// Method
//  1. Lever-arm descriptor. Each enabled finger at contact point r (hand frame) with relative pressure p is
//     assumed to drive the ball along a fixed direction D = down + 0.3 * forward (fingers pull down the back of
//     the ball while pushing it toward the plate). The thumb pushes up from below at half weight. The
//     resulting torque direction  w_grip = sum p (r x D)  gives a "grip tilt" and a "grip gyro" angle, and its
//     magnitude is a rough proxy for how much spin the fingers can impart.
//  2. Neighbourhood check. A feature vector (grip tilt, grip gyro, torque magnitude, index–middle spread,
//     knuckle contact score, number of top fingers, thumb latitude) is compared with each preset's reference
//     grip. The nearest preset within distance SUPPORT_RADIUS (in feature standard units) is the base family.
//     Outside every neighbourhood the estimate is UNSUPPORTED and no numbers are produced unless the user picks a
//     family or enters release conditions manually.
//  3. Local adjustment around the base preset's reference release:
//       tilt  = tilt_ref + 0.6 * Δ(grip tilt) + 0.7 * (arm slot − 40°)
//       gyro  = gyro_ref + 0.6 * Δ(grip gyro)
//       spin  = spin_ref * (v_arm / 94 mph) * clamp((|w|/|w_ref|)^0.5, 0.7, 1.3) * (1 − 0.012 Δspread)
//       speed = v_arm * speedFactor_ref * (1 − 0.004 Δspread)
//     The coefficients are heuristic and replaceable; they are not fitted to data.
//  4. Knuckleball family: residual spin comes from the knuckle heuristic (knuckle.ts). The axis comes from
//     the lever-arm torque direction, so uneven pressure tilts the residual spin axis.
// Finger placement does not uniquely determine a pitch: arm speed, arm slot and release direction remain
// delivery inputs, and Physics mode bypasses this layer entirely.

import type { Vec3 } from '../physics/vec';
import { add, scale, cross, len, dot, norm, deg } from '../physics/vec';
import { MPH } from '../physics/constants';
import type { Hand, ReleaseSpec } from '../physics/simulate';
import { FINGERS, contactVector, type FingerId, type Grip, type PitchFamily, type FingerContact } from './types';
import { PRESETS, REF_ARM_SLOT, REF_FASTBALL_MPH, type Preset } from './presets';
import { estimateResidualSpin, type ResidualSpinEstimate } from './knuckle';

export interface Delivery {
  armSpeedMph: number;
  armSlotDeg: number;
  releaseHeight: number; // m
  releaseSide: number; // m toward arm side
  extension: number; // m
  vAngleDeg: number;
  hAngleDeg: number;
}

export const DEFAULT_DELIVERY: Delivery = {
  armSpeedMph: 94, armSlotDeg: 40, releaseHeight: 1.8, releaseSide: 0.5, extension: 1.9, vAngleDeg: -1.5, hAngleDeg: 1.0,
};

export interface GripFeatures {
  gripTilt: number;
  gripGyro: number;
  torque: number;
  spread: number;
  contactScore: number;
  nTop: number;
  thumbLat: number;
  thumbPressure: number;
}

const DRIVE: Vec3 = norm([0, -1, -0.3]);
const THUMB_DRIVE: Vec3 = norm([0, 1, -0.3]);

const angleBetween = (a: FingerContact, b: FingerContact) =>
  deg(Math.acos(Math.max(-1, Math.min(1, dot(contactVector(a.lon, a.lat), contactVector(b.lon, b.lat))))));

export function gripFeatures(fingers: Record<FingerId, FingerContact>): GripFeatures {
  let w: Vec3 = [0, 0, 0];
  let nTop = 0, cs = 0, csW = 0;
  for (const id of FINGERS) {
    const f = fingers[id];
    if (!f.enabled || f.pressure <= 0) continue;
    const r = contactVector(f.lon, f.lat);
    if (id === 'thumb') {
      w = add(w, scale(cross(r, THUMB_DRIVE), 0.5 * f.pressure));
    } else {
      w = add(w, scale(cross(r, DRIVE), f.pressure));
      if (f.lat > -10 && Math.abs(f.lon) < 120 && f.pressure >= 0.2) nTop++;
      cs += f.pressure * (f.contact === 'pad' ? 0 : 1);
      csW += f.pressure;
    }
  }
  // Tilt: Magnus direction for transverse spin w_t about forward (-z): f = (-w_y, w_x). Arm side (RHP) = +x.
  const gripTilt = deg(Math.atan2(-w[1], w[0]));
  const wt = Math.hypot(w[0], w[1]);
  const gripGyro = deg(Math.atan2(-w[2], wt));
  const spread = fingers.index.enabled && fingers.middle.enabled ? angleBetween(fingers.index, fingers.middle) : 0;
  return {
    gripTilt, gripGyro, torque: len(w), spread,
    contactScore: csW > 0 ? cs / csW : 0,
    nTop,
    thumbLat: fingers.thumb.enabled ? fingers.thumb.lat : -90,
    thumbPressure: fingers.thumb.enabled ? fingers.thumb.pressure : 0,
  };
}

export const wrap180 = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

const presetFeatureCache = new Map<string, GripFeatures>();
export function presetFeatures(p: Preset): GripFeatures {
  let f = presetFeatureCache.get(p.id);
  if (!f) { f = gripFeatures(p.fingers); presetFeatureCache.set(p.id, f); }
  return f;
}

export const SUPPORT_RADIUS = 2.5;

export function featureDistance(a: GripFeatures, b: GripFeatures): number {
  const terms = [
    wrap180(a.gripTilt - b.gripTilt) / 35,
    (a.gripGyro - b.gripGyro) / 30,
    Math.log(Math.max(1e-3, a.torque) / Math.max(1e-3, b.torque)) / 0.4,
    (a.spread - b.spread) / 9,
    (a.contactScore - b.contactScore) / 0.4,
    (a.nTop - b.nTop) / 0.9,
    (a.thumbLat - b.thumbLat) / 45,
  ];
  return Math.sqrt(terms.reduce((s, t) => s + t * t, 0));
}

export interface Neighbour { preset: Preset; distance: number }

export function rankPresets(features: GripFeatures): Neighbour[] {
  return PRESETS.map((p) => ({ preset: p, distance: featureDistance(features, presetFeatures(p)) })).sort(
    (a, b) => a.distance - b.distance || a.preset.id.localeCompare(b.preset.id),
  );
}

export interface EstimateNote { label: string; detail: string }

export interface ReleaseEstimate {
  status: 'supported' | 'family-override' | 'unsupported';
  family: PitchFamily | null;
  base: Preset | null;
  distance: number;
  nearest: Neighbour[];
  /** Estimated release spec (null when unsupported). */
  spec: ReleaseSpec | null;
  notes: EstimateNote[];
  residual: ResidualSpinEstimate | null;
  features: GripFeatures;
}

const fmt = (x: number, d = 0) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d);

export function estimateRelease(
  grip: Grip, delivery: Delivery, hand: Hand, familyOverride: PitchFamily | null, overridePresetId?: string | null,
): ReleaseEstimate {
  const features = gripFeatures(grip.fingers);
  const nearest = rankPresets(features);
  let base: Preset | null = null;
  let status: ReleaseEstimate['status'] = 'unsupported';
  if (nearest[0].distance <= SUPPORT_RADIUS) {
    base = nearest[0].preset;
    status = 'supported';
  } else if (familyOverride) {
    base = (overridePresetId && PRESETS.find((p) => p.id === overridePresetId)) || PRESETS.find((p) => p.family === familyOverride) || null;
    status = base ? 'family-override' : 'unsupported';
  }
  const notes: EstimateNote[] = [];
  if (!base) {
    return { status: 'unsupported', family: null, base: null, distance: nearest[0].distance, nearest, spec: null, notes, residual: null, features };
  }
  const ref = presetFeatures(base);
  const r = base.release;
  const distance = featureDistance(features, ref);
  notes.push({
    label: status === 'supported' ? `Base family: ${base.name}` : `User-selected family: ${base.name}`,
    detail: status === 'supported'
      ? `Nearest representative grip (distance ${distance.toFixed(2)} of ${SUPPORT_RADIUS} allowed).`
      : `Grip is ${distance.toFixed(2)} units from this preset, outside the supported neighbourhood. Low confidence.`,
  });

  const armRatio = delivery.armSpeedMph / REF_FASTBALL_MPH;
  // Spread effect is clamped (±12° worth) so neighbourhood-edge grips do not extrapolate wildly.
  const dSpread = Math.max(-12, Math.min(12, features.spread - ref.spread));
  const slotTilt = 0.7 * (delivery.armSlotDeg - REF_ARM_SLOT);
  let speed = delivery.armSpeedMph * MPH * r.speedFactor * (1 - 0.004 * dSpread);
  let spinRpm: number, tiltDeg: number, gyroDeg: number;
  let residual: ResidualSpinEstimate | null = null;

  if (base.family === 'knuckleball') {
    residual = estimateResidualSpin(grip);
    spinRpm = residual.rpm;
    tiltDeg = wrap180(features.gripTilt + slotTilt);
    gyroDeg = Math.max(-80, Math.min(80, features.gripGyro));
    notes.push({ label: `Residual spin ≈ ${residual.rpm.toFixed(0)} rpm (${residual.low.toFixed(0)}–${residual.high.toFixed(0)})`, detail: residual.explanation });
    notes.push({ label: `Spin axis from finger torque: tilt ${tiltDeg.toFixed(0)}°, gyro ${gyroDeg.toFixed(0)}°`, detail: 'Uneven finger pressure tilts the residual spin axis.' });
  } else {
    const dTilt = wrap180(features.gripTilt - ref.gripTilt);
    const dGyro = features.gripGyro - ref.gripGyro;
    const torqueRatio = Math.max(0.7, Math.min(1.3, Math.sqrt(features.torque / Math.max(1e-6, ref.torque))));
    tiltDeg = wrap180(r.tiltDeg + 0.6 * dTilt + slotTilt);
    gyroDeg = Math.max(-85, Math.min(85, r.gyroDeg + 0.6 * dGyro));
    spinRpm = Math.max(0, r.spinRpm * armRatio * torqueRatio * (1 - 0.012 * dSpread));
    if (Math.abs(dTilt) >= 2) notes.push({ label: `Finger torque direction ${fmt(dTilt)}° → spin tilt ${fmt(0.6 * dTilt)}°`, detail: 'Where the fingers sit and press changes the direction they can spin the ball.' });
    if (Math.abs(dGyro) >= 2) notes.push({ label: `Fingers off-centre ${fmt(dGyro)}° → gyro ${fmt(0.6 * dGyro)}°`, detail: 'Fingers toward the side or front of the ball add bullet (gyro) spin, which produces no Magnus force.' });
    if (Math.abs(torqueRatio - 1) >= 0.02) notes.push({ label: `Finger leverage ×${torqueRatio.toFixed(2)} → spin ${fmt((torqueRatio - 1) * 100)}%`, detail: 'Pressure and lever arm relative to the reference grip (clamped to ±30%).' });
  }
  if (Math.abs(dSpread) >= 1) notes.push({ label: `Index–middle spread ${fmt(dSpread)}° → speed ${fmt(-0.4 * dSpread, 1)}%${base.family !== 'knuckleball' ? `, spin ${fmt(-1.2 * dSpread, 1)}%` : ''}`, detail: 'Wider spread fingers reduce grip on the ball (splitter-like).' });
  if (Math.abs(slotTilt) >= 1) notes.push({ label: `Arm slot ${delivery.armSlotDeg.toFixed(0)}° vs ${REF_ARM_SLOT}° reference → tilt ${fmt(slotTilt)}°`, detail: 'Lower arm slots rotate the whole hand, and the spin axis with it, toward the arm side.' });
  if (Math.abs(armRatio - 1) >= 0.005) notes.push({ label: `Arm speed ${delivery.armSpeedMph.toFixed(1)} mph`, detail: `Release speed scales with arm speed (×${r.speedFactor.toFixed(3)} for this family)${base.family !== 'knuckleball' ? '; spin rate scales proportionally' : ''}.` });
  speed = Math.max(10, speed);

  return {
    status, family: base.family, base, distance, nearest, notes, residual, features,
    spec: {
      hand, speed, spinRpm, tiltDeg, gyroDeg,
      vAngleDeg: delivery.vAngleDeg, hAngleDeg: delivery.hAngleDeg,
      releaseHeight: delivery.releaseHeight, releaseSide: delivery.releaseSide, extension: delivery.extension,
      seamQuat: grip.seamQuat,
    },
  };
}
