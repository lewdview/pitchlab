import { create } from 'zustand';
import type { Quat } from '../physics/vec';
import { qMul, qNorm, qRotate, qFromEuler, qToEuler } from '../physics/vec';
import { DEFAULT_ENV, type EnvironmentSettings } from '../physics/atmosphere';
import { DEFAULT_SEAM_PARAMS, type SeamModelParams } from '../physics/seamModel';
import type { Hand, ReleaseSpec } from '../physics/simulate';
import {
  aimAt, computePitch, type EnsembleRanges, type PitchResult, type SimSettings, type VariantVar,
} from '../physics/pitch';
import { PLATE_FRONT_Z } from '../physics/constants';
import { contactVector, vectorToContact, type FingerContact, type FingerId, type Grip, type PitchFamily } from '../grip/types';
import { gripFromPreset, newId, presetById, PRESETS } from '../grip/presets';
import { DEFAULT_DELIVERY, estimateRelease, type Delivery } from '../grip/estimate';
import { loadSavedGrips, persistSavedGrips } from './persistence';
import { DEFAULT_BODY, releaseFromSlot, slotFromRelease, type BodySettings } from '../body/pitcherBody';

/** Keep arm slot and release height/side consistent with the body when linked. */
export function linkDelivery(prev: Delivery, patch: Partial<Delivery>, body: BodySettings, bodyChanged = false): Delivery {
  const next = { ...prev, ...patch };
  if (!body.link) return next;
  if ('armSlotDeg' in patch || bodyChanged) return { ...next, ...releaseFromSlot(body.heightM, next.armSlotDeg) };
  if ('releaseHeight' in patch || 'releaseSide' in patch) return { ...next, armSlotDeg: Math.round(slotFromRelease(body.heightM, next.releaseHeight, next.releaseSide) * 10) / 10 };
  return next;
}

export type CameraView = 'behind' | 'release' | 'pitcher' | 'catcher' | 'side' | 'overhead' | 'orbit';
export type GripTool = 'orbit' | 'seams' | 'grip';
export type Units = 'imperial' | 'metric';

export interface ManualRelease {
  speed: number;
  spinRpm: number;
  tiltDeg: number;
  gyroDeg: number;
  seamQuat: Quat;
}

export interface PinnedPitch {
  id: string;
  label: string;
  color: string;
  family: PitchFamily | null;
  mode: 'guided' | 'physics';
  seamForces: boolean;
  result: PitchResult;
  /** Estimated settings that differ from the active pitch at pin time (guided comparisons). */
  visible: boolean;
}

export interface Overlay {
  kind: 'variants' | 'ensemble';
  title: string;
  subtitle: string;
  labels: string[];
  results: PitchResult[];
  variable?: VariantVar;
  seed?: number;
  ranges?: EnsembleRanges;
}

export const PIN_COLORS = ['#ffb347', '#5ec8ff', '#c792ff', '#7cf29a'];

export interface ViewSettings {
  camera: CameraView;
  exaggerate: number;
  enlargeBall: boolean;
  /** Pitcher figure on the mound and release guides. */
  showPitcher: boolean;
  showGuides: boolean;
  showRef: boolean;
  showForces: boolean;
  /** Display-only rotational motion blur on the spinning ball (180° virtual shutter). */
  motionBlur: boolean;
  zoneTop: number;
  zoneBottom: number;
  units: Units;
}

export interface AppState {
  hand: Hand;
  grip: Grip;
  savedGrips: Grip[];
  mode: 'guided' | 'physics';
  manual: ManualRelease | null;
  familyOverride: PitchFamily | null;
  overridePresetId: string | null;
  delivery: Delivery;
  body: BodySettings;
  env: EnvironmentSettings;
  dt: number;
  seamKnuckle: boolean;
  seamExperimental: boolean;
  seamParams: SeamModelParams;
  view: ViewSettings;
  t: number;
  playing: boolean;
  rate: number;
  pinned: PinnedPitch[];
  overlay: Overlay | null;
  gripTool: GripTool;
  handStyle: 'off' | 'ghost' | 'solid';
  handSize: number;
  /** Grip editor: draw the set grip (ball held firmly in the fingers) or the instant of release. */
  gripPose: 'hold' | 'release';
  selectedFinger: FingerId;
  mobileTab: 'grip' | 'flight' | 'compare';
  aimTarget: { x: number; y: number };

