import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useStore } from '../state/store';
import { useDerived } from '../state/derived';
import { Baseball, Arrow } from './Baseball';
import { FINGERS, FINGER_META, vectorToContact, toWorld, type FingerId, type FingerContact } from '../grip/types';
import { worldSeamQuat, spinAxis } from '../physics/simulate';
import type { Quat, Vec3 } from '../physics/vec';
import { qAxisAngle, qMul } from '../physics/vec';
import type { Hand } from '../physics/simulate';
import { HandViz } from './HandViz';


type ViewPreset = 'back' | 'front' | 'arm' | 'glove' | 'top' | 'bottom';
const VIEW_LABEL: Record<ViewPreset, string> = { back: "Pitcher's view (back)", front: 'Front (toward plate)', arm: 'Arm side', glove: 'Glove side', top: 'Top', bottom: 'Underside' };

function viewPosition(v: ViewPreset, hand: Hand): [number, number, number] {
  const s = hand === 'R' ? 1 : -1;
  switch (v) {
    case 'back': return [0.5 * s, 1.4, 4.6];
    case 'front': return [0, 0.9, -4.8];
    case 'arm': return [4.8 * s, 0.7, 0.5];
    case 'glove': return [-4.8 * s, 0.7, 0.5];
    case 'top': return [0, 4.9, 0.8];
    case 'bottom': return [0, -4.9, 0.8];
  }
}

function CameraRig({ preset, hand, nonce }: { preset: ViewPreset; hand: Hand; nonce: number }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  useEffect(() => {
    camera.position.set(...viewPosition(preset, hand));
    camera.lookAt(0, 0, 0);
    if (controls) { controls.target.set(0, 0, 0); controls.update(); }
  }, [preset, hand, nonce, camera, controls]);
  return null;
}

function raySphere(ray: THREE.Ray, r = 1): THREE.Vector3 {
  const hit = new THREE.Vector3();
  const sphere = new THREE.Sphere(new THREE.Vector3(), r);
  if (ray.intersectSphere(sphere, hit)) return hit;
  // Missed: snap to the silhouette point closest to the ray.
  const closest = new THREE.Vector3();
  ray.closestPointToPoint(new THREE.Vector3(), closest);
  return closest.normalize().multiplyScalar(r);
}

function FingerMarker({ id, f, hand, selected, onDragState }: { id: FingerId; f: FingerContact; hand: Hand; selected: boolean; onDragState: (d: boolean) => void }) {
  const setFinger = useStore((s) => s.setFinger);
  const setSel = useStore((s) => s.set);
  const dragging = useRef(false);
  const p = toWorld(f, hand);
  const meta = FINGER_META[id];
  const quat = useMemo(() => {
    const n = new THREE.Vector3(...p).normalize();
    let north = new THREE.Vector3(0, 1, 0).sub(n.clone().multiplyScalar(n.y));
    if (north.lengthSq() < 1e-6) north = new THREE.Vector3(0, 0, 1);
    north.normalize();
    const east = new THREE.Vector3().crossVectors(north, n).normalize();
    const d = (f.dirDeg * Math.PI) / 180;
    const along = north.clone().multiplyScalar(Math.cos(d)).add(east.multiplyScalar(Math.sin(d) * (hand === 'R' ? 1 : -1)));
    const side = new THREE.Vector3().crossVectors(n, along);
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, along, n));
  }, [p[0], p[1], p[2], f.dirDeg, hand]);
  const size = 0.1 + 0.08 * f.pressure;
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    (e.target as unknown as Element).setPointerCapture?.(e.pointerId);
    dragging.current = true;
    onDragState(true);
    setSel({ selectedFinger: id });
  };
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (!dragging.current) return;
    e.stopPropagation();
    const hit = raySphere(e.ray);
    const v: Vec3 = [hand === 'R' ? hit.x : -hit.x, hit.y, hit.z];
    const c = vectorToContact(v);
    setFinger(id, { lon: Math.round(c.lon * 10) / 10, lat: Math.round(c.lat * 10) / 10 });
  };
  const onUp = (e: ThreeEvent<PointerEvent>) => {
    (e.target as unknown as Element).releasePointerCapture?.(e.pointerId);
    dragging.current = false;
    onDragState(false);
  };
  return (
    <group position={[p[0] * 1.015, p[1] * 1.015, p[2] * 1.015]} quaternion={quat}>
      <mesh onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} scale={[size * 0.75, size * 1.25, size * 0.32]}>
        <sphereGeometry args={[1, 24, 16]} />
        <meshStandardMaterial color={meta.color} emissive={meta.color} emissiveIntensity={selected ? 0.55 : 0.2} transparent opacity={f.enabled ? 0.95 : 0.3} roughness={0.4} />
      </mesh>
      {selected && (
        <mesh scale={[size * 1.15, size * 1.6, 0.01]}>
          <ringGeometry args={[0.9, 1, 32]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      )}
      <Html center distanceFactor={3.2} position={[0, 0, 0.12]} style={{ pointerEvents: 'none' }} zIndexRange={[10, 0]}>
        <div className={`fm-label ${f.enabled ? '' : 'off'}`} style={{ borderColor: meta.color }}>{meta.short}</div>
      </Html>
    </group>
  );
}

