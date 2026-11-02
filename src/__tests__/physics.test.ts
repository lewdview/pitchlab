import { describe, it, expect } from 'vitest';
import { computePitch, ensembleSpecs, applyVariant, DEFAULT_ENSEMBLE_RANGES, type SimSettings } from '../physics/pitch';
import { initialState, simulate, type ReleaseSpec } from '../physics/simulate';
import { DEFAULT_ENV, airDensity } from '../physics/atmosphere';
import { DEFAULT_SEAM_PARAMS } from '../physics/seamModel';
import { dot, len, sub, qIdentity, qFromEuler, norm } from '../physics/vec';
import { PLATE_FRONT_Z } from '../physics/constants';
import { seamCrossings } from '../physics/seamGeometry';
import { liftCoefficient } from '../physics/aero';

const base: ReleaseSpec = {
  hand: 'R', speed: 40, spinRpm: 2300, tiltDeg: 0, gyroDeg: 0, vAngleDeg: -1.5, hAngleDeg: 0,
  releaseHeight: 1.8, releaseSide: 0.5, extension: 1.9, seamQuat: qIdentity(),
};
const sim: SimSettings = { env: DEFAULT_ENV, dt: 0.001, seam: null };
const simSeam: SimSettings = { ...sim, seam: DEFAULT_SEAM_PARAMS };

const firstMagnus = (spec: ReleaseSpec) => computePitch(spec, sim).traj.samples[0].fMagnus;

describe('Magnus force directions', () => {
  it('backspin pushes up', () => {
    const f = firstMagnus({ ...base, tiltDeg: 0 });
    expect(f[1]).toBeGreaterThan(0.3);
    expect(Math.abs(f[0])).toBeLessThan(1e-9);
  });
  it('topspin pushes down', () => {
    const f = firstMagnus({ ...base, tiltDeg: 180 });
    expect(f[1]).toBeLessThan(-0.3);
  });
  it('arm-side sidespin pushes toward the arm side for both hands', () => {
    const r = firstMagnus({ ...base, tiltDeg: 90, hand: 'R' });
    const l = firstMagnus({ ...base, tiltDeg: 90, hand: 'L' });
    expect(r[0]).toBeGreaterThan(0.3); // RHP arm side = +x (pitcher's right / 3B side)
    expect(l[0]).toBeLessThan(-0.3);
    expect(Math.abs(r[1])).toBeLessThan(0.05);
  });
  it('Magnus force is perpendicular to the velocity', () => {
    const tr = computePitch({ ...base, tiltDeg: 40, gyroDeg: 30 }, sim).traj;
    for (const s of tr.samples.filter((_, i) => i % 50 === 0)) {
      expect(Math.abs(dot(norm(s.fMagnus), norm(s.v)))).toBeLessThan(1e-9);
    }
  });
  it('zero spin produces no Magnus force anywhere in flight', () => {
    expect(liftCoefficient(0, 40)).toBe(0);
    const tr = computePitch({ ...base, spinRpm: 0 }, sim).traj;
    for (const s of tr.samples) expect(len(s.fMagnus)).toBe(0);
    const res = computePitch({ ...base, spinRpm: 0 }, sim);
    expect(res.metrics!.ivb).toBeCloseTo(0, 12);
    expect(res.metrics!.hMove).toBeCloseTo(0, 12);
  });
  it('pure gyro spin produces (almost) no Magnus force', () => {
    const f = firstMagnus({ ...base, gyroDeg: 89.99 });
    expect(len(f)).toBeLessThan(1e-3);
  });
});

describe('integrator', () => {
  it('identical inputs give identical trajectories', () => {
    const a = computePitch({ ...base, tiltDeg: 33, spinRpm: 2250 }, sim);
    const b = computePitch({ ...base, tiltDeg: 33, spinRpm: 2250 }, sim);
    expect(a.traj.samples).toEqual(b.traj.samples);
    expect(a.metrics).toEqual(b.metrics);
  });
  it('smaller steps give nearly identical plate crossings', () => {
    const spec = { ...base, tiltDeg: 35, gyroDeg: 20 };
    const ref = computePitch(spec, { ...sim, dt: 0.00025 }).traj.crossing!;
    for (const dt of [0.002, 0.001, 0.0005]) {
      const c = computePitch(spec, { ...sim, dt }).traj.crossing!;
      expect(len(sub(c.p, ref.p))).toBeLessThan(1e-4); // < 0.1 mm
      expect(Math.abs(c.t - ref.t)).toBeLessThan(1e-6);
    }
  });
  it('interpolates the exact plate crossing', () => {
    const c = computePitch(base, sim).traj.crossing!;
    expect(c.p[2]).toBeCloseTo(PLATE_FRONT_Z, 9);
  });
  it('extension changes flight distance and time', () => {
    const a = computePitch({ ...base, extension: 1.5 }, sim).metrics!;
    const b = computePitch({ ...base, extension: 2.2 }, sim).metrics!;
    expect(b.flightDistance).toBeCloseTo(a.flightDistance - 0.7, 9);
    expect(b.flightTime).toBeLessThan(a.flightTime);
  });
  it('no-lift reference uses gravity + drag only', () => {
    const r = computePitch({ ...base, spinRpm: 2500 }, simSeam).ref;
    for (const s of r.samples) { expect(len(s.fMagnus)).toBe(0); expect(len(s.fSeam)).toBe(0); }
  });
});

