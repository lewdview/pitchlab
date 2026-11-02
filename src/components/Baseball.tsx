import { useMemo } from 'react';
import * as THREE from 'three';
import { seamPoint, seamTangent, SEAM_B } from '../physics/seamGeometry';

const STITCHES = 108;

/** Baseball in its body frame: leather sphere, seam groove and red V-stitches. Geometry follows seamGeometry.ts,
 *  the same seam curve the seam-force model uses. */
export function Baseball({ radius = 1, stitchColor = '#d6262f', leather = '#f3eee4', detail = 1 }: { radius?: number; stitchColor?: string; leather?: string; detail?: number }) {
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
