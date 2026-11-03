import { useMemo } from 'react';
import * as THREE from 'three';
import { seamPoint, seamTangent, SEAM_B } from '../physics/seamGeometry';
import type { Quat, Vec3 } from '../physics/vec';
import { len, qConj, qRotate } from '../physics/vec';

/** Rotational motion blur (display only): body-frame spin axis and the angle swept while the virtual shutter is open. */
export interface SpinBlur { axis: Vec3; angle: number }

const FRAME_TIME = 1 / 60;
const SHUTTER = 0.5; // 180-degree shutter

/** Angle the ball turns during one exposure at the current playback rate, expressed about the body-frame axis. */
export function spinBlur(omegaWorld: Vec3, q: Quat, rate: number, enabled: boolean): SpinBlur | undefined {
  const w = len(omegaWorld);
  if (!enabled || w < 1e-9) return undefined;
  const angle = Math.min(2 * Math.PI, w * FRAME_TIME * SHUTTER * rate);
  if (angle < 0.03) return undefined;
  const a = qRotate(qConj(q), omegaWorld);
  return { axis: [a[0] / w, a[1] / w, a[2] / w], angle };
}

const STITCHES = 108;

/** Baseball in its body frame: leather sphere, seam groove and red V-stitches. Geometry follows seamGeometry.ts,
 *  the same seam curve the seam-force model uses. */
export function Baseball({ radius = 1, stitchColor = '#d6262f', leather = '#f3eee4', detail = 1, blur }: { radius?: number; stitchColor?: string; leather?: string; detail?: number; blur?: SpinBlur }) {
  const { seamGeo, stitchMatrices, stitchGeo } = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    const N = Math.round(260 * detail);
    for (let i = 0; i < N; i++) {
      const p = seamPoint((i / N) * Math.PI * 2, SEAM_B);
      pts.push(new THREE.Vector3(p[0], p[1], p[2]).multiplyScalar(radius * 1.002));
    }
    const seamGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), N, radius * 0.018, 6, true);
    const stitchGeo = new THREE.CylinderGeometry(radius * 0.011, radius * 0.011, 1, 5);
    stitchGeo.rotateZ(Math.PI / 2); // along x
    const mats: THREE.Matrix4[] = [];
    const L = radius * 0.11;
    for (let i = 0; i < STITCHES; i++) {
      const t = (2 * Math.PI * (i + 0.5)) / STITCHES;
      const p = new THREE.Vector3(...seamPoint(t));
      const tan = new THREE.Vector3(...seamTangent(t));
      const side = new THREE.Vector3().crossVectors(p, tan).normalize();
      for (const s of [-1, 1]) {
        // a V-stitch: each leg runs from the seam outward and slightly backward along the seam
        const dir = side.clone().multiplyScalar(s).add(tan.clone().multiplyScalar(-0.55)).normalize();
        const center = p.clone().multiplyScalar(radius * 1.012).add(dir.clone().multiplyScalar(L * 0.5));
        const xAxis = dir.clone();
        const yAxis = p.clone().normalize();
        const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
        yAxis.crossVectors(zAxis, xAxis).normalize();
        const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
        m.scale(new THREE.Vector3(L, 1, 1));
        m.setPosition(center);
        mats.push(m);
      }
    }
    return { seamGeo, stitchMatrices: mats, stitchGeo };
  }, [radius, detail]);

  // Motion blur: the leather sphere is rotationally symmetric, so only the seams need smearing. Draw N copies of
  // the seam and stitches spread back over the swept angle, each faint, like an accumulation of sub-frames.
  const samples = blur ? Math.max(2, Math.min(48, Math.ceil(blur.angle / 0.05))) : 1;
  const blurMats = useMemo(() => {
    if (samples <= 1) return null;
    const opacity = Math.min(1, 2.2 / samples);
    return {
      seam: new THREE.MeshStandardMaterial({ color: '#cfc4b2', roughness: 0.9, transparent: true, opacity, depthWrite: false }),
      stitch: new THREE.MeshStandardMaterial({ color: stitchColor, roughness: 0.5, transparent: true, opacity, depthWrite: false }),
    };
  }, [samples, stitchColor]);
  const stitchRef = (m: THREE.InstancedMesh | null) => {
    if (!m) return;
    stitchMatrices.forEach((mat, i) => m.setMatrixAt(i, mat));
    m.instanceMatrix.needsUpdate = true;
  };
  if (blur && blurMats) {
    const axis = new THREE.Vector3(...blur.axis);
    return (
      <group>
        <mesh castShadow>
          <sphereGeometry args={[radius, Math.round(64 * detail), Math.round(48 * detail)]} />
          <meshStandardMaterial color={leather} roughness={0.62} metalness={0} />
        </mesh>
        {Array.from({ length: samples }, (_, i) => {
          // sub-frame i shows the orientation (i / (N-1)) of the way back through the exposure
          const q = new THREE.Quaternion().setFromAxisAngle(axis, (-blur.angle * i) / (samples - 1));
          return (
            <group key={i} quaternion={q}>
              <mesh geometry={seamGeo} material={blurMats.seam} />
              <instancedMesh args={[stitchGeo, blurMats.stitch, stitchMatrices.length]} ref={stitchRef} />
            </group>
          );
        })}
      </group>
    );
  }

  return (
    <group>
      <mesh castShadow>
        <sphereGeometry args={[radius, Math.round(64 * detail), Math.round(48 * detail)]} />
        <meshStandardMaterial color={leather} roughness={0.62} metalness={0} />
      </mesh>
      <mesh geometry={seamGeo}>
        <meshStandardMaterial color="#cfc4b2" roughness={0.9} />
      </mesh>
      <instancedMesh
        args={[stitchGeo, undefined, stitchMatrices.length]}
        ref={(m) => {
          if (!m) return;
          stitchMatrices.forEach((mat, i) => m.setMatrixAt(i, mat));
          m.instanceMatrix.needsUpdate = true;
        }}
      >
        <meshStandardMaterial color={stitchColor} roughness={0.5} />
      </instancedMesh>
    </group>
  );
}

/** Simple arrow (shaft + cone) from origin along `dir` with length `length`. */
export function Arrow({ dir, length, color, radius = 0.02, origin = [0, 0, 0], opacity = 1 }: { dir: [number, number, number]; length: number; color: string; radius?: number; origin?: [number, number, number]; opacity?: number }) {
  const q = useMemo(() => {
    const d = new THREE.Vector3(...dir);
    if (d.lengthSq() < 1e-12) return new THREE.Quaternion();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  }, [dir[0], dir[1], dir[2]]);
  if (length <= 1e-6) return null;
  const head = Math.min(length * 0.35, radius * 6);
  const shaft = Math.max(0, length - head);
  return (
    <group position={origin} quaternion={q}>
      <mesh position={[0, shaft / 2, 0]}>
        <cylinderGeometry args={[radius, radius, shaft, 8]} />
        <meshBasicMaterial color={color} transparent={opacity < 1} opacity={opacity} />
      </mesh>
      <mesh position={[0, shaft + head / 2, 0]}>
        <coneGeometry args={[radius * 2.6, head, 12]} />
        <meshBasicMaterial color={color} transparent={opacity < 1} opacity={opacity} />
      </mesh>
    </group>
  );
}
