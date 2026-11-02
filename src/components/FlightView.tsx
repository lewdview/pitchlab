import { Canvas, useThree } from '@react-three/fiber';
import { Line, OrbitControls, OrthographicCamera, PerspectiveCamera, Html } from '@react-three/drei';
import { useMemo } from 'react';
import * as THREE from 'three';
import { useStore, type CameraView } from '../state/store';
import { useDerived } from '../state/derived';
import { Baseball, Arrow } from './Baseball';
import { exaggerate, pathPoints } from './paths';
import { orientationAt, stateAt, flightEnd, armSideX, type Trajectory } from '../physics/simulate';
import type { PitchResult } from '../physics/pitch';
import {
  BALL_RADIUS, MOUND_CENTER_Z, MOUND_HEIGHT, MOUND_RADIUS, PLATE_FRONT_Z, PLATE_WIDTH, RUBBER_TO_PLATE, IN,
} from '../physics/constants';
import { len, norm } from '../physics/vec';
import { BallCloseup } from './BallCloseup';

const ACTIVE_FROM = new THREE.Color('#44c2ff');
const ACTIVE_TO = new THREE.Color('#ff4d5e');

function Field() {
  const zoneTop = useStore((s) => s.view.zoneTop);
  const zoneBottom = useStore((s) => s.view.zoneBottom);
  const plate = useMemo(() => {
    const h = PLATE_WIDTH / 2;
    const s = new THREE.Shape();
    // shape in (x, z) -> drawn in XY then rotated onto the ground
    s.moveTo(-h, PLATE_FRONT_Z); s.lineTo(h, PLATE_FRONT_Z); s.lineTo(h, h); s.lineTo(0, 0); s.lineTo(-h, h); s.closePath();
    return s;
  }, []);
  const hw = PLATE_WIDTH / 2;
  const zone: [number, number, number][] = [
    [-hw, zoneBottom, PLATE_FRONT_Z], [hw, zoneBottom, PLATE_FRONT_Z], [hw, zoneTop, PLATE_FRONT_Z], [-hw, zoneTop, PLATE_FRONT_Z], [-hw, zoneBottom, PLATE_FRONT_Z],
  ];
  const thirdsX = [-hw / 3, hw / 3];
  const dy = (zoneTop - zoneBottom) / 3;
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.002, 9]}>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial color="#14301f" roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.001, 0.3]}>
        <circleGeometry args={[4, 48]} />
        <meshStandardMaterial color="#4a3426" roughness={1} />
      </mesh>
      {/* mound: 18 ft diameter, 10 in high */}
      <mesh position={[0, MOUND_HEIGHT / 2, MOUND_CENTER_Z]}>
        <cylinderGeometry args={[MOUND_RADIUS * 0.35, MOUND_RADIUS, MOUND_HEIGHT, 48]} />
        <meshStandardMaterial color="#5a3f2c" roughness={1} />
      </mesh>
      <mesh position={[0, MOUND_HEIGHT + 0.01, RUBBER_TO_PLATE + 3 * IN]}>
        <boxGeometry args={[24 * IN, 0.02, 6 * IN]} />
        <meshStandardMaterial color="#f5f5f5" />
      </mesh>
      <mesh rotation-x={Math.PI / 2} position={[0, 0.004, 0]}>
        <shapeGeometry args={[plate]} />
        <meshStandardMaterial color="#f7f7f2" side={THREE.DoubleSide} />
      </mesh>
      <Line points={zone} color="#e8eefc" lineWidth={1.5} transparent opacity={0.85} />
      {thirdsX.map((x) => <Line key={x} points={[[x, zoneBottom, PLATE_FRONT_Z], [x, zoneTop, PLATE_FRONT_Z]]} color="#e8eefc" lineWidth={0.6} transparent opacity={0.3} />)}
      {[1, 2].map((i) => <Line key={i} points={[[-hw, zoneBottom + dy * i, PLATE_FRONT_Z], [hw, zoneBottom + dy * i, PLATE_FRONT_Z]]} color="#e8eefc" lineWidth={0.6} transparent opacity={0.3} />)}
    </group>
  );
}

function TrajectoryLine({ res, k, color, gradient, width = 2.5, opacity = 1, showRef = false, crossingMarker = true }: { res: PitchResult; k: number; color?: string; gradient?: boolean; width?: number; opacity?: number; showRef?: boolean; crossingMarker?: boolean }) {
  const pts = useMemo(() => pathPoints(res.traj, res.ref, k), [res, k]);
  const colors = useMemo(() => {
    if (!gradient) return undefined;
    const n = pts.length;
    return pts.map((_, i) => ACTIVE_FROM.clone().lerp(ACTIVE_TO, i / Math.max(1, n - 1)));
  }, [pts, gradient]);
  const refPts = useMemo(() => (showRef ? pathPoints(res.ref, res.ref, 1) : null), [res, showRef]);
  const c = res.traj.crossing;
  const cp = c ? exaggerate(c.p, res.ref, k) : null;
  return (
    <group>
      {pts.length > 1 && <Line points={pts} color={gradient ? 'white' : color} vertexColors={colors} lineWidth={width} transparent={opacity < 1} opacity={opacity} />}
      {refPts && refPts.length > 1 && <Line points={refPts} color="#cfd8ee" lineWidth={1.2} dashed dashSize={0.25} gapSize={0.18} transparent opacity={0.75} />}
      {crossingMarker && cp && (
        <mesh position={cp} rotation-x={0}>
          <torusGeometry args={[0.04, 0.005, 8, 32]} />
          <meshBasicMaterial color={gradient ? '#ff4d5e' : color} transparent opacity={Math.max(0.5, opacity)} />
        </mesh>
      )}
    </group>
  );
}

