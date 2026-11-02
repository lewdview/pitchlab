import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../state/store';
import { computeDerived } from '../state/derived';
import { PRESETS, gripFromPreset, presetById } from '../grip/presets';
import { estimateRelease, DEFAULT_DELIVERY } from '../grip/estimate';
import { estimateResidualSpin } from '../grip/knuckle';
import { computePitch, aimAt } from '../physics/pitch';
import { DEFAULT_ENV } from '../physics/atmosphere';
import { DEFAULT_SEAM_PARAMS } from '../physics/seamModel';
import type { Grip } from '../grip/types';

const initial = useStore.getState();
beforeEach(() => useStore.setState(initial, true));

const derived = () => computeDerived(useStore.getState());

describe('grip estimation layer', () => {
  it('every preset is supported and estimates its own family', () => {
    for (const p of PRESETS) {
      const e = estimateRelease(gripFromPreset(p), DEFAULT_DELIVERY, 'R', null);
      expect(e.status).toBe('supported');
      expect(e.family).toBe(p.family);
      expect(e.spec).not.toBeNull();
    }
  });

  it('opens on a usable four-seam grip with a plate crossing', () => {
    const d = derived();
    expect(d.family).toBe('fourSeam');
    expect(d.result?.metrics).not.toBeNull();
    expect(d.result!.metrics!.ivb).toBeGreaterThan(0.25); // ~10+ in of induced vertical movement
  });

  it('moving a finger updates the guided estimate and the trajectory', () => {
    const before = derived();
    const f = useStore.getState().grip.fingers.middle;
    useStore.getState().setFinger('middle', { lon: f.lon + 18, lat: f.lat - 8 });
    const after = derived();
    expect(after.spec!.tiltDeg).not.toBeCloseTo(before.spec!.tiltDeg, 3);
    expect(after.result!.traj.crossing!.p).not.toEqual(before.result!.traj.crossing!.p);
    expect(after.estimate.notes.length).toBeGreaterThan(1);
  });

  it('manual (physics-mode) release stays locked while the grip is edited', () => {
    const st = useStore.getState();
    st.enterPhysicsMode(derived().spec);
    useStore.getState().setManual({ spinRpm: 1234, tiltDeg: 77 });
    const locked = derived();
    useStore.getState().setFinger('index', { lon: -40, lat: 10, pressure: 0.9 });
    useStore.getState().setSpread(45);
    useStore.getState().loadPreset('curveball');
    const after = derived();
    expect(after.spec).toEqual({ ...locked.spec });
    expect(after.result!.traj.samples).toEqual(locked.result!.traj.samples);
    // restoring estimates brings grip-driven values back
    useStore.getState().restoreGripEstimates();
    expect(derived().spec!.spinRpm).not.toBe(1234);
  });

  it('unsupported grips produce no fabricated estimate until a family or manual release is chosen', () => {
    const g: Grip = gripFromPreset(presetById('four-seam')!);
    g.fingers.index = { ...g.fingers.index, lon: 170, lat: -60 };
    g.fingers.middle = { ...g.fingers.middle, lon: -150, lat: -70 };
    g.fingers.thumb = { ...g.fingers.thumb, lon: 0, lat: 80 };
    const e = estimateRelease(g, DEFAULT_DELIVERY, 'R', null);
    expect(e.status).toBe('unsupported');
    expect(e.spec).toBeNull();
    const e2 = estimateRelease(g, DEFAULT_DELIVERY, 'R', 'changeup', 'changeup');
    expect(e2.status).toBe('family-override');
    expect(e2.spec).not.toBeNull();
  });

  it('camera / view changes never alter the simulation', () => {
    const a = derived();
    for (const camera of ['pitcher', 'side', 'overhead', 'orbit', 'catcher'] as const) {
      useStore.getState().setView({ camera, exaggerate: 5, enlargeBall: false });
      useStore.getState().set({ t: 0.2, rate: 0.03, playing: false });
      expect(derived().result!.traj.samples).toEqual(a.result!.traj.samples);
    }
  });

  it('left-handed pitches mirror right-handed ones (including the knuckleball seam model)', () => {
    const sim = { env: DEFAULT_ENV, dt: 0.001, seam: DEFAULT_SEAM_PARAMS };
    for (const id of ['slider', 'knuckle-2']) {
      const g = gripFromPreset(presetById(id)!);
      const r = estimateRelease(g, DEFAULT_DELIVERY, 'R', null).spec!;
      const l = estimateRelease(g, DEFAULT_DELIVERY, 'L', null).spec!;
      const mr = computePitch(r, sim).metrics!, ml = computePitch(l, sim).metrics!;
      expect(ml.plateX).toBeCloseTo(-mr.plateX, 9);
      expect(ml.plateY).toBeCloseTo(mr.plateY, 9);
      expect(ml.hMoveArmSide).toBeCloseTo(mr.hMoveArmSide, 9);
    }
  });

  it('aim solver hits the requested plate location', () => {
    const sim = { env: DEFAULT_ENV, dt: 0.001, seam: null };
    const spec = estimateRelease(gripFromPreset(PRESETS[4]), DEFAULT_DELIVERY, 'R', null).spec!;
    const aimed = aimAt(spec, sim, { x: 0.1, y: 0.7 });
    const m = computePitch(aimed, sim).metrics!;
    expect(Math.abs(m.plateX - 0.1)).toBeLessThan(0.01);
    expect(Math.abs(m.plateY - 0.7)).toBeLessThan(0.01);
  });
});