describe('seam geometry', () => {
  it('body z spin shows four seams, body x shows two', () => {
    expect(seamCrossings(qIdentity(), [0, 0, 1])).toBe(4);
    expect(seamCrossings(qIdentity(), [1, 0, 0])).toBe(2);
  });
});

describe('knuckleball seam model', () => {
  const kn: ReleaseSpec = { ...base, speed: 33.6, spinRpm: 25, tiltDeg: 180, gyroDeg: 10, vAngleDeg: 0.2, seamQuat: qFromEuler(90, 10, 20) };

  it('disabling seam forces leaves exactly the gravity + drag + residual Magnus baseline', () => {
    const off = computePitch(kn, sim);
    const manual = simulate(initialState(kn), { dt: 0.001, airDensity: airDensity(DEFAULT_ENV), wind: [0, 0, 0], magnus: true, seam: null });
    expect(off.traj.samples).toEqual(manual.samples);
    for (const s of off.traj.samples) expect(len(s.fSeam)).toBe(0);
    const on = computePitch(kn, simSeam);
    expect(len(sub(on.traj.crossing!.p, off.traj.crossing!.p))).toBeGreaterThan(0.01);
  });

  it('small seam-orientation changes move the pitch through the aerodynamic model only', () => {
    const a = computePitch(kn, simSeam).traj.crossing!.p;
    const b = computePitch(applyVariant(kn, 'seamYaw', 2), simSeam).traj.crossing!.p;
    expect(len(sub(a, b))).toBeGreaterThan(5e-4);
    // with seam forces off, orientation has no effect at all
    const c = computePitch(kn, sim).traj.crossing!.p;
    const d = computePitch(applyVariant(kn, 'seamYaw', 2), sim).traj.crossing!.p;
    expect(d).toEqual(c);
  });

  it('small residual-spin changes alter the trajectory', () => {
    const a = computePitch(kn, simSeam).traj.crossing!.p;
    const b = computePitch({ ...kn, spinRpm: 30 }, simSeam).traj.crossing!.p;
    expect(len(sub(a, b))).toBeGreaterThan(5e-4);
  });

  it('trajectories are continuous: acceleration changes smoothly between steps', () => {
    const tr = computePitch(kn, simSeam).traj;
    let maxJump = 0;
    for (let i = 1; i < tr.samples.length; i++) {
      maxJump = Math.max(maxJump, len(sub(tr.samples[i].fSeam, tr.samples[i - 1].fSeam)));
    }
    expect(maxJump).toBeLessThan(0.01); // N per 1 ms step
  });

  it('zero spin is not automatically the largest movement', () => {
    const mv = (rpm: number) => { const m = computePitch({ ...kn, spinRpm: rpm }, simSeam).metrics!; return Math.hypot(m.hMove, m.ivb); };
    const m0 = mv(0);
    const others = [5, 10, 15, 20, 30, 45, 60].map(mv);
    expect(Math.max(...others)).toBeGreaterThan(m0);
  });

  it('a slowly turning knuckleball does not reverse direction repeatedly', () => {
    const tr = computePitch({ ...kn, spinRpm: 20 }, simSeam).traj;
    let flips = 0, prev = 0;
    for (const s of tr.samples) {
      const sx = Math.sign(s.fSeam[0]);
      if (sx && prev && sx !== prev) flips++;
      if (sx) prev = sx;
    }
    expect(flips).toBeLessThanOrEqual(2);
  });

  it('a single knuckleball with fixed inputs always replays identically', () => {
    expect(computePitch(kn, simSeam).traj.samples).toEqual(computePitch(kn, simSeam).traj.samples);
  });

  it('ensemble with a fixed seed is reproducible; a different seed differs', () => {
    const a = ensembleSpecs(kn, DEFAULT_ENSEMBLE_RANGES, 42).map((s) => computePitch(s, simSeam).metrics);
    const b = ensembleSpecs(kn, DEFAULT_ENSEMBLE_RANGES, 42).map((s) => computePitch(s, simSeam).metrics);
    const c = ensembleSpecs(kn, DEFAULT_ENSEMBLE_RANGES, 43).map((s) => computePitch(s, simSeam).metrics);
    expect(a).toHaveLength(20);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});

