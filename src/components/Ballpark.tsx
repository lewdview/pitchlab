import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { MOUND_CENTER_Z, MOUND_HEIGHT, MOUND_RADIUS, PLATE_FRONT_Z, PLATE_WIDTH, RUBBER_TO_PLATE, IN, FT } from '../physics/constants';

// Regulation geometry (feet -> metres). Home plate back tip at the origin, pitcher toward +z, first base toward -x.
const BASE = 90 * FT;
const DIAG = BASE / Math.SQRT2;
const BASES: [number, number][] = [[-DIAG, DIAG], [0, 2 * DIAG], [DIAG, DIAG]];
const GRASS_ARC_R = 95 * FT; // infield arc, measured from the front of the rubber

const noRaycast = () => null;

/** Mowed grass: alternating stripes plus a little noise, tiled across the field. */
function useGrassTexture() {
  return useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const g = c.getContext('2d')!;
    for (let i = 0; i < 2; i++) {
      g.fillStyle = i === 0 ? '#2f6b37' : '#28602f';
      g.fillRect(0, i * 128, 256, 128);
    }
    const img = g.getImageData(0, 0, 256, 256);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let p = 0; p < img.data.length; p += 4) {
      const n = (rnd() - 0.5) * 18;
      img.data[p] += n; img.data[p + 1] += n * 1.2; img.data[p + 2] += n * 0.6;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(16, 16); // 160 m plane -> 5 m stripes
    t.anisotropy = 8;
    return t;
  }, []);
}

function useDirtTexture(color: string) {
  return useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = color; g.fillRect(0, 0, 128, 128);
    const img = g.getImageData(0, 0, 128, 128);
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let p = 0; p < img.data.length; p += 4) {
      const n = (rnd() - 0.5) * 26;
      img.data[p] += n; img.data[p + 1] += n * 0.85; img.data[p + 2] += n * 0.7;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(10, 10);
    return t;
  }, [color]);
}

/** Flat shape in the ground plane: points are (x, z). */
function Ground({ pts, y, mat, holes }: { pts: [number, number][]; y: number; mat: THREE.Material; holes?: [number, number][][] }) {
  const geo = useMemo(() => {
    const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z)));
    for (const h of holes ?? []) s.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, z))));
    const g = new THREE.ShapeGeometry(s, 48);
    g.rotateX(Math.PI / 2); // (x, y) -> (x, 0, y)
    // world-space UVs so tiled textures keep a constant scale
    const pos = g.getAttribute('position');
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) { uv[i * 2] = pos.getX(i) / 16; uv[i * 2 + 1] = pos.getZ(i) / 16; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
  }, [pts, holes]);
  return <mesh geometry={geo} position={[0, y, 0]} material={mat} receiveShadow raycast={noRaycast} />;
}

const circle = (cx: number, cz: number, r: number, n = 64): [number, number][] =>
  Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * Math.PI * 2), cz + r * Math.sin((i / n) * Math.PI * 2)]);

/** Chalk stripe from a to b (ground plane). */
function Chalk({ a, b, w = 3 * IN, y = 0.009 }: { a: [number, number]; b: [number, number]; w?: number; y?: number }) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L = Math.hypot(dx, dz);
  return (
    <mesh position={[(a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2]} rotation={[-Math.PI / 2, 0, Math.atan2(dx, dz)]} raycast={noRaycast} receiveShadow>
      <planeGeometry args={[w, L]} />
      <meshStandardMaterial color="#f4f4ef" roughness={0.9} side={THREE.DoubleSide} />
    </mesh>
  );
}

function Box({ x0, x1, z0, z1 }: { x0: number; x1: number; z0: number; z1: number }) {
  return (
    <>
      <Chalk a={[x0, z0]} b={[x1, z0]} /><Chalk a={[x1, z0]} b={[x1, z1]} />
      <Chalk a={[x1, z1]} b={[x0, z1]} /><Chalk a={[x0, z1]} b={[x0, z0]} />
    </>
  );
}