function BallRotator({ children, hand }: { children: React.ReactNode; hand: Hand }) {
  const tool = useStore((s) => s.gripTool);
  const rotate = useStore((s) => s.rotateBallInHand);
  const camera = useThree((s) => s.camera);
  const last = useRef<{ x: number; y: number } | null>(null);
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (tool === 'orbit') return;
    e.stopPropagation();
    (e.target as unknown as Element).setPointerCapture?.(e.pointerId);
    last.current = { x: e.clientX, y: e.clientY };
  };
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (!last.current || tool === 'orbit') return;
    e.stopPropagation();
    const dx = e.clientX - last.current.x, dy = e.clientY - last.current.y;
    last.current = { x: e.clientX, y: e.clientY };
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const k = 0.012;
    let dq: Quat = qMul(qAxisAngle([up.x, up.y, up.z], dx * k), qAxisAngle([right.x, right.y, right.z], dy * k));
    if (hand === 'L') dq = [dq[0], dq[1], -dq[2], -dq[3]]; // conjugate by the x-mirror
    rotate(dq, tool === 'grip');
  };
  const onUp = (e: ThreeEvent<PointerEvent>) => {
    (e.target as unknown as Element).releasePointerCapture?.(e.pointerId);
    last.current = null;
  };
  return <group onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>{children}</group>;
}

function GripScene({ preset, nonce }: { preset: ViewPreset; nonce: number }) {
  const grip = useStore((s) => s.grip);
  const hand = useStore((s) => s.hand);
  const tool = useStore((s) => s.gripTool);
  const showHand = useStore((s) => s.showHand);
  const selected = useStore((s) => s.selectedFinger);
  const { spec } = useDerived();
  const [dragging, setDragging] = useState(false);
  const q = worldSeamQuat(grip.seamQuat, hand);
  const axis = spec && spec.spinRpm > 0 ? spinAxis({ ...spec, hand }) : null;
  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[2, 4, 3]} intensity={1.6} />
      <directionalLight position={[-3, -1, -2]} intensity={0.5} color="#9fb8ff" />
      <OrbitControls makeDefault enabled={tool === 'orbit' && !dragging} enablePan={false} minDistance={2.6} maxDistance={9} />
      <CameraRig preset={preset} hand={hand} nonce={nonce} />
      <BallRotator hand={hand}>
        <group quaternion={new THREE.Quaternion(q[1], q[2], q[3], q[0])}>
          <Baseball radius={1} />
        </group>
      </BallRotator>
      {FINGERS.map((id) => (
        <FingerMarker key={id} id={id} f={grip.fingers[id]} hand={hand} selected={selected === id} onDragState={setDragging} />
      ))}
      {showHand && <HandViz fingers={grip.fingers} hand={hand} />}
      {axis && (
        <>
          <Arrow dir={axis as [number, number, number]} length={1.75} color="#ffd34d" radius={0.025} />
          <Arrow dir={[-axis[0], -axis[1], -axis[2]]} length={1.4} color="#ffd34d" radius={0.012} opacity={0.5} />
        </>
      )}
      {/* orientation cues */}
      <Arrow dir={[0, 0, -1]} origin={[0, -1.35, 0]} length={0.9} color="#6f86b5" radius={0.015} />
      <Html position={[0, -1.35, -1.1]} center style={{ pointerEvents: 'none' }}><div className="cue">to plate</div></Html>
    </>
  );
}