describe('knuckleball grip', () => {
  const two = () => gripFromPreset(presetById('knuckle-2')!);
  it('two- and three-finger knuckle grips are selectable and estimate low residual spin', () => {
    for (const id of ['knuckle-2', 'knuckle-3']) {
      const e = estimateRelease(gripFromPreset(presetById(id)!), DEFAULT_DELIVERY, 'R', null);
      expect(e.family).toBe('knuckleball');
      expect(e.spec!.spinRpm).toBeLessThan(120);
      expect(e.residual).not.toBeNull();
    }
  });
  it('contact type, pressure balance and thumb support change the residual-spin estimate', () => {
    const g = two();
    const nail = estimateResidualSpin(g).rpm;
    const tip = estimateResidualSpin({ ...g, fingers: { ...g.fingers, index: { ...g.fingers.index, contact: 'fingertip' }, middle: { ...g.fingers.middle, contact: 'fingertip' } } }).rpm;
    const bent = estimateResidualSpin({ ...g, fingers: { ...g.fingers, index: { ...g.fingers.index, contact: 'knuckle' }, middle: { ...g.fingers.middle, contact: 'knuckle' } } }).rpm;
    expect(nail).toBeLessThan(bent);
    expect(bent).toBeLessThan(tip);
    const uneven = estimateResidualSpin({ ...g, fingers: { ...g.fingers, middle: { ...g.fingers.middle, pressure: 0.95 }, index: { ...g.fingers.index, pressure: 0.15 } } }).rpm;
    expect(uneven).toBeGreaterThan(nail);
    const noThumb = estimateResidualSpin({ ...g, fingers: { ...g.fingers, thumb: { ...g.fingers.thumb, pressure: 0.05 } } }).rpm;
    expect(noThumb).toBeGreaterThan(nail);
  });
  it('user residual-spin assumption replaces the heuristic but stays a grip estimate', () => {
    const g = { ...two(), residualSpinOverride: 7.5 };
    const e = estimateRelease(g, DEFAULT_DELIVERY, 'R', null);
    expect(e.spec!.spinRpm).toBe(7.5);
    expect(e.residual!.overridden).toBe(true);
    expect(e.status).toBe('supported');
  });
  it('knuckleball flight is compared against other pitches by pinning', () => {
    useStore.getState().loadPreset('knuckle-2');
    const k = derived();
    expect(k.seamOn).toBe(true);
    useStore.getState().pin({ label: 'knuckle', family: k.family, mode: 'guided', seamForces: k.seamOn, result: k.result! });
    useStore.getState().loadPreset('four-seam');
    const f = derived();
    expect(f.seamOn).toBe(false);
    expect(useStore.getState().pinned[0].result).toBe(k.result);
    expect(f.result!.metrics!.flightTime).toBeLessThan(k.result!.metrics!.flightTime);
  });
});

describe('saved grips', () => {
  it('save, duplicate, rename and delete persist to localStorage', () => {
    const store: Record<string, string> = {};
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; }, clear: () => {}, key: () => null, length: 0,
    } as Storage;
    const s = useStore.getState();
    s.saveGrip('My heater');
    useStore.getState().duplicateGrip();
    let saved = JSON.parse(store['pitchlab.savedGrips.v1']);
    expect(saved.map((g: Grip) => g.name)).toEqual(['My heater', 'My heater (copy)']);
    useStore.getState().renameSaved(saved[1].id, 'Riser');
    useStore.getState().deleteSaved(saved[0].id);
    saved = JSON.parse(store['pitchlab.savedGrips.v1']);
    expect(saved.map((g: Grip) => g.name)).toEqual(['Riser']);
  });
});
