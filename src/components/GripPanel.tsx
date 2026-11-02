import { useState } from 'react';
import { useStore, seamEuler } from '../state/store';
import { useDerived } from '../state/derived';
import { PRESETS } from '../grip/presets';
import { CONTACT_LABELS, FINGERS, FINGER_META, type ContactType, type FingerId } from '../grip/types';
import { NumField, Section } from './ui';
import { classifySeamPattern } from '../physics/seamGeometry';
import { spinAxis, worldSeamQuat } from '../physics/simulate';

export function PresetPicker() {
  const loadPreset = useStore((s) => s.loadPreset);
  const grip = useStore((s) => s.grip);
  return (
    <div className="presets">
      <div className="preset-grid">
        {PRESETS.map((p) => (
          <button key={p.id} className={`preset ${grip.presetId === p.id && !grip.custom ? 'on' : ''} ${p.family === 'knuckleball' ? 'knuck' : ''}`} onClick={() => loadPreset(p.id)} title={p.blurb}>
            {p.name}
          </button>
        ))}
      </div>
      <p className="fine">Representative starting grips. Pitchers use many variations, so every grip is editable.</p>
    </div>
  );
}

function SavedGrips() {
  const grip = useStore((s) => s.grip);
  const saved = useStore((s) => s.savedGrips);
  const { saveGrip, duplicateGrip, resetGrip, loadSaved, deleteSaved, renameSaved } = useStore.getState();
  const [name, setName] = useState('');
  return (
    <div className="saved">
      <div className="row">
        <input className="txt" placeholder={grip.name} value={name} onChange={(e) => setName(e.target.value)} aria-label="Grip name" />
        <button className="btn primary" onClick={() => { saveGrip(name || grip.name); setName(''); }}>Save</button>
        <button className="btn" onClick={duplicateGrip}>Duplicate</button>
        <button className="btn" onClick={resetGrip} title="Restore the preset this grip started from">Reset</button>
      </div>
      {saved.length > 0 && (
        <ul className="saved-list">
          {saved.map((g) => (
            <li key={g.id} className={g.id === grip.id ? 'on' : ''}>
              <button className="link" onClick={() => loadSaved(g.id)}>{g.name}</button>
              <button className="icon" title="Rename" onClick={() => { const n = prompt('Rename grip', g.name); if (n) renameSaved(g.id, n); }}>✎</button>
              <button className="icon" title="Delete" onClick={() => deleteSaved(g.id)}>✕</button>
            </li>
          ))}
        </ul>
      )}
      <p className="fine">Saved grips are stored in this browser (localStorage).</p>
    </div>
  );
}

function FingerControls() {
  const grip = useStore((s) => s.grip);
  const sel = useStore((s) => s.selectedFinger);
  const set = useStore((s) => s.set);
  const setFinger = useStore((s) => s.setFinger);
  const setSpread = useStore((s) => s.setSpread);
  const { estimate } = useDerived();
  const f = grip.fingers[sel];
  const spread = estimate.features.spread;
  return (
    <div className="fingers">
      <div className="finger-chips" role="listbox" aria-label="Fingers">
        {FINGERS.map((id: FingerId) => (
          <div key={id} className={`fchip ${sel === id ? 'on' : ''}`} style={{ ['--c' as string]: FINGER_META[id].color }}>
            <button role="option" aria-selected={sel === id} onClick={() => set({ selectedFinger: id })}>
              <span className="dot" /> {FINGER_META[id].label}
            </button>
            <input type="checkbox" checked={grip.fingers[id].enabled} aria-label={`Enable ${FINGER_META[id].label}`} onChange={(e) => setFinger(id, { enabled: e.target.checked })} />
          </div>
        ))}
      </div>
      <div className="fine">Selected: <b style={{ color: FINGER_META[sel].color }}>{FINGER_META[sel].label}</b>. Drag it on the ball, use the arrow keys (Shift for fine steps), or type values.</div>
      <NumField label="Around the ball (0 = back, + arm side)" value={f.lon} min={-180} max={180} step={0.5} unit="°" onChange={(v) => setFinger(sel, { lon: v })} />
      <NumField label="Height on the ball (+ top, − underside)" value={f.lat} min={-89} max={89} step={0.5} unit="°" onChange={(v) => setFinger(sel, { lat: v })} />
      <NumField label={sel === 'thumb' ? 'Thumb support (pressure)' : 'Relative pressure'} value={f.pressure} min={0} max={1} step={0.01} digits={2} onChange={(v) => setFinger(sel, { pressure: v })} />
      <NumField label="Contact direction (finger angle on the surface)" value={f.dirDeg} min={-90} max={90} step={1} unit="°" digits={0} onChange={(v) => setFinger(sel, { dirDeg: v })} />
      <div className="numfield">
        <label>Contact type</label>
        <select value={f.contact} onChange={(e) => setFinger(sel, { contact: e.target.value as ContactType })}>
          {(Object.keys(CONTACT_LABELS) as ContactType[]).map((c) => <option key={c} value={c}>{CONTACT_LABELS[c]}</option>)}
        </select>
      </div>
      <HandSizeField />
      {grip.fingers.index.enabled && grip.fingers.middle.enabled && (
        <NumField label="Index–middle spacing" value={spread} min={4} max={90} step={0.5} unit="°" onChange={setSpread} hint="Moves both fingers symmetrically about their midpoint." />
      )}
    </div>
  );
}