  set: (p: Partial<AppState>) => void;
  setHand: (h: Hand) => void;
  setFinger: (id: FingerId, p: Partial<FingerContact>) => void;
  setSpread: (deg: number) => void;
  rotateBallInHand: (dq: Quat, fingersFollow: boolean) => void;
  setSeamEuler: (yaw: number, pitch: number, roll: number) => void;
  loadPreset: (id: string) => void;
  loadSaved: (id: string) => void;
  saveGrip: (name: string) => void;
  duplicateGrip: () => void;
  resetGrip: () => void;
  deleteSaved: (id: string) => void;
  renameSaved: (id: string, name: string) => void;
  setResidualOverride: (rpm: number | null) => void;
  setDelivery: (p: Partial<Delivery>) => void;
  setBody: (p: Partial<BodySettings>) => void;
  setEnv: (p: Partial<EnvironmentSettings>) => void;
  setView: (p: Partial<ViewSettings>) => void;
  enterPhysicsMode: (fromSpec: ReleaseSpec | null) => void;
  restoreGripEstimates: () => void;
  setManual: (p: Partial<ManualRelease>) => void;
  setFamilyOverride: (f: PitchFamily | null, presetId?: string | null) => void;
  pin: (p: Omit<PinnedPitch, 'id' | 'color' | 'visible'>) => void;
  unpin: (id: string) => void;
  togglePinVisible: (id: string) => void;
  replay: () => void;
  aim: (spec: ReleaseSpec | null) => void;
}

export function simSettings(s: Pick<AppState, 'env' | 'dt' | 'seamParams'>, seamOn: boolean): SimSettings {
  return { env: s.env, dt: s.dt, seam: seamOn ? s.seamParams : null };
}

export function seamActiveFor(family: PitchFamily | null, s: Pick<AppState, 'seamKnuckle' | 'seamExperimental'>): boolean {
  return family === 'knuckleball' ? s.seamKnuckle : s.seamExperimental;
}

const DEFAULT_TARGET = { x: 0, y: 0.76 };

function aimedDelivery(grip: Grip, delivery: Delivery, hand: Hand, state: Pick<AppState, 'env' | 'dt' | 'seamParams' | 'seamKnuckle' | 'seamExperimental'>, target = DEFAULT_TARGET): Delivery {
  const est = estimateRelease(grip, delivery, hand, null);
  if (!est.spec) return delivery;
  const aimed = aimAt(est.spec, simSettings(state, seamActiveFor(est.family, state)), target);
  return { ...delivery, vAngleDeg: aimed.vAngleDeg, hAngleDeg: aimed.hAngleDeg };
}

const initialGrip = gripFromPreset(PRESETS[0]);
const baseState = {
  env: DEFAULT_ENV, dt: 0.001, seamParams: DEFAULT_SEAM_PARAMS, seamKnuckle: true, seamExperimental: false,
};
const initialDelivery = aimedDelivery(initialGrip, linkDelivery(DEFAULT_DELIVERY, {}, DEFAULT_BODY, true), 'R', baseState);