function MovingBall({ res, k, ballScale }: { res: PitchResult; k: number; ballScale: number }) {
  const t = useStore((s) => s.t);
  const showForces = useStore((s) => s.view.showForces);
  const rate = useStore((s) => s.rate);
  const playing = useStore((s) => s.playing);
  const traj = res.traj;
  const tc = Math.min(t, flightEnd(traj));
  const st = stateAt(traj, tc);
  const p = exaggerate(st.p, res.ref, k);
  const q = orientationAt(traj.init, tc);
  const r = BALL_RADIUS * ballScale;
  const omega = traj.init.omega;
  const axis = len(omega) > 0 ? (norm(omega) as [number, number, number]) : null;
  const smp = traj.samples[Math.min(traj.samples.length - 1, Math.round(tc / traj.dt))];
  const showF = showForces && (!playing || rate <= 0.25);
  const kF = 0.14; // metres per newton (display only)
  const forces: [string, [number, number, number], number][] = showF
    ? [
        ['#f0f0f0', [0, -1, 0], 0.145 * 9.80665],
        ['#ff9f43', norm(smp.fDrag) as [number, number, number], len(smp.fDrag)],
        ['#34d7ff', norm(smp.fMagnus) as [number, number, number], len(smp.fMagnus)],
        ['#ff5fd2', norm(smp.fSeam) as [number, number, number], len(smp.fSeam)],
      ]
    : [];
  return (
    <group position={p}>
      <group quaternion={new THREE.Quaternion(q[1], q[2], q[3], q[0])}>
        <Baseball radius={r} detail={0.6} />
      </group>
      {axis && <Arrow dir={axis} length={r * 3} color="#ffd34d" radius={r * 0.12} origin={[-axis[0] * r * 1.5, -axis[1] * r * 1.5, -axis[2] * r * 1.5]} />}
      {forces.map(([c, d, m]) => (m > 1e-4 ? <Arrow key={c} dir={d} length={m * kF} color={c} radius={0.006} /> : null))}
    </group>
  );
}

function ReleaseMarker({ traj }: { traj: Trajectory }) {
  const p = traj.init.p;
  return (
    <group>
      <mesh position={p}>
        <sphereGeometry args={[0.035, 16, 12]} />
        <meshBasicMaterial color="#ffd34d" />
      </mesh>
      <Line points={[p, [p[0], 0, p[2]]]} color="#ffd34d" lineWidth={1} dashed dashSize={0.06} gapSize={0.05} transparent opacity={0.7} />
      <Html position={[p[0], p[1] + 0.18, p[2]]} center style={{ pointerEvents: 'none' }}><div className="cue">release</div></Html>
    </group>
  );
}

function Cameras({ view, release }: { view: CameraView; release: [number, number, number] }) {
  const size = useThree((s) => s.size);
  if (view === 'side') {
    const zoom = Math.min(size.width / 21, size.height / 4.2);
    return <OrthographicCamera key="side" makeDefault position={[-30, 1.1, 9.4]} zoom={zoom} near={0.1} far={100} onUpdate={(c) => c.lookAt(0, 1.1, 9.4)} />;
  }
  if (view === 'overhead') {
    const zoom = Math.min(size.height / 21, size.width / 4.5);
    return <OrthographicCamera key="top" makeDefault position={[0, 30, 9.4]} up={[0, 0, 1]} zoom={zoom} near={0.1} far={100} onUpdate={(c) => { c.up.set(0, 0, 1); c.lookAt(0, 0, 9.4); }} />;
  }
  if (view === 'pitcher') {
    return <PerspectiveCamera key="pitcher" makeDefault position={[release[0] * 0.4, 2.05, release[2] + 2.6]} fov={16} near={0.05} far={200} onUpdate={(c) => c.lookAt(0, 0.85, 0)} />;
  }
  if (view === 'catcher') {
    return <PerspectiveCamera key="catcher" makeDefault position={[0, 0.95, -2.3]} fov={24} near={0.05} far={200} onUpdate={(c) => c.lookAt(0, 1.25, 16)} />;
  }
  return (
    <>
      <PerspectiveCamera key="orbit" makeDefault position={[-6, 3.2, -3]} fov={40} near={0.05} far={300} />
      <OrbitControls target={[0, 1, 8]} makeDefault />
    </>
  );
}