/** Pitcher's mound as a lathe: flat table around the rubber, then a gentle slope to the edge. */
function Mound({ mat }: { mat: THREE.Material }) {
  const geo = useMemo(() => {
    const pts: THREE.Vector2[] = [];
    const n = 24;
    for (let i = 0; i <= n; i++) {
      const r = (i / n) * MOUND_RADIUS;
      const t = Math.max(0, (r - 0.75) / (MOUND_RADIUS - 0.75));
      const h = MOUND_HEIGHT * (1 - t * t * (3 - 2 * t)); // smoothstep falloff
      pts.push(new THREE.Vector2(r, h));
    }
    pts.push(new THREE.Vector2(MOUND_RADIUS, 0));
    const g = new THREE.LatheGeometry(pts, 72);
    const pos = g.getAttribute('position');
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) { uv[i * 2] = pos.getX(i) / 4; uv[i * 2 + 1] = pos.getZ(i) / 4; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
  }, []);
  return <mesh geometry={geo} position={[0, 0.006, MOUND_CENTER_Z]} material={mat} receiveShadow castShadow raycast={noRaycast} />;
}

function Sky() {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color('#050b1c') }, mid: { value: new THREE.Color('#0d1f42') }, horizon: { value: new THREE.Color('#2a4a7a') } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; varying vec3 vP; void main(){ float h = clamp(vP.y, -0.2, 1.0); vec3 c = h < 0.12 ? mix(horizon, mid, smoothstep(-0.05, 0.12, h)) : mix(mid, top, smoothstep(0.12, 0.7, h)); gl_FragColor = vec4(c, 1.0); }',
  }), []);
  return <mesh material={mat} raycast={noRaycast} position={[0, 0, 20]}><sphereGeometry args={[260, 32, 16]} /></mesh>;
}

function LightTower({ x, z, h = 32 }: { x: number; z: number; h?: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, h / 2, 0]} raycast={noRaycast}><cylinderGeometry args={[0.35, 0.5, h, 8]} /><meshStandardMaterial color="#3a475e" /></mesh>
      <mesh position={[0, h + 1.5, 0]} raycast={noRaycast}>
        <boxGeometry args={[7, 3.4, 0.6]} />
        <meshStandardMaterial color="#fff6dc" emissive="#fff3d0" emissiveIntensity={2.2} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Night-game lighting: soft sky fill plus a main key light that casts shadows over the mound-to-plate area. */
const isMobile = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches;

export function StadiumLights() {
  const mobile = isMobile();
  const light = useRef<THREE.DirectionalLight>(null);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const l = light.current;
    if (!l) return;
    l.target.position.set(0, 0, 9);
    scene.add(l.target);
    return () => { scene.remove(l.target); };
  }, [scene]);
  return (
    <>
      <hemisphereLight args={['#bcd2ff', '#1d3a22', 0.75]} />
      <ambientLight intensity={0.18} />
      <directionalLight
        ref={light} position={[-9, 24, 22]} intensity={2.1} color="#fff4e2" castShadow
        shadow-mapSize-width={mobile ? 1024 : 2048} shadow-mapSize-height={mobile ? 1024 : 2048} shadow-bias={-0.0004} shadow-normalBias={0.02}
        shadow-camera-left={-9} shadow-camera-right={9} shadow-camera-top={16} shadow-camera-bottom={-16} shadow-camera-near={1} shadow-camera-far={80}
      />
      <directionalLight position={[10, 14, -12]} intensity={0.55} color="#cfe0ff" />
    </>
  );
}

