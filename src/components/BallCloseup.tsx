import { Canvas } from '@react-three/fiber';
import { useState } from 'react';
import * as THREE from 'three';
import { useStore } from '../state/store';
import { Baseball, Arrow } from './Baseball';
import { orientationAt, stateAt, flightEnd } from '../physics/simulate';
import type { PitchResult } from '../physics/pitch';
import type { Vec3 } from '../physics/vec';
import { cross, len, norm, sub, scale, dot } from '../physics/vec';

type CloseView = 'behind' | 'side';

/** Close-up of the ball in a camera frame that travels with it. Shows the true orientation q(t), the spin axis
 *  and the instantaneous force vectors from the simulation samples. */
export function BallCloseup({ res, knuckle }: { res: PitchResult; knuckle: boolean }) {
  const t = useStore((s) => s.t);
  const showForces = useStore((s) => s.view.showForces);
  const [cv, setCv] = useState<CloseView>('behind');
  const [open, setOpen] = useState(() => typeof window === 'undefined' || !window.matchMedia('(max-width: 900px)').matches);
  const traj = res.traj;
  const tc = Math.min(t, flightEnd(traj));
  const st = stateAt(traj, tc);
  const f = norm(st.v);
  const upW: Vec3 = norm(sub([0, 1, 0], scale(f, dot([0, 1, 0], f))));
  const right = norm(cross(f, upW));
  const rows: [Vec3, Vec3, Vec3] = cv === 'behind' ? [right, upW, scale(f, -1)] : [scale(f, -1), upW, scale(right, -1)];
  const m = new THREE.Matrix4().set(
    rows[0][0], rows[0][1], rows[0][2], 0,
    rows[1][0], rows[1][1], rows[1][2], 0,
    rows[2][0], rows[2][1], rows[2][2], 0,
    0, 0, 0, 1,
  );
  const frameQ = new THREE.Quaternion().setFromRotationMatrix(m);
  const q = orientationAt(traj.init, tc);
  const ballQ = new THREE.Quaternion(q[1], q[2], q[3], q[0]);
  const smp = traj.samples[Math.min(traj.samples.length - 1, Math.round(tc / traj.dt))];
  const w = traj.init.omega;
  const axis = len(w) > 0 ? (norm(w) as [number, number, number]) : null;
  const G = 0.145 * 9.80665;
  const arrow = (v: Vec3, c: string, key: string) => {
    const mg = len(v);
    if (mg < 1e-4 || !showForces) return null;
    return <Arrow key={key} dir={norm(v) as [number, number, number]} length={0.9 + 1.1 * Math.min(1.5, mg / G)} color={c} radius={0.035} origin={scale(norm(v), 1.02) as [number, number, number]} />;
  };
  const rpm = (len(w) * 60) / (2 * Math.PI);
  const revs = (rpm / 60) * tc;
  const revsTotal = (rpm / 60) * flightEnd(traj);
  return (
    <div className={`closeup ${open ? '' : 'collapsed'}`}>
      <div className="cu-head">
        <button className="cu-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? '▾' : '▸'} Ball close-up</button>
        {open && <div className="seg mini">
          <button className={cv === 'behind' ? 'on' : ''} onClick={() => setCv('behind')}>Behind</button>
          <button className={cv === 'side' ? 'on' : ''} onClick={() => setCv('side')}>Side</button>
        </div>}
      </div>
      {open && <>
      <div className="cu-canvas">
        <Canvas camera={{ position: [0, 0, 6.2], fov: 40 }} dpr={[1, 2]}>
          <ambientLight intensity={0.65} />
          <directionalLight position={[2, 3, 4]} intensity={1.5} />
          <group quaternion={frameQ}>
            <group quaternion={ballQ}><Baseball radius={1} detail={0.7} /></group>
            {axis && <Arrow dir={axis} length={3} color="#ffd34d" radius={0.03} origin={scale(axis, -1.5) as [number, number, number]} />}
            {arrow(smp.fMagnus, '#34d7ff', 'm')}
            {arrow(smp.fSeam, '#ff5fd2', 's')}
            {arrow(smp.fDrag, '#ff9f43', 'd')}
            {arrow([0, -G, 0], '#f0f0f0', 'g')}
          </group>
        </Canvas>
      </div>
      <div className="cu-stats">
        <div><span>Spin</span><b>{rpm < 100 ? rpm.toFixed(1) : rpm.toFixed(0)} rpm</b></div>
        <div><span>Revolutions</span><b>{revs.toFixed(revsTotal < 3 ? 2 : 1)}</b><em> / {revsTotal.toFixed(revsTotal < 3 ? 2 : 1)} at plate</em></div>
        <div><span>Time</span><b>{tc.toFixed(3)} s</b></div>
        {(knuckle || len(smp.fSeam) > 1e-4) && <div><span>Seam force</span><b>{len(smp.fSeam).toFixed(2)} N</b></div>}
        <div><span>Magnus</span><b>{len(smp.fMagnus).toFixed(2)} N</b></div>
      </div>
      <div className="cu-note">{cv === 'behind' ? 'Looking along the flight path (pitcher behind ball)' : 'Flight path to the left (seen from the 1B side)'}</div>
      </>}
      {!open && <div className="cu-mini">{rpm < 100 ? rpm.toFixed(1) : rpm.toFixed(0)} rpm · {revs.toFixed(2)} rev</div>}
    </div>
  );
}
