import { useState } from 'react';
import { useStore, type PinnedPitch } from '../state/store';
import { useDerived } from '../state/derived';
import { applyVariant, computePitch, VARIANT_LABELS, type VariantVar, type PitchResult } from '../physics/pitch';
import type { ReleaseSpec } from '../physics/simulate';
import { fmtSpeed, fmtSmall, fmtLong, tiltToClock } from '../util/units';
import { FAMILY_LABELS } from '../grip/types';
import { PlateChart } from './PlateChart';
import { Section } from './ui';
import { MPH } from '../physics/constants';

const EST_FIELDS: [keyof ReleaseSpec, string, number][] = [['speed', 'speed', 0.05], ['spinRpm', 'spin rate', 1], ['tiltDeg', 'spin tilt', 0.5], ['gyroDeg', 'gyro/efficiency', 0.5]];

function changedEstimates(a: ReleaseSpec, b: ReleaseSpec): string[] {
  return EST_FIELDS.filter(([k, , tol]) => Math.abs((a[k] as number) - (b[k] as number)) > tol).map(([, l]) => l);
}

const VAR_DEFAULT_STEP: Record<VariantVar, number> = {
  spinRpm: 200, tiltDeg: 15, gyroDeg: 15, speed: 1 * MPH, vAngleDeg: 0.5, hAngleDeg: 0.5, seamYaw: 10, seamPitch: 10, seamRoll: 10,
};
const VAR_UNIT: Record<VariantVar, string> = { spinRpm: 'rpm', tiltDeg: '°', gyroDeg: '°', speed: 'mph', vAngleDeg: '°', hAngleDeg: '°', seamYaw: '°', seamPitch: '°', seamRoll: '°' };

export function ChangeOneVariable() {
  const { spec, sim } = useDerived();
  const set = useStore((s) => s.set);
  const overlay = useStore((s) => s.overlay);
  const [v, setV] = useState<VariantVar>('tiltDeg');
  const [step, setStep] = useState<number>(15);
  const run = () => {
    if (!spec) return;
    const d = v === 'speed' ? step * MPH : step;
    const deltas = [-2, -1, 0, 1, 2];
    const results: PitchResult[] = deltas.map((k) => computePitch(applyVariant(spec, v, k * d), sim));
    set({
      overlay: {
        kind: 'variants', variable: v, title: `Change one variable: ${VARIANT_LABELS[v]}`,
        subtitle: `${deltas.map((k) => `${k > 0 ? '+' : ''}${(k * step).toFixed(v === 'vAngleDeg' || v === 'hAngleDeg' ? 2 : 0)}`).join(', ')} ${VAR_UNIT[v]}; all other release settings held constant`,
        labels: deltas.map((k) => `${k > 0 ? '+' : ''}${(k * step).toFixed(2)} ${VAR_UNIT[v]}`), results,
      },
      t: 0, playing: true,
    });
  };
  return (
    <div className="cov">
      <div className="row wrap">
        <select value={v} onChange={(e) => { const nv = e.target.value as VariantVar; setV(nv); setStep(nv === 'speed' ? 1 : VAR_DEFAULT_STEP[nv]); }}>
          {(Object.keys(VARIANT_LABELS) as VariantVar[]).map((k) => <option key={k} value={k}>{VARIANT_LABELS[k]}</option>)}
        </select>
        <label>step <input className="txt small" type="number" value={step} step={v === 'vAngleDeg' || v === 'hAngleDeg' ? 0.05 : 1} onChange={(e) => setStep(parseFloat(e.target.value) || 0)} /> {VAR_UNIT[v]}</label>
        <button className="btn primary" onClick={run} disabled={!spec}>Overlay 5 paths</button>
        {overlay && <button className="btn" onClick={() => set({ overlay: null })}>Clear overlay</button>}
      </div>
      <p className="fine">Starts from the current release conditions, whether estimated or manual, and changes only the chosen variable. Unlike guided grip edits, nothing else moves with it.</p>
      {overlay?.kind === 'variants' && <OverlayTable />}
    </div>
  );
}

