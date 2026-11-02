import { useEffect, useState } from 'react';
import { DerivedProvider, useDerived } from './state/derived';
import { useStore } from './state/store';
import { GripEditor } from './components/GripEditor';
import { GripPanel } from './components/GripPanel';
import { FlightView } from './components/FlightView';
import { Playback } from './components/Playback';
import { Controls } from './components/Controls';
import { Measurements, KeyMetrics } from './components/Measurements';
import { ComparePanel } from './components/ComparePanel';
import { KnuckleLab } from './components/KnuckleLab';
import { FAMILY_LABELS } from './grip/types';

function useIsMobile() {
  const q = '(max-width: 900px)';
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return m;
}

function Header() {
  const { estimate, family } = useDerived();
  const mode = useStore((s) => s.mode);
  const grip = useStore((s) => s.grip);
  return (
    <header className="app-h">
      <div className="logo"><span className="ball-ico" aria-hidden /> Pitch<b>Lab</b></div>
      <div className="h-status">
        <span className="pill">{grip.name}{grip.custom ? ' (edited)' : ''}</span>
        <span className={`pill ${mode === 'physics' ? 'lock' : ''}`}>{mode === 'physics' ? '🔒 Physics mode' : 'Guided mode'}</span>
        {estimate.status === 'unsupported' ? <span className="pill warn">Unsupported grip</span> : family && <span className="pill">{FAMILY_LABELS[family]}</span>}
      </div>
      <div className="h-hint">Drag a finger on the ball, then watch the spin estimate and trajectory change.</div>
    </header>
  );
}

type RightTab = 'controls' | 'measure' | 'compare' | 'knuckle';

function RightColumn() {
  const [tab, setTab] = useState<RightTab>('controls');
  const { family } = useDerived();
  return (
    <aside className="col right">
      <div className="tabs" role="tablist">
        {([['controls', 'Controls'], ['measure', 'Measurements'], ['compare', 'Compare'], ['knuckle', family === 'knuckleball' ? 'Knuckle lab ●' : 'Knuckle lab']] as [RightTab, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <div className="col-scroll">
        {tab === 'controls' && <Controls />}
        {tab === 'measure' && <Measurements />}
        {tab === 'compare' && <ComparePanel />}
        {tab === 'knuckle' && <KnuckleLab />}
      </div>
    </aside>
  );
}

function Desktop() {
  return (
    <main className="layout">
      <aside className="col left">
        <GripEditor />
        <div className="col-scroll"><GripPanel /></div>
      </aside>
      <section className="col center">
        <FlightView />
        <Playback />
        <KeyMetrics />
      </section>
      <RightColumn />
    </main>
  );
}

function Mobile() {
  const tab = useStore((s) => s.mobileTab);
  const set = useStore((s) => s.set);
  return (
    <main className="mobile">
      <nav className="tabs mob" role="tablist">
        {(['grip', 'flight', 'compare'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => set({ mobileTab: k })}>{{ grip: 'Grip', flight: 'Flight', compare: 'Compare' }[k]}</button>
        ))}
      </nav>
      {/* Tabs stay mounted (hidden with CSS) so 3D canvases keep their state and are not torn down on every switch. */}
      <div className="mtab" hidden={tab !== 'grip'}><GripEditor /><KeyMetrics /><GripPanel /></div>
      <div className="mtab" hidden={tab !== 'flight'}><FlightView /><Playback /><KeyMetrics /><Controls /><Measurements /></div>
      <div className="mtab" hidden={tab !== 'compare'}><ComparePanel /><KnuckleLab /></div>
    </main>
  );
}

export default function App() {
  const mobile = useIsMobile();
  return (
    <DerivedProvider>
      <div className="app">
        <Header />
        {mobile ? <Mobile /> : <Desktop />}
      </div>
    </DerivedProvider>
  );
}
