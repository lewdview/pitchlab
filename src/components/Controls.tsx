import { useStore, seamEuler } from '../state/store';
import { useDerived } from '../state/derived';
import { NumField, Section, Seg } from './ui';
import { FAMILY_LABELS, type PitchFamily } from '../grip/types';
import { PRESETS } from '../grip/presets';
import { qFromEuler } from '../physics/vec';
import { airDensity } from '../physics/atmosphere';
import {
  tiltToClock, speedToDisplay, speedFromDisplay, speedUnit, lenToDisplay, lenFromDisplay, lenUnit,
} from '../util/units';
import { IN } from '../physics/constants';

function EstimateCard() {
  const { estimate } = useDerived();
  const mode = useStore((s) => s.mode);
  const familyOverride = useStore((s) => s.familyOverride);
  const setFamilyOverride = useStore((s) => s.setFamilyOverride);
  const enterPhysics = useStore((s) => s.enterPhysicsMode);
  if (estimate.status === 'unsupported' || estimate.status === 'family-override') {
    return (
      <div className={`est-card ${estimate.status === 'unsupported' ? 'warn' : 'caution'}`}>
        <div className="est-h">{estimate.status === 'unsupported' ? 'Unsupported grip: no estimate' : 'Low-confidence estimate'}</div>
        <p>
          This finger arrangement is outside the neighbourhoods of the representative grips (nearest:{' '}
          <b>{estimate.nearest[0].preset.name}</b>, distance {estimate.nearest[0].distance.toFixed(2)}). PitchLab will not invent a confident prediction.
        </p>
        <div className="row wrap">
          <label>Start from a family:&nbsp;
            <select value={familyOverride ?? ''} onChange={(e) => {
              const v = e.target.value;
              if (!v) return setFamilyOverride(null);
              const p = PRESETS.find((x) => x.id === v)!;
              setFamilyOverride(p.family, p.id);
            }}>
              <option value="">— choose —</option>
              {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {mode === 'guided' && <button className="btn" onClick={() => enterPhysics(estimate.spec)}>Enter release conditions</button>}
        </div>
        {estimate.status === 'family-override' && <ul className="notes">{estimate.notes.map((n, i) => <li key={i}><b>{n.label}</b><span>{n.detail}</span></li>)}</ul>}
      </div>
    );
  }
  return (
    <div className="est-card">
      <div className="est-h">Guided estimate: {estimate.family ? FAMILY_LABELS[estimate.family as PitchFamily] : ''}</div>
      <ul className="notes">{estimate.notes.map((n, i) => <li key={i}><b>{n.label}</b><span>{n.detail}</span></li>)}</ul>
      {mode === 'physics' && <p className="fine">Physics mode is active: these estimates are not being used.</p>}
    </div>
  );
}

function ModeSwitch() {
  const mode = useStore((s) => s.mode);
  const enter = useStore((s) => s.enterPhysicsMode);
  const restore = useStore((s) => s.restoreGripEstimates);
  const { estimate } = useDerived();
  return (
    <div className="mode-switch">
      <Seg label="Mode" value={mode} options={[['guided', 'Guided (grip → estimate)'], ['physics', 'Physics (direct release)']]} onChange={(m) => (m === 'physics' ? enter(estimate.spec) : restore())} />
      {mode === 'physics' ? (
        <div className="lock-note">🔒 Release speed, spin and seam orientation are <b>locked</b> to your values. Editing the grip will not change them. <button className="link" onClick={restore}>Restore grip estimates</button></div>
      ) : (
        <div className="fine">Grip changes update the estimated speed, spin rate and spin axis. Delivery settings below stay under your control.</div>
      )}
    </div>
  );
}

function SpinControls() {
  const mode = useStore((s) => s.mode);
  const manual = useStore((s) => s.manual);
  const setManual = useStore((s) => s.setManual);
  const hand = useStore((s) => s.hand);
  const units = useStore((s) => s.view.units);
  const { spec, family } = useDerived();
  const knuckle = family === 'knuckleball';
  if (mode === 'physics' && manual) {
    const e = seamEuler(manual.seamQuat);
    const lowSpin = knuckle || manual.spinRpm < 300;
    return (
      <div>
        <NumField label="Release velocity" value={speedToDisplay(manual.speed, units)} min={speedToDisplay(15, units)} max={speedToDisplay(48, units)} step={0.1} unit={speedUnit(units)} onChange={(v) => setManual({ speed: speedFromDisplay(v, units) })} />
        <NumField label="Spin rate" value={manual.spinRpm} min={0} max={lowSpin ? 300 : 3600} step={lowSpin ? 0.1 : 5} digits={lowSpin ? 1 : 0} unit="rpm"
          onChange={(v) => setManual({ spinRpm: v })} hint={<>Scale: {lowSpin ? '0–300 rpm fine control' : '0–3600 rpm'} · <button className="link" onClick={() => setManual({ spinRpm: lowSpin ? 1500 : 60 })}>{lowSpin ? 'switch to full range' : 'switch to near-zero range'}</button></>} />
        <NumField label={<>Spin axis tilt <span className="muted">({tiltToClock(manual.tiltDeg, hand)} pitcher's view; + arm side)</span></>} value={manual.tiltDeg} min={-180} max={180} step={0.5} unit="°" onChange={(v) => setManual({ tiltDeg: v })} hint="Direction of the Magnus force: 0° = backspin (up), 180° = topspin (down), +90° = toward arm side." />
        <NumField label="Gyro angle" value={manual.gyroDeg} min={-89} max={89} step={0.5} unit="°" onChange={(v) => setManual({ gyroDeg: v })} hint={`Spin efficiency ${(Math.cos((manual.gyroDeg * Math.PI) / 180) * 100).toFixed(0)}%. Gyro spin creates no Magnus force.`} />
        {!knuckle && manual.spinRpm < 300 && <p className="fine">Low spin, but the grip is not a knuckleball grip, so seam-dependent forces are off. Choose a knuckleball grip, or turn on the experimental seam toggle, to include them.</p>}
        <div className="subhead">Initial seam orientation</div>
        <NumField label="Yaw" value={e.yaw} min={-180} max={180} step={0.25} digits={2} unit="°" onChange={(v) => setManual({ seamQuat: qFromEuler(v, e.pitch, e.roll) })} />
        <NumField label="Pitch" value={e.pitch} min={-90} max={90} step={0.25} digits={2} unit="°" onChange={(v) => setManual({ seamQuat: qFromEuler(e.yaw, v, e.roll) })} />
        <NumField label="Roll" value={e.roll} min={-180} max={180} step={0.25} digits={2} unit="°" onChange={(v) => setManual({ seamQuat: qFromEuler(e.yaw, e.pitch, v) })} />
      </div>
    );
  }
  if (!spec) return <p className="fine">No estimated spin: the grip is unsupported.</p>;
  return (
    <div className="readonly">
      <div className="ro"><span>Estimated release velocity</span><b>{speedToDisplay(spec.speed, units).toFixed(1)} {speedUnit(units)}</b></div>
      <div className="ro"><span>Estimated spin rate</span><b>{spec.spinRpm.toFixed(spec.spinRpm < 300 ? 1 : 0)} rpm</b></div>
      <div className="ro"><span>Estimated spin axis</span><b>{spec.tiltDeg.toFixed(0)}° · {tiltToClock(spec.tiltDeg, hand)}</b></div>
      <div className="ro"><span>Spin efficiency</span><b>{(Math.cos((spec.gyroDeg * Math.PI) / 180) * 100).toFixed(0)}%</b></div>
      <p className="fine">These come from the grip estimate. Switch to Physics mode to set them directly.</p>
    </div>
  );
}

function DeliveryControls() {
  const d = useStore((s) => s.delivery);
  const setD = useStore((s) => s.setDelivery);
  const mode = useStore((s) => s.mode);
  const units = useStore((s) => s.view.units);
  const aim = useStore((s) => s.aim);
  const { spec } = useDerived();
  return (
    <div>
      {mode === 'guided' && (
        <NumField label="Arm speed (fastball velocity)" value={speedToDisplay(d.armSpeedMph * 0.44704, units)} min={speedToDisplay(26.8, units)} max={speedToDisplay(46, units)} step={0.1} unit={speedUnit(units)} onChange={(v) => setD({ armSpeedMph: speedFromDisplay(v, units) / 0.44704 })} hint="Each pitch family releases at a fraction of this." />
      )}
      <NumField label="Release height" value={lenToDisplay(d.releaseHeight, units)} min={lenToDisplay(0.9, units)} max={lenToDisplay(2.4, units)} step={0.01} digits={2} unit={lenUnit(units)} onChange={(v) => setD({ releaseHeight: lenFromDisplay(v, units) })} />
      <NumField label="Extension" value={lenToDisplay(d.extension, units)} min={lenToDisplay(1.0, units)} max={lenToDisplay(2.5, units)} step={0.01} digits={2} unit={lenUnit(units)} onChange={(v) => setD({ extension: lenFromDisplay(v, units) })} hint="Distance in front of the rubber at release; longer extension shortens the flight." />
      <NumField label="Vertical release angle" value={d.vAngleDeg} min={-8} max={8} step={0.05} digits={2} unit="°" onChange={(v) => setD({ vAngleDeg: v })} />
      <NumField label="Horizontal release angle (+ arm side)" value={d.hAngleDeg} min={-8} max={8} step={0.05} digits={2} unit="°" onChange={(v) => setD({ hAngleDeg: v })} />
      <button className="btn wide" onClick={() => aim(spec)} disabled={!spec}>Aim at zone target</button>
    </div>
  );
}

function AdvancedControls() {
  const d = useStore((s) => s.delivery);
  const setD = useStore((s) => s.setDelivery);
  const env = useStore((s) => s.env);
  const setEnv = useStore((s) => s.setEnv);
  const units = useStore((s) => s.view.units);
  const target = useStore((s) => s.aimTarget);
  const set = useStore((s) => s.set);
  const dt = useStore((s) => s.dt);
  return (
    <div>
      <NumField label="Lateral release position (+ arm side)" value={lenToDisplay(d.releaseSide, units)} min={lenToDisplay(-0.5, units)} max={lenToDisplay(1.3, units)} step={0.01} digits={2} unit={lenUnit(units)} onChange={(v) => setD({ releaseSide: lenFromDisplay(v, units) })} />
      <NumField label="Arm slot (0° over the top, 90° sidearm)" value={d.armSlotDeg} min={0} max={100} step={1} digits={0} unit="°" onChange={(v) => setD({ armSlotDeg: v })} hint="Guided mode: rotates the estimated spin axis." />
      <NumField label="Aim target height" value={target.y / IN} min={10} max={50} step={0.5} unit="in" onChange={(v) => set({ aimTarget: { ...target, y: v * IN } })} />
      <NumField label="Aim target side (+ catcher's right)" value={target.x / IN} min={-20} max={20} step={0.5} unit="in" onChange={(v) => set({ aimTarget: { ...target, x: v * IN } })} />
      <div className="subhead">Air and wind (optional)</div>
      <NumField label="Temperature" value={env.temperatureF} min={30} max={110} step={1} digits={0} unit="°F" onChange={(v) => setEnv({ temperatureF: v })} />
      <NumField label="Elevation" value={env.elevationFt} min={0} max={8000} step={50} digits={0} unit="ft" onChange={(v) => setEnv({ elevationFt: v })} />
      <NumField label="Relative humidity" value={env.relativeHumidity * 100} min={0} max={100} step={1} digits={0} unit="%" onChange={(v) => setEnv({ relativeHumidity: v / 100 })} />
      <div className="fine">Air density: <b>{airDensity(env).toFixed(3)} kg/m³</b></div>
      <NumField label="Wind speed" value={env.windMph} min={0} max={30} step={0.5} unit="mph" onChange={(v) => setEnv({ windMph: v })} />
      <NumField label="Wind toward (0° = toward plate, 90° = toward 1B)" value={env.windToDeg} min={0} max={359} step={1} digits={0} unit="°" onChange={(v) => setEnv({ windToDeg: v })} />
      <div className="subhead">Integrator</div>
      <Seg label="Time step" value={String(dt)} options={[['0.002', '2 ms'], ['0.001', '1 ms'], ['0.0005', '0.5 ms'], ['0.00025', '0.25 ms']]} onChange={(v) => set({ dt: parseFloat(v) })} />
      <p className="fine">Fixed-step RK4. Smaller steps should leave plate crossing almost unchanged (convergence check).</p>
    </div>
  );
}

function ViewControls() {
  const v = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  return (
    <div>
      <NumField label="Movement exaggeration" value={v.exaggerate} min={1} max={6} step={1} digits={0} unit="×" onChange={(x) => setView({ exaggerate: Math.round(x) })} hint="1× = true scale. Larger values scale deviation from the no-lift path for display only." />
      <label className="chk"><input type="checkbox" checked={v.showRef} onChange={(e) => setView({ showRef: e.target.checked })} /> Show no-lift reference (dashed)</label>
      <label className="chk"><input type="checkbox" checked={v.showForces} onChange={(e) => setView({ showForces: e.target.checked })} /> Force arrows in slow motion</label>
      <label className="chk"><input type="checkbox" checked={v.enlargeBall} onChange={(e) => setView({ enlargeBall: e.target.checked })} /> Draw ball 3× size for visibility</label>
      <NumField label="Strike zone top" value={v.zoneTop / IN} min={30} max={50} step={0.5} unit="in" onChange={(x) => setView({ zoneTop: x * IN })} />
      <NumField label="Strike zone bottom" value={v.zoneBottom / IN} min={12} max={28} step={0.5} unit="in" onChange={(x) => setView({ zoneBottom: x * IN })} />
      <Seg label="Units" value={v.units} options={[['imperial', 'Imperial'], ['metric', 'Metric']]} onChange={(u) => setView({ units: u })} />
    </div>
  );
}

function SeamForceControls() {
  const seamKnuckle = useStore((s) => s.seamKnuckle);
  const seamExperimental = useStore((s) => s.seamExperimental);
  const set = useStore((s) => s.set);
  const { family } = useDerived();
  return (
    <div>
      <label className="chk"><input type="checkbox" checked={seamKnuckle} onChange={(e) => set({ seamKnuckle: e.target.checked })} /> Knuckleball seam-dependent forces</label>
      <p className="fine">Off = gravity, drag and residual Magnus only (the baseline).</p>
      <label className="chk"><input type="checkbox" checked={seamExperimental} onChange={(e) => set({ seamExperimental: e.target.checked })} /> <span className="badge exp">EXPERIMENTAL</span> Apply the seam model to spinning pitches</label>
      <p className="fine">Off by default. This uncalibrated qualitative model is not a seam-shifted-wake model.{family !== 'knuckleball' && seamExperimental ? ' Active for the current pitch.' : ''}</p>
    </div>
  );
}

export function Controls() {
  return (
    <div className="panel controls">
      <Section title="Mode"><ModeSwitch /><EstimateCard /></Section>
      <Section title="Release: speed & spin"><SpinControls /></Section>
      <Section title="Delivery"><DeliveryControls /></Section>
      <Section title="Advanced delivery · air · integrator" defaultOpen={false}><AdvancedControls /></Section>
      <Section title="Seam-dependent forces" defaultOpen={false}><SeamForceControls /></Section>
      <Section title="Display" defaultOpen={false}><ViewControls /></Section>
    </div>
  );
}