function OverlayTable() {
  const overlay = useStore((s) => s.overlay)!;
  const units = useStore((s) => s.view.units);
  return (
    <table className="mini-table">
      <thead><tr><th>{overlay.variable ? VARIANT_LABELS[overlay.variable] : 'Variant'}</th><th>H move</th><th>IVB</th><th>Plate (x, y)</th></tr></thead>
      <tbody>
        {overlay.results.map((r, i) => (
          <tr key={i}>
            <td><i className="sw" style={{ background: `hsl(${200 + (i / Math.max(1, overlay.results.length - 1)) * 140}, 90%, 65%)` }} /> {overlay.labels[i]}</td>
            <td>{r.metrics ? fmtSmall(r.metrics.hMoveArmSide, units, true) : '—'}</td>
            <td>{r.metrics ? fmtSmall(r.metrics.ivb, units, true) : '—'}</td>
            <td>{r.metrics ? `${fmtSmall(r.metrics.plateX, units, true)}, ${fmtLong(r.metrics.plateY, units)}` : 'no crossing'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PinCard({ p, active }: { p: PinnedPitch; active: ReleaseSpec | null }) {
  const units = useStore((s) => s.view.units);
  const unpin = useStore((s) => s.unpin);
  const toggle = useStore((s) => s.togglePinVisible);
  const m = p.result.metrics;
  const s = p.result.spec;
  const changed = active && p.mode === 'guided' ? changedEstimates(s, active) : [];
  return (
    <div className="pin-card" style={{ ['--c' as string]: p.color }}>
      <div className="pin-h">
        <i className="sw" style={{ background: p.color }} />
        <b>{p.label}</b>
        <span className="muted">{p.family ? FAMILY_LABELS[p.family] : 'manual'} · {p.mode}{p.seamForces ? ' · seam forces' : ''}</span>
        <button className="icon" onClick={() => toggle(p.id)} title={p.visible ? 'Hide' : 'Show'}>{p.visible ? '◉' : '○'}</button>
        <button className="icon" onClick={() => unpin(p.id)} title="Remove">✕</button>
      </div>
      <div className="pin-grid">
        <span>Release</span><b>{fmtSpeed(s.speed, units)}</b>
        <span>Spin</span><b>{s.spinRpm.toFixed(s.spinRpm < 300 ? 1 : 0)} rpm · {tiltToClock(s.tiltDeg, s.hand)} · {(Math.cos((s.gyroDeg * Math.PI) / 180) * 100).toFixed(0)}% eff</b>
        <span>Angles</span><b>{s.vAngleDeg.toFixed(2)}° v · {s.hAngleDeg.toFixed(2)}° h</b>
        <span>Release pt</span><b>{fmtLong(s.releaseHeight, units)} high · {fmtLong(s.extension, units)} ext.</b>
        {m ? (
          <>
            <span>Plate velo</span><b>{fmtSpeed(m.plateSpeed, units)} · {m.flightTime.toFixed(3)} s</b>
            <span>H move</span><b>{fmtSmall(Math.abs(m.hMoveArmSide), units)} {m.hMoveArmSide >= 0 ? 'arm' : 'glove'} side</b>
            <span>IVB / drop</span><b>{fmtSmall(m.ivb, units, true)} / {fmtSmall(m.totalDrop, units)}</b>
            <span>Plate</span><b>{fmtSmall(m.plateX, units, true)}, {fmtLong(m.plateY, units)}</b>
          </>
        ) : <><span>Result</span><b>no plate crossing</b></>}
      </div>
      {p.mode === 'guided' && active && (
        <div className={`chg ${changed.length > 1 ? 'multi' : ''}`}>
          {changed.length === 0 ? 'Same estimated release as the active pitch.' : `vs. active pitch: ${changed.length} estimated setting${changed.length > 1 ? 's' : ''} changed together (${changed.join(', ')})`}
        </div>
      )}
    </div>
  );
}

export function ComparePanel() {
  const pinned = useStore((s) => s.pinned);
  const pin = useStore((s) => s.pin);
  const grip = useStore((s) => s.grip);
  const mode = useStore((s) => s.mode);
  const { result, family, seamOn, spec } = useDerived();
  return (
    <div className="panel compare">
      <Section title={`Pinned pitches (${pinned.length}/4)`}>
        <button className="btn primary wide" disabled={!result || pinned.length >= 4} onClick={() => result && pin({ label: grip.name, family, mode, seamForces: seamOn, result })}>
          📌 Pin current pitch{pinned.length >= 4 ? ' (max 4)' : ''}
        </button>
        <p className="fine">Pinned pitches keep their own release settings and results while you keep editing the active grip.</p>
        {pinned.map((p) => <PinCard key={p.id} p={p} active={spec} />)}
      </Section>
      <Section title="Change one variable"><ChangeOneVariable /></Section>
      <Section title="Plate locations"><PlateChart showEnsembleLabel /></Section>
    </div>
  );
}
