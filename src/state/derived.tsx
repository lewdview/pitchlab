import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useStore, simSettings, seamActiveFor, type AppState } from './store';
import { estimateRelease, type ReleaseEstimate } from '../grip/estimate';
import { computePitch, type PitchResult, type SimSettings } from '../physics/pitch';
import type { ReleaseSpec } from '../physics/simulate';
import type { PitchFamily } from '../grip/types';

export interface Derived {
  estimate: ReleaseEstimate;
  spec: ReleaseSpec | null;
  result: PitchResult | null;
  family: PitchFamily | null;
  seamOn: boolean;
  sim: SimSettings;
}

type DeriveInput = Pick<AppState,
  'grip' | 'delivery' | 'hand' | 'familyOverride' | 'overridePresetId' | 'mode' | 'manual' | 'env' | 'dt' |
  'seamParams' | 'seamKnuckle' | 'seamExperimental'>;

/** Pure: grip-estimation layer -> release spec (or the locked manual spec) -> physics. No view state involved. */
export function computeDerived(s: DeriveInput, estimate = estimateRelease(s.grip, s.delivery, s.hand, s.familyOverride, s.overridePresetId)): Derived {
  const family = estimate.family;
  const seamOn = seamActiveFor(family, s);
  const sim = simSettings(s, seamOn);
  let spec: ReleaseSpec | null = estimate.spec;
  if (s.mode === 'physics' && s.manual) {
    const d = s.delivery, m = s.manual;
    spec = {
      hand: s.hand, speed: m.speed, spinRpm: m.spinRpm, tiltDeg: m.tiltDeg, gyroDeg: m.gyroDeg,
      vAngleDeg: d.vAngleDeg, hAngleDeg: d.hAngleDeg, releaseHeight: d.releaseHeight,
      releaseSide: d.releaseSide, extension: d.extension, seamQuat: m.seamQuat,
    };
  }
  const result = spec ? computePitch(spec, sim) : null;
  return { estimate, spec, result, family, seamOn, sim };
}

const Ctx = createContext<Derived | null>(null);

export function DerivedProvider({ children }: { children: ReactNode }) {
  const grip = useStore((s) => s.grip);
  const delivery = useStore((s) => s.delivery);
  const hand = useStore((s) => s.hand);
  const familyOverride = useStore((s) => s.familyOverride);
  const overridePresetId = useStore((s) => s.overridePresetId);
  const mode = useStore((s) => s.mode);
  const manual = useStore((s) => s.manual);
  const env = useStore((s) => s.env);
  const dt = useStore((s) => s.dt);
  const seamParams = useStore((s) => s.seamParams);
  const seamKnuckle = useStore((s) => s.seamKnuckle);
  const seamExperimental = useStore((s) => s.seamExperimental);

  const estimate = useMemo(
    () => estimateRelease(grip, delivery, hand, familyOverride, overridePresetId),
    [grip, delivery, hand, familyOverride, overridePresetId],
  );
  const value = useMemo<Derived>(
    () => computeDerived({ grip, delivery, hand, familyOverride, overridePresetId, mode, manual, env, dt, seamParams, seamKnuckle, seamExperimental }, estimate),
    [estimate, grip, delivery, hand, familyOverride, overridePresetId, mode, manual, env, dt, seamParams, seamKnuckle, seamExperimental],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDerived(): Derived {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDerived outside provider');
  return v;
}
