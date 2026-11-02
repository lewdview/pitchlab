import { useState } from 'react';
import { useStore } from '../state/store';
import { useDerived } from '../state/derived';
import {
  applyVariant, computePitch, ensembleSpecs, DEFAULT_ENSEMBLE_RANGES, VARIANT_LABELS, type EnsembleRanges, type VariantVar,
} from '../physics/pitch';
import { DEFAULT_SEAM_PARAMS, type SeamModelParams } from '../physics/seamModel';
import { classifySeamPattern } from '../physics/seamGeometry';
import { spinAxis, worldSeamQuat, flightEnd } from '../physics/simulate';
import { NumField, Section } from './ui';
import { PlateChart } from './PlateChart';
import { fmtSmall } from '../util/units';
import { MPH } from '../physics/constants';

const SMALL_VARS: [VariantVar, number, string][] = [
  ['seamYaw', 3, '°'], ['seamPitch', 3, '°'], ['seamRoll', 3, '°'], ['spinRpm', 5, 'rpm'], ['vAngleDeg', 0.1, '°'], ['hAngleDeg', 0.1, '°'],
];

function SmallChanges() {
  const { spec, sim } = useDerived();
  const set = useStore((s) => s.set);
  const overlay = useStore((s) => s.overlay);
  const units = useStore((s) => s.view.units);
  const [v, setV] = useState<VariantVar>('seamYaw');
  const [d, setD] = useState(3);
  const unit = SMALL_VARS.find((x) => x[0] === v)![2];
  const run = () => {
    if (!spec) return;
    const ks = [-2, -1, 0, 1, 2];
    const results = ks.map((k) => computePitch(applyVariant(spec, v, k * d), sim));
    set({ overlay: { kind: 'variants', variable: v, title: `Small release changes: ${VARIANT_LABELS[v]}`, subtitle: `±${d} ${unit} steps`, labels: ks.map((k) => `${k > 0 ? '+' : ''}${+(k * d).toFixed(2)} ${unit}`), results }, t: 0, playing: true });
  };
  return (
    <div>
      <div className="row wrap">
        <select value={v} onChange={(e) => { const nv = e.target.value as VariantVar; setV(nv); setD(SMALL_VARS.find((x) => x[0] === nv)![1]); }}>
          {SMALL_VARS.map(([k]) => <option key={k} value={k}>{VARIANT_LABELS[k]}</option>)}
        </select>
        <label>Δ <input className="txt small" type="number" value={d} step={unit === 'rpm' ? 1 : 0.1} onChange={(e) => setD(parseFloat(e.target.value) || 0)} /> {unit}</label>
        <button className="btn primary" onClick={run} disabled={!spec}>Overlay −2Δ … +2Δ</button>
      </div>
      <p className="fine">Five deterministic paths, all from the full aerodynamic model. Each differs only in the chosen release value. Any differences come from the physics, not from added offsets.</p>
      {overlay?.kind === 'variants' && overlay.title.startsWith('Small') && (
        <table className="mini-table">
          <thead><tr><th>Change</th><th>H move</th><th>IVB</th><th>Δ plate vs. centre</th></tr></thead>
          <tbody>
            {overlay.results.map((r, i) => {
              const c = overlay.results[2].metrics;
              const m = r.metrics;
              return (
                <tr key={i}>
                  <td><i className="sw" style={{ background: `hsl(${200 + (i / 4) * 140}, 90%, 65%)` }} /> {overlay.labels[i]}</td>
                  <td>{m ? fmtSmall(m.hMoveArmSide, units, true) : '—'}</td>
                  <td>{m ? fmtSmall(m.ivb, units, true) : '—'}</td>
                  <td>{m && c ? `${fmtSmall(Math.hypot(m.plateX - c.plateX, m.plateY - c.plateY), units)}` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Ensemble() {
  const { spec, sim } = useDerived();
  const set = useStore((s) => s.set);
  const overlay = useStore((s) => s.overlay);
  const units = useStore((s) => s.view.units);
  const [seed, setSeed] = useState(20261102);
  const [r, setR] = useState<EnsembleRanges>(DEFAULT_ENSEMBLE_RANGES);
  const run = () => {
    if (!spec) return;
    const specs = ensembleSpecs(spec, r, seed, 20);
    const results = specs.map((s) => computePitch(s, sim));
    set({ overlay: { kind: 'ensemble', title: 'Throw 20 pitches', subtitle: `seed ${seed}`, labels: results.map((_, i) => `#${i + 1}`), results, seed, ranges: r }, t: 0, playing: true });
  };
  const ens = overlay?.kind === 'ensemble' ? overlay : null;
  const stats = (() => {
    if (!ens) return null;
    const ms = ens.results.map((x) => x.metrics).filter(Boolean) as NonNullable<(typeof ens.results)[0]['metrics']>[];
    if (!ms.length) return null;
    const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
    const xs = ms.map((m) => m.plateX), ys = ms.map((m) => m.plateY);
    return { n: ms.length, sdx: sd(xs), sdy: sd(ys), rx: Math.max(...xs) - Math.min(...xs), ry: Math.max(...ys) - Math.min(...ys) };
  })();
  return (
    <div>
      <div className="sens-banner">SIMULATED SENSITIVITY, NOT A CALIBRATED PROBABILITY FORECAST</div>
      <p className="fine">Each throw draws release values uniformly within the ranges below, using a fixed-seed generator (mulberry32). The same settings and seed always give the same 20 pitches.</p>
      <div className="grid2">
        <NumField label="Seam orientation ± (yaw, pitch, roll each)" value={r.seamDeg} min={0} max={45} step={0.5} unit="°" onChange={(v) => setR({ ...r, seamDeg: v })} />
        <NumField label="Spin rate ±" value={r.spinRpm} min={0} max={200} step={1} digits={0} unit="rpm" onChange={(v) => setR({ ...r, spinRpm: v })} />
        <NumField label="Spin axis tilt ±" value={r.tiltDeg} min={0} max={180} step={1} digits={0} unit="°" onChange={(v) => setR({ ...r, tiltDeg: v })} />
        <NumField label="Release angles ± (vertical & horizontal)" value={r.angleDeg} min={0} max={2} step={0.01} digits={2} unit="°" onChange={(v) => setR({ ...r, angleDeg: v })} />
        <NumField label="Release speed ±" value={r.speedMps / MPH} min={0} max={5} step={0.1} unit="mph" onChange={(v) => setR({ ...r, speedMps: v * MPH })} />
        <NumField label="Random seed" value={seed} min={0} max={4294967295} step={1} digits={0} onChange={(v) => setSeed(Math.round(v))} />
      </div>
      <div className="row">
        <button className="btn primary" onClick={run} disabled={!spec}>Throw 20 pitches</button>
        <button className="btn" onClick={() => setR(DEFAULT_ENSEMBLE_RANGES)}>Default ranges</button>
        {ens && <button className="btn" onClick={() => set({ overlay: null })}>Clear</button>}
      </div>
      {stats && (
        <div className="fine">Spread at the plate ({stats.n} crossings): σx {fmtSmall(stats.sdx, units)}, σy {fmtSmall(stats.sdy, units)}; range {fmtSmall(stats.rx, units)} × {fmtSmall(stats.ry, units)}. Assumed ranges: seam ±{ens!.ranges!.seamDeg}°, spin ±{ens!.ranges!.spinRpm} rpm, tilt ±{ens!.ranges!.tiltDeg}°, angles ±{ens!.ranges!.angleDeg}°, speed ±{(ens!.ranges!.speedMps / MPH).toFixed(1)} mph.</div>
      )}
      {ens && <PlateChart title="20-pitch plate scatter (simulated sensitivity)" showEnsembleLabel />}
    </div>
  );
}

function ModelNotes() {
  const params = useStore((s) => s.seamParams);
  const set = useStore((s) => s.set);
  const hand = useStore((s) => s.hand);
  const { spec, result, family, seamOn } = useDerived();
  const p = (k: keyof SeamModelParams, v: number) => set({ seamParams: { ...params, [k]: v } });
  let status = '—';
  if (spec && result) {
    const revs = (spec.spinRpm / 60) * flightEnd(result.traj);
    const pattern = spec.spinRpm > 0 ? classifySeamPattern(worldSeamQuat(spec.seamQuat, hand), spinAxis(spec)) : 'other';
    const documented = (pattern === 'two-seam' || pattern === 'four-seam') && Math.abs(spec.gyroDeg) <= 30 && revs <= 2;
    status = documented
      ? `Documented configuration: ${pattern} orientation, ${revs.toFixed(2)} rev in flight, mostly transverse axis.`
      : spec.spinRpm === 0
        ? 'Zero spin: the force is set by the fixed initial orientation, so it is steady in direction. Not necessarily the largest movement.'
        : `Extrapolated configuration (${pattern}, gyro ${spec.gyroDeg.toFixed(0)}°, ${revs.toFixed(2)} rev). The same geometry is applied, but outside the configurations the wind-tunnel studies examined.`;
  }
  return (
    <div className="model-notes">
      <div className="tag">Seam forces: <b>{seamOn ? 'ON' : 'OFF'}</b> for the current pitch{family === 'knuckleball' ? ' (knuckleball model)' : ''}.</div>
      <div className="tag">{status}</div>
      <h4>Dedicated low-spin model: qualitative approximation</h4>
      <p>Forces: gravity, drag (Nathan C<sub>D</sub>), residual Magnus from the small spin (Nathan C<sub>L</sub>, zero at zero spin), and a <b>seam-dependent lateral force</b> computed from the actual seam geometry at the ball's current orientation. Orientation is updated continuously as q(t) = Rot(ω̂, |ω|t)·q₀, so slowly rotating seams change the direction and size of the force during flight.</p>
      <p>Each seam sample at angle φ from the front stagnation point contributes along the direction from the flow axis to that point, weighted by a smooth kernel: a positive “trip” lobe (seam just upstream of separation delays separation on that side, pushing the ball toward it) and a negative “separation” lobe (seam at the separation line triggers early separation, pushing the ball away). Symmetric seam layouts cancel. Peak magnitude is normalised to C<sub>peak</sub>.</p>
      <p><b>Basis.</b> Watts &amp; Sawyer (1975, Am. J. Phys. 43:960) measured an orientation-dependent steady lateral force of order 0.1 lbf at about 21 m/s on a non-spinning ball, with fluctuations near critical angles. Morrissey (2009) and Borg &amp; Morrissey (2014, Am. J. Phys. 82:921) measured forces on slowly rotating two-seam and four-seam balls. Nathan (2012) found measured knuckleball paths smooth, with most not changing direction repeatedly. <b>The coefficients below are not fitted to those data.</b> They are replaceable placeholders chosen to give movement of plausible size.</p>
      <p><b>Supported configurations:</b> two-seam and four-seam orientations rotating slowly (≲2 rev in flight) about a mostly transverse axis. <b>Assumptions:</b> no Reynolds-number dependence between 25 and 40 m/s; quasi-steady response; no random or fluctuating component (no noise, offsets or shaking is ever added); force perpendicular to the air-relative velocity. Zero spin does not automatically produce maximum movement: the result depends on the orientation, and a symmetric orientation gives almost none.</p>
      <div className="grid2">
        <NumField label="C_peak (peak lateral coefficient)" value={params.peakCoeff} min={0} max={0.5} step={0.005} digits={3} onChange={(v) => p('peakCoeff', v)} />
        <NumField label="Trip lobe angle" value={params.tripAngleDeg} min={40} max={100} step={0.5} unit="°" onChange={(v) => p('tripAngleDeg', v)} />
        <NumField label="Trip lobe width" value={params.tripWidthDeg} min={2} max={30} step={0.5} unit="°" onChange={(v) => p('tripWidthDeg', v)} />
        <NumField label="Separation lobe angle" value={params.sepAngleDeg} min={80} max={140} step={0.5} unit="°" onChange={(v) => p('sepAngleDeg', v)} />
        <NumField label="Separation lobe width" value={params.sepWidthDeg} min={2} max={30} step={0.5} unit="°" onChange={(v) => p('sepWidthDeg', v)} />
        <NumField label="Separation lobe weight" value={params.sepWeight} min={0} max={2} step={0.05} digits={2} onChange={(v) => p('sepWeight', v)} />
      </div>
      <button className="btn" onClick={() => set({ seamParams: DEFAULT_SEAM_PARAMS })}>Restore default coefficients</button>
      <p className="fine">Replace these with measured values when you have them. The trajectory recomputes immediately.</p>
    </div>
  );
}

export function KnuckleLab() {
  const { family } = useDerived();
  return (
    <div className="panel knuckle-lab">
      {family !== 'knuckleball' && <p className="fine">These tools are built for the knuckleball (choose a knuckleball grip) but work on any pitch.</p>}
      <Section title="Small release changes"><SmallChanges /></Section>
      <Section title="Throw 20 pitches" defaultOpen={family === 'knuckleball'}><Ensemble /></Section>
      <Section title="Knuckleball model & coefficients" defaultOpen={false}><ModelNotes /></Section>
    </div>
  );
}