export function GripEditor() {
  const hand = useStore((s) => s.hand);
  const tool = useStore((s) => s.gripTool);
  const showHand = useStore((s) => s.showHand);
  const set = useStore((s) => s.set);
  const setHand = useStore((s) => s.setHand);
  const selected = useStore((s) => s.selectedFinger);
  const setFinger = useStore((s) => s.setFinger);
  const grip = useStore((s) => s.grip);
  const [preset, setPreset] = useState<ViewPreset>('back');
  const [nonce, setNonce] = useState(0);

  const onKey = (e: React.KeyboardEvent) => {
    const f = grip.fingers[selected];
    const step = e.shiftKey ? 0.5 : 3;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (d[e.key]) {
      e.preventDefault();
      // left/right on screen in the pitcher's view: arm side is screen-right for a RHP
      const sgn = hand === 'R' ? 1 : -1;
      setFinger(selected, { lon: f.lon + d[e.key][0] * sgn, lat: Math.max(-89, Math.min(89, f.lat + d[e.key][1])) });
    }
  };

  return (
    <div className="grip-editor" tabIndex={0} onKeyDown={onKey} aria-label="3D grip editor. Drag finger markers on the ball. Arrow keys move the selected finger.">
      <div className="ge-top">
      <div className="ge-toolbar">
        <div className="seg" role="radiogroup" aria-label="Drag action">
          {([['orbit', 'Orbit camera'], ['seams', 'Rotate seams'], ['grip', 'Rotate grip']] as const).map(([k, l]) => (
            <button key={k} role="radio" aria-checked={tool === k} className={tool === k ? 'on' : ''} onClick={() => set({ gripTool: k })}>{l}</button>
          ))}
        </div>
        <div className="seg" role="radiogroup" aria-label="Throwing hand">
          {(['R', 'L'] as const).map((h) => (
            <button key={h} role="radio" aria-checked={hand === h} className={hand === h ? 'on' : ''} onClick={() => setHand(h)}>{h === 'R' ? 'RHP' : 'LHP'}</button>
          ))}
        </div>
        <label className="chk"><input type="checkbox" checked={showHand} onChange={(e) => set({ showHand: e.target.checked })} /> Show hand</label>
      </div>
      <div className="ge-hint">
        {tool === 'orbit' && <>Drag a <b>finger marker</b> to move it · drag empty space to orbit the <b>camera</b> (does not change the grip)</>}
        {tool === 'seams' && <>Drag the ball to rotate the <b>seams under the fingers</b> · fingers stay put in the hand</>}
        {tool === 'grip' && <>Drag the ball to rotate the <b>whole grip</b> in the hand · fingers stay on the same leather</>}
      </div>
      </div>
      <Canvas camera={{ position: [0.5, 1.4, 4.6], fov: 34 }} dpr={[1, 2]}>
        <GripScene preset={preset} nonce={nonce} />
      </Canvas>
      <div className="ge-views">
        {(Object.keys(VIEW_LABEL) as ViewPreset[]).map((v) => (
          <button key={v} className={preset === v ? 'on' : ''} onClick={() => { setPreset(v); setNonce((n) => n + 1); }}>{VIEW_LABEL[v]}</button>
        ))}
      </div>
      <div className="ge-legend"><span className="sw" style={{ background: '#ffd34d' }} /> estimated spin axis · {hand === 'R' ? 'RHP' : 'LHP'} arm side is screen-{hand === 'R' ? 'right' : 'left'} in the pitcher's view</div>
    </div>
  );
}