export const VIEW_INFO: Record<CameraView, { title: string; left: string; right: string }> = {
  catcher: { title: "Catcher's view — looking toward the mound", left: '◀ 3B side', right: '1B side ▶' },
  pitcher: { title: "Pitcher's view — looking toward home plate", left: '◀ 1B side', right: '3B side ▶' },
  side: { title: 'Side view from the first-base side (orthographic, true scale)', left: '◀ home plate', right: 'mound ▶' },
  overhead: { title: 'Overhead (orthographic, true scale) — mound at top', left: '◀ 3B side', right: '1B side ▶' },
  orbit: { title: 'Free orbit — drag to rotate, scroll to zoom', left: '', right: '' },
};

export function FlightView() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const hand = useStore((s) => s.hand);
  const pinned = useStore((s) => s.pinned);
  const overlay = useStore((s) => s.overlay);
  const { result, estimate, family } = useDerived();
  const k = view.exaggerate;
  // The catcher camera sits right behind the plate, so enlargement there would be misleading; keep true size.
  const ballScale = view.enlargeBall && view.camera !== 'catcher' ? 3 : 1;
  const release = (result?.traj.init.p ?? [0.5, 1.8, 16.5]) as [number, number, number];
  const info = VIEW_INFO[view.camera];
  const armOnLeft = view.camera === 'catcher' || view.camera === 'overhead' ? armSideX(hand) > 0 : view.camera === 'pitcher' ? armSideX(hand) < 0 : null;

  return (
    <div className="flight-view">
      <div className="fv-toolbar">
        <div className="seg" role="radiogroup" aria-label="Camera">
          {(['pitcher', 'catcher', 'side', 'overhead', 'orbit'] as CameraView[]).map((c) => (
            <button key={c} role="radio" aria-checked={view.camera === c} className={view.camera === c ? 'on' : ''} onClick={() => setView({ camera: c })}>
              {{ pitcher: 'Pitcher', catcher: 'Catcher', side: 'Side', overhead: 'Overhead', orbit: 'Orbit' }[c]}
            </button>
          ))}
        </div>
      </div>
      <div className="fv-canvas">
        <Canvas dpr={[1, 2]} gl={{ antialias: true }}>
          <color attach="background" args={['#0a1428']} />
          <fog attach="fog" args={['#0a1428', 35, 70]} />
          <ambientLight intensity={0.6} />
          <directionalLight position={[-5, 12, 4]} intensity={1.4} />
          <Cameras view={view.camera} release={release} />
          <Field />
          {pinned.filter((p) => p.visible).map((p) => <TrajectoryLine key={p.id} res={p.result} k={k} color={p.color} width={2} />)}
          {overlay && overlay.results.map((r, i) => (
            <TrajectoryLine key={i} res={r} k={k} color={overlay.kind === 'ensemble' ? '#ffb347' : `hsl(${200 + (i / Math.max(1, overlay.results.length - 1)) * 140}, 90%, 65%)`} width={overlay.kind === 'ensemble' ? 1 : 1.6} opacity={overlay.kind === 'ensemble' ? 0.55 : 0.9} />
          ))}
          {result && (
            <>
              <TrajectoryLine res={result} k={k} gradient width={3} showRef={view.showRef} />
              <ReleaseMarker traj={result.traj} />
              <MovingBall res={result} k={k} ballScale={ballScale} />
            </>
          )}
        </Canvas>
        <div className="fv-label">
          <div className="fv-title">{info.title}</div>
          {info.left && <div className="fv-sides"><span>{info.left}</span><span>{info.right}</span></div>}
          {armOnLeft !== null && <div className="fv-arm">{hand === 'R' ? 'RHP' : 'LHP'} arm side is on the <b>{armOnLeft ? 'left' : 'right'}</b> of this view</div>}
        </div>
        {k > 1 && <div className="exag-banner">MOVEMENT EXAGGERATED ×{k} <span>deviation from the dashed no-lift path is scaled for display; the physics is unchanged</span></div>}
        <div className="fv-legend">
          <span><i className="sw grad" /> pitch (release → plate)</span>
          {view.showRef && <span><i className="sw dash" /> no-lift reference (gravity + drag)</span>}
          {ballScale > 1 && <span className="muted">ball drawn 3× size</span>}
          {view.showForces && <span className="forces"><i style={{ background: '#f0f0f0' }} />gravity <i style={{ background: '#ff9f43' }} />drag <i style={{ background: '#34d7ff' }} />Magnus <i style={{ background: '#ff5fd2' }} />seam <i style={{ background: '#ffd34d' }} />spin axis <em>(paused or ≤¼ speed)</em></span>}
        </div>
        {!result && (
          <div className="fv-empty">
            <b>No estimate for this grip.</b>
            <span>It is outside the supported preset neighbourhoods (nearest: {estimate.nearest[0].preset.name}, distance {estimate.distance.toFixed(1)}). Pick a starting family or enter release conditions in Physics mode.</span>
          </div>
        )}
        {result && <BallCloseup res={result} knuckle={family === 'knuckleball'} />}
      </div>
    </div>
  );
}
