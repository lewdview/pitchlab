import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { useDerived } from '../state/derived';
import { flightEnd } from '../physics/simulate';

const RATES: [number, string][] = [[1, 'Real time'], [0.5, '½×'], [0.25, '¼×'], [0.1, '1/10×'], [0.03, '1/33× (seams)']];

export function useFlightEnd(): number {
  const { result } = useDerived();
  const pinned = useStore((s) => s.pinned);
  if (result) return flightEnd(result.traj);
  return pinned.length ? Math.max(...pinned.map((p) => flightEnd(p.result.traj))) : 0.5;
}

/** Wall-clock playback driver. Only advances the display time; the trajectory itself is precomputed with fixed
 *  simulation steps and is independent of frame rate. */
export function usePlaybackLoop(tEnd: number) {
  const playing = useStore((s) => s.playing);
  const rate = useStore((s) => s.rate);
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!playing) { last.current = null; return; }
    let raf = 0;
    const tick = (now: number) => {
      const s = useStore.getState();
      if (last.current != null) {
        const dt = Math.min(0.05, (now - last.current) / 1000) * s.rate;
        const t = s.t + dt;
        if (t >= tEnd) { s.set({ t: tEnd, playing: false }); last.current = null; return; }
        s.set({ t });
      }
      last.current = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, rate, tEnd]);
}

export function Playback() {
  const t = useStore((s) => s.t);
  const playing = useStore((s) => s.playing);
  const rate = useStore((s) => s.rate);
  const set = useStore((s) => s.set);
  const tEnd = useFlightEnd();
  usePlaybackLoop(tEnd);
  const tc = Math.min(t, tEnd);
  return (
    <div className="playback">
      <button className="btn icon-btn" aria-label={playing ? 'Pause' : 'Play'} onClick={() => set(playing ? { playing: false } : { playing: true, t: tc >= tEnd ? 0 : tc })}>
        {playing ? '❚❚' : '▶'}
      </button>
      <button className="btn icon-btn" aria-label="Replay" onClick={() => set({ t: 0, playing: true })}>↺</button>
      <input className="scrub" type="range" min={0} max={tEnd} step={0.0005} value={tc} aria-label="Timeline" onChange={(e) => set({ t: parseFloat(e.target.value), playing: false })} />
      <span className="tnum">{tc.toFixed(3)} / {tEnd.toFixed(3)} s</span>
      <select value={rate} onChange={(e) => set({ rate: parseFloat(e.target.value) })} aria-label="Playback speed">
        {RATES.map(([r, l]) => <option key={r} value={r}>{l}</option>)}
      </select>
    </div>
  );
}