export function Ballpark() {
  const grassTex = useGrassTexture();
  const dirtTex = useDirtTexture('#8a5a3c');
  const grass = useMemo(() => new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.95 }), [grassTex]);
  const infieldGrass = useMemo(() => new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.95, color: '#e8ffe8', side: THREE.DoubleSide }), [grassTex]);
  const dirt = useMemo(() => new THREE.MeshStandardMaterial({ map: dirtTex, roughness: 1, color: '#d9b49a', side: THREE.DoubleSide }), [dirtTex]);
  const moundDirt = useMemo(() => new THREE.MeshStandardMaterial({ map: dirtTex, roughness: 1, color: '#c99d80', side: THREE.DoubleSide }), [dirtTex]);

  // infield skin: home -> 1B foul line -> 95 ft arc (from the rubber) -> 3B foul line
  const skin = useMemo(() => {
    const cz = RUBBER_TO_PLATE;
    const dC = cz / Math.SQRT2;
    const t = dC + Math.sqrt(dC * dC - (cz * cz - GRASS_ARC_R * GRASS_ARC_R));
    const p1: [number, number] = [-t / Math.SQRT2, t / Math.SQRT2];
    const a1 = Math.atan2(p1[1] - cz, p1[0]), a2 = Math.atan2(p1[1] - cz, -p1[0]);
    const pts: [number, number][] = [[0, -2]];
    pts.push(p1);
    const n = 48;
    for (let i = 1; i < n; i++) {
      const a = a1 + ((a2 - a1) * i) / n; // sweeps across the outfield side of the arc
      pts.push([GRASS_ARC_R * Math.cos(a), cz + GRASS_ARC_R * Math.sin(a)]);
    }
    pts.push([-p1[0], p1[1]]);
    return pts;
  }, []);
  const inset = 1.0;
  const innerGrass: [number, number][] = [[0, inset * Math.SQRT2], [-DIAG + inset * Math.SQRT2, DIAG], [0, 2 * DIAG - inset * Math.SQRT2], [DIAG - inset * Math.SQRT2, DIAG]];

  const hw = PLATE_WIDTH / 2;
  const boxIn = hw + 6 * IN, boxOut = boxIn + 4 * FT;
  const plateMid = PLATE_FRONT_Z / 2;
  return (
    <group>
      <Sky />
      {/* outfield + foul grass */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.002, 30]} material={grass} receiveShadow raycast={noRaycast}>
        <planeGeometry args={[160, 160]} />
      </mesh>
      <Ground pts={skin} y={0.002} mat={dirt} />
      <Ground pts={innerGrass} y={0.004} mat={infieldGrass} />
      {/* home plate circle (26 ft) and base cut-outs */}
      <Ground pts={circle(0, 0.3, 13 * FT)} y={0.006} mat={dirt} />
      {BASES.map(([x, z], i) => <Ground key={i} pts={circle(x, z, 9 * FT, 40)} y={0.006} mat={dirt} />)}
      {BASES.map(([x, z], i) => (
        <mesh key={`b${i}`} position={[x, 0.04, z]} rotation={[0, Math.PI / 4, 0]} castShadow receiveShadow raycast={noRaycast}>
          <boxGeometry args={[18 * IN, 0.07, 18 * IN]} />
          <meshStandardMaterial color="#f7f7f2" roughness={0.6} />
        </mesh>
      ))}
      <Mound mat={moundDirt} />
      <mesh position={[0, MOUND_HEIGHT + 0.012, RUBBER_TO_PLATE + 3 * IN]} castShadow receiveShadow raycast={noRaycast}>
        <boxGeometry args={[24 * IN, 0.025, 6 * IN]} />
        <meshStandardMaterial color="#f5f5f2" roughness={0.5} />
      </mesh>
      {/* chalk: foul lines, batter's boxes, catcher's box */}
      <Chalk a={[-hw * 0.9, hw * 0.9]} b={[-80, 80]} />
      <Chalk a={[hw * 0.9, hw * 0.9]} b={[80, 80]} />
      <Box x0={boxIn} x1={boxOut} z0={plateMid - 3 * FT} z1={plateMid + 3 * FT} />
      <Box x0={-boxOut} x1={-boxIn} z0={plateMid - 3 * FT} z1={plateMid + 3 * FT} />
      <Chalk a={[-21.5 * IN, plateMid - 3 * FT]} b={[-21.5 * IN, plateMid - 3 * FT - 8 * FT]} />
      <Chalk a={[21.5 * IN, plateMid - 3 * FT]} b={[21.5 * IN, plateMid - 3 * FT - 8 * FT]} />
      {/* backstop and stands behind home */}
      <mesh position={[0, 1.5, -18.3]} receiveShadow raycast={noRaycast}><boxGeometry args={[60, 3, 0.4]} /><meshStandardMaterial color="#163057" roughness={0.8} /></mesh>
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={`st${i}`} position={[0, 3 + i * 1.6, -20 - i * 2.2]} raycast={noRaycast}>
          <boxGeometry args={[70, 1.6, 2.2]} /><meshStandardMaterial color={i % 2 ? '#22314f' : '#1b2944'} roughness={0.9} />
        </mesh>
      ))}
      {/* outfield wall and batter's eye */}
      <mesh position={[0, 3.5, 0]} raycast={noRaycast}>
        <cylinderGeometry args={[118, 118, 7, 64, 1, true, -Math.PI / 4 - 0.18, Math.PI / 2 + 0.36]} />
        <meshStandardMaterial color="#123d27" roughness={0.9} side={THREE.BackSide} />
      </mesh>
      <mesh position={[0, 7, 121]} raycast={noRaycast}><boxGeometry args={[36, 14, 1]} /><meshStandardMaterial color="#08170e" roughness={1} /></mesh>
      <LightTower x={-62} z={70} /><LightTower x={62} z={70} /><LightTower x={-40} z={-22} h={28} /><LightTower x={40} z={-22} h={28} />
    </group>
  );
}