export const useStore = create<AppState>((set, get) => ({
  hand: 'R',
  grip: initialGrip,
  savedGrips: loadSavedGrips(),
  mode: 'guided',
  manual: null,
  familyOverride: null,
  overridePresetId: null,
  delivery: initialDelivery,
  body: DEFAULT_BODY,
  ...baseState,
  view: { camera: 'catcher', exaggerate: 1, enlargeBall: true, showRef: true, showForces: true, motionBlur: true, showPitcher: true, showGuides: true, zoneTop: 1.07, zoneBottom: 0.46, units: 'imperial' },
  t: 0,
  playing: true,
  rate: 0.25,
  pinned: [],
  overlay: null,
  gripTool: 'orbit',
  handStyle: 'ghost',
  handSize: 1,
  gripPose: 'hold',
  selectedFinger: 'index',
  mobileTab: 'grip',
  aimTarget: DEFAULT_TARGET,

  set: (p) => set(p),
  setHand: (hand) => set({ hand }),
  setFinger: (id, p) => set((s) => ({ grip: { ...s.grip, custom: true, fingers: { ...s.grip.fingers, [id]: { ...s.grip.fingers[id], ...p } } } })),
  setSpread: (deg) =>
    set((s) => {
      const fi = s.grip.fingers.index, fm = s.grip.fingers.middle;
      const a = contactVector(fi.lon, fi.lat), b = contactVector(fm.lon, fm.lat);
      const mid = [a[0] + b[0], a[1] + b[1], a[2] + b[2]] as [number, number, number];
      const ml = Math.hypot(...mid) || 1;
      const m: [number, number, number] = [mid[0] / ml, mid[1] / ml, mid[2] / ml];
      // direction from middle toward index, tangent at m
      let d: [number, number, number] = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      const dm = d[0] * m[0] + d[1] * m[1] + d[2] * m[2];
      d = [d[0] - dm * m[0], d[1] - dm * m[1], d[2] - dm * m[2]];
      const dl = Math.hypot(...d);
      if (dl < 1e-6) d = [1, 0, 0]; else d = [d[0] / dl, d[1] / dl, d[2] / dl];
      const h = ((deg / 2) * Math.PI) / 180;
      const pa = vectorToContact([m[0] * Math.cos(h) + d[0] * Math.sin(h), m[1] * Math.cos(h) + d[1] * Math.sin(h), m[2] * Math.cos(h) + d[2] * Math.sin(h)]);
      const pb = vectorToContact([m[0] * Math.cos(h) - d[0] * Math.sin(h), m[1] * Math.cos(h) - d[1] * Math.sin(h), m[2] * Math.cos(h) - d[2] * Math.sin(h)]);
      return { grip: { ...s.grip, custom: true, fingers: { ...s.grip.fingers, index: { ...fi, ...pa }, middle: { ...fm, ...pb } } } };
    }),
  rotateBallInHand: (dq, fingersFollow) =>
    set((s) => {
      const seamQuat = qNorm(qMul(dq, s.grip.seamQuat));
      let fingers = s.grip.fingers;
      if (fingersFollow) {
        fingers = { ...fingers };
        for (const id of Object.keys(fingers) as FingerId[]) {
          const f = fingers[id];
          const v = qRotate(dq, contactVector(f.lon, f.lat));
          fingers[id] = { ...f, ...vectorToContact(v) };
        }
      }
      return { grip: { ...s.grip, custom: true, seamQuat, fingers } };
    }),
  setSeamEuler: (yaw, pitch, roll) => set((s) => ({ grip: { ...s.grip, custom: true, seamQuat: qFromEuler(yaw, pitch, roll) } })),
  loadPreset: (id) => {
    const p = presetById(id);
    if (!p) return;
    const grip = gripFromPreset(p);
    const s = get();
    // In Physics mode the release (including direction) is locked: do not re-aim.
    const delivery = s.mode === 'physics' ? s.delivery : aimedDelivery(grip, s.delivery, s.hand, s, s.aimTarget);
    set({ grip, delivery, familyOverride: null, overridePresetId: null, overlay: null, t: 0, playing: true });
  },
  loadSaved: (id) => {
    const g = get().savedGrips.find((x) => x.id === id);
    if (!g) return;
    const grip = JSON.parse(JSON.stringify(g)) as Grip;
    const s = get();
    set({ grip, delivery: s.mode === 'physics' ? s.delivery : aimedDelivery(grip, s.delivery, s.hand, s, s.aimTarget), familyOverride: null, overlay: null, t: 0, playing: true });
  },
  saveGrip: (name) =>
    set((s) => {
      const existing = s.savedGrips.findIndex((g) => g.id === s.grip.id);
      const grip: Grip = { ...s.grip, name: name.trim() || s.grip.name, custom: true };
      const savedGrips = existing >= 0 ? s.savedGrips.map((g, i) => (i === existing ? grip : g)) : [...s.savedGrips, grip];
      persistSavedGrips(savedGrips);
      return { grip, savedGrips };
    }),
  duplicateGrip: () =>
    set((s) => {
      const grip: Grip = { ...JSON.parse(JSON.stringify(s.grip)), id: newId(), name: `${s.grip.name} (copy)`, custom: true };
      const savedGrips = [...s.savedGrips, grip];
      persistSavedGrips(savedGrips);
      return { grip, savedGrips };
    }),
  resetGrip: () =>
    set((s) => {
      const p = presetById(s.grip.presetId) ?? PRESETS[0];
      const fresh = gripFromPreset(p);
      return { grip: { ...fresh, id: s.grip.id, name: s.grip.name, custom: s.grip.custom } };
    }),
  deleteSaved: (id) =>
    set((s) => {
      const savedGrips = s.savedGrips.filter((g) => g.id !== id);
      persistSavedGrips(savedGrips);
      return { savedGrips };
    }),
  renameSaved: (id, name) =>
    set((s) => {
      const savedGrips = s.savedGrips.map((g) => (g.id === id ? { ...g, name } : g));
      persistSavedGrips(savedGrips);
      return { savedGrips, grip: s.grip.id === id ? { ...s.grip, name } : s.grip };
    }),
  setResidualOverride: (rpm) => set((s) => ({ grip: { ...s.grip, custom: true, residualSpinOverride: rpm } })),
  setDelivery: (p) => set((s) => ({ delivery: linkDelivery(s.delivery, p, s.body) })),
  setBody: (p) => set((s) => {
    const body = { ...s.body, ...p };
    return { body, delivery: linkDelivery(s.delivery, {}, body, 'heightM' in p || (p.link === true && !s.body.link)) };
  }),
  setEnv: (p) => set((s) => ({ env: { ...s.env, ...p } })),
  setView: (p) => set((s) => ({ view: { ...s.view, ...p } })),
  enterPhysicsMode: (spec) =>
    set((s) => ({
      mode: 'physics',
      manual: s.manual ?? {
        speed: spec?.speed ?? (s.delivery.armSpeedMph * 0.44704),
        spinRpm: spec?.spinRpm ?? 2200,
        tiltDeg: spec?.tiltDeg ?? 30,
        gyroDeg: spec?.gyroDeg ?? 20,
        seamQuat: spec?.seamQuat ?? s.grip.seamQuat,
      },
    })),
  restoreGripEstimates: () => set({ mode: 'guided', manual: null }),
  setManual: (p) => set((s) => (s.manual ? { manual: { ...s.manual, ...p } } : {})),
  setFamilyOverride: (familyOverride, presetId = null) => set({ familyOverride, overridePresetId: presetId }),
  pin: (p) =>
    set((s) => {
      if (s.pinned.length >= 4) return {};
      const used = new Set(s.pinned.map((x) => x.color));
      const color = PIN_COLORS.find((c) => !used.has(c)) ?? PIN_COLORS[0];
      return { pinned: [...s.pinned, { ...p, id: newId(), color, visible: true }] };
    }),
  unpin: (id) => set((s) => ({ pinned: s.pinned.filter((x) => x.id !== id) })),
  togglePinVisible: (id) => set((s) => ({ pinned: s.pinned.map((x) => (x.id === id ? { ...x, visible: !x.visible } : x)) })),
  replay: () => set({ t: 0, playing: true }),
  aim: (spec) => {
    if (!spec) return;
    const s = get();
    const est = estimateRelease(s.grip, s.delivery, s.hand, s.familyOverride, s.overridePresetId);
    const aimed = aimAt(spec, simSettings(s, seamActiveFor(est.family, s)), s.aimTarget);
    set({ delivery: { ...s.delivery, vAngleDeg: aimed.vAngleDeg, hAngleDeg: aimed.hAngleDeg }, t: 0, playing: true });
  },
}));

export const seamEuler = (q: Quat) => qToEuler(q);
export const plateZ = PLATE_FRONT_Z;
export { computePitch };