function HandSizeField() {
  const size = useStore((s) => s.handSize);
  const set = useStore((s) => s.set);
  return <NumField label="Hand size (display only)" value={size * 100} min={80} max={120} step={1} digits={0} unit="%" onChange={(v) => set({ handSize: v / 100 })} hint="100% ≈ adult hand (middle finger ~3.2 in). Changes only the drawn hand, not the estimate." />;
}

function SeamControls() {
  const grip = useStore((s) => s.grip);
  const hand = useStore((s) => s.hand);
  const setSeamEuler = useStore((s) => s.setSeamEuler);
  const { spec } = useDerived();
  const e = seamEuler(grip.seamQuat);
  const pattern = spec && spec.spinRpm > 0 ? classifySeamPattern(worldSeamQuat(grip.seamQuat, hand), spinAxis(spec)) : null;
  return (
    <div>
      <p className="fine">Rotate the ball inside the hand. The finger contacts stay where they are; use “Rotate grip in hand” on the ball to move both together.</p>
      <NumField label="Yaw (about vertical)" value={e.yaw} min={-180} max={180} step={0.5} unit="°" onChange={(v) => setSeamEuler(v, e.pitch, e.roll)} />
      <NumField label="Pitch (about the arm–glove axis)" value={e.pitch} min={-90} max={90} step={0.5} unit="°" onChange={(v) => setSeamEuler(e.yaw, v, e.roll)} />
      <NumField label="Roll (about the throwing direction)" value={e.roll} min={-180} max={180} step={0.5} unit="°" onChange={(v) => setSeamEuler(e.yaw, e.pitch, v)} />
      {pattern && <div className="tag">Seam pattern about the current spin axis: <b>{pattern}</b></div>}
      <p className="fine">The default flight model has no seam-shifted-wake effect, so for spinning pitches orientation changes the seam pattern label only. The knuckleball model uses seam orientation directly.</p>
    </div>
  );
}

function KnuckleGripControls() {
  const grip = useStore((s) => s.grip);
  const setResidual = useStore((s) => s.setResidualOverride);
  const setFinger = useStore((s) => s.setFinger);
  const { estimate } = useDerived();
  const r = estimate.residual;
  if (!r) return null;
  return (
    <div className="knuckle-grip">
      <div className="est-pill">Grip-based residual spin estimate: <b>{r.heuristicRpm.toFixed(0)} rpm</b> <span className="muted">(plausible range {(r.heuristicRpm * 0.6).toFixed(0)}–{(r.heuristicRpm * 1.4 + 5).toFixed(0)})</span></div>
      <label className="chk">
        <input type="checkbox" checked={grip.residualSpinOverride != null} onChange={(e) => setResidual(e.target.checked ? Math.round(r.heuristicRpm) : null)} />
        Use my own residual-spin assumption for this grip
      </label>
      {grip.residualSpinOverride != null && (
        <NumField label="Assumed residual spin (grip assumption)" value={grip.residualSpinOverride} min={0} max={300} step={0.5} unit="rpm" onChange={(v) => setResidual(v)} hint="Still a grip-based estimate. To set the release exactly, use Physics mode." />
      )}
      <NumField label="Thumb support" value={grip.fingers.thumb.pressure} min={0} max={1} step={0.01} digits={2} onChange={(v) => setFinger('thumb', { pressure: v, enabled: v > 0 })} hint="Firmer support underneath steadies the ball (less spin in the heuristic)." />
      <p className="fine">Contact types for each finger (fingertip, fingernail, bent finger) are set in Finger placement.</p>
    </div>
  );
}

export function GripPanel() {
  const { family } = useDerived();
  return (
    <div className="panel grip-panel">
      <Section title="Starting grip"><PresetPicker /></Section>
      {family === 'knuckleball' && <Section title="Knuckleball grip" badge={<span className="badge k">low spin</span>}><KnuckleGripControls /></Section>}
      <Section title="Finger placement"><FingerControls /></Section>
      <Section title="Seam orientation in hand" defaultOpen={false}><SeamControls /></Section>
      <Section title="Save · duplicate · reset" defaultOpen={false}><SavedGrips /></Section>
    </div>
  );
}
