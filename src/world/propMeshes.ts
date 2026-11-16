// Procedural low-poly meshes for the desert props. Original geometry only (no external assets).
import * as THREE from 'three';
import { mergeColored } from '../gfx/objMaterial';
import { mulberry32 } from '../core/rng';

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const S = new THREE.Vector3();
const T = new THREE.Vector3();

function mat(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  return new THREE.Matrix4().compose(T.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), S.set(sx, sy, sz));
}

/** Jitter vertices of a geometry (deterministic) for an organic look. */
function lumpy(g: THREE.BufferGeometry, amount: number, seed: number): THREE.BufferGeometry {
  const r = mulberry32(seed);
  const p = g.getAttribute('position');
  const map = new Map<string, [number, number, number]>();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let d = map.get(k);
    if (!d) map.set(k, (d = [(r() - 0.5) * amount, (r() - 0.5) * amount, (r() - 0.5) * amount]));
    p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
  }
  g.computeVertexNormals();
  return g;
}

/** Ghaf tree (Prosopis cineraria-like): crooked trunk, wide drooping grey-green canopy. ~6-8 m tall. */
export function ghafTree(): THREE.BufferGeometry {
  const parts: { geo: THREE.BufferGeometry; color: THREE.ColorRepresentation; matrix?: THREE.Matrix4 }[] = [];
  const bark = 0x5b4636;
  parts.push({ geo: new THREE.CylinderGeometry(0.22, 0.38, 3.2, 6), color: bark, matrix: mat(0, 1.6, 0, 0.08, 0, 0.1) });
  parts.push({ geo: new THREE.CylinderGeometry(0.1, 0.18, 2.6, 5), color: bark, matrix: mat(0.7, 3.6, 0.2, 0, 0, -0.7) });
  parts.push({ geo: new THREE.CylinderGeometry(0.1, 0.17, 2.4, 5), color: bark, matrix: mat(-0.6, 3.5, -0.3, 0.3, 0, 0.75) });
  const r = mulberry32(7);
  const leaf = [0x66704a, 0x5c6a44, 0x737a52];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + r() * 0.5;
    const d = i === 0 ? 0 : 1.6 + r() * 1.1;
    const s = i === 0 ? 2.6 : 1.6 + r() * 0.8;
    const g = lumpy(new THREE.IcosahedronGeometry(1, 1), 0.35, 11 + i);
    parts.push({ geo: g, color: leaf[i % 3], matrix: mat(Math.cos(a) * d, 4.6 + r() * 0.9 - d * 0.25, Math.sin(a) * d, 0, r() * 3, 0, s, s * 0.55, s) });
  }
  return mergeColored(parts);
}

/** Dry desert shrub (Calligonum / arta-like): a dense low cluster of twiggy lumps. ~1-1.6 m. */
export function shrub(): THREE.BufferGeometry {
  const parts: { geo: THREE.BufferGeometry; color: THREE.ColorRepresentation; matrix?: THREE.Matrix4 }[] = [];
  const r = mulberry32(21);
  const cols = [0x7d6e4c, 0x6b6143, 0x8a7a55, 0x5f5a3e];
  for (let i = 0; i < 5; i++) {
    const a = r() * Math.PI * 2;
    const d = i === 0 ? 0 : 0.35 + r() * 0.3;
    const s = 0.45 + r() * 0.3;
    parts.push({ geo: lumpy(new THREE.IcosahedronGeometry(1, 0), 0.4, 31 + i), color: cols[i % 4], matrix: mat(Math.cos(a) * d, s * 0.8, Math.sin(a) * d, r(), r(), r(), s, s * 1.1, s) });
  }
  return mergeColored(parts);
}

/** Grass tuft (Panicum-like): a few thin straw blades. ~0.5 m. */
export function tuft(): THREE.BufferGeometry {
  const parts: { geo: THREE.BufferGeometry; color: THREE.ColorRepresentation; matrix?: THREE.Matrix4 }[] = [];
  const r = mulberry32(41);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    parts.push({ geo: new THREE.ConeGeometry(0.05, 0.6 + r() * 0.3, 3), color: i % 2 ? 0xb39a63 : 0x9c8a58, matrix: mat(Math.cos(a) * 0.08, 0.3, Math.sin(a) * 0.08, Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35) });
  }
  return mergeColored(parts);
}

/** Flat-roofed concrete house with parapet; unit size (scaled per instance). */
export function house(): THREE.BufferGeometry {
  return mergeColored([
    { geo: new THREE.BoxGeometry(1, 1, 1), color: 0xd9cbb2, matrix: mat(0, 0.5, 0) },
    { geo: new THREE.BoxGeometry(1.02, 0.08, 1.02), color: 0xcbbca2, matrix: mat(0, 1.04, 0) },
    { geo: new THREE.BoxGeometry(0.12, 0.35, 0.02), color: 0x6b5a45, matrix: mat(0.2, 0.18, 0.505) },
    { geo: new THREE.BoxGeometry(0.15, 0.12, 0.02), color: 0x39424a, matrix: mat(-0.2, 0.55, 0.505) },
  ]);
}

/** Desert camp hut: palm-frond (barasti-style) walls on a timber frame, open front. ~4 x 3 x 2.6 m. */
export function campHut(): THREE.BufferGeometry {
  const frond = 0x9a7b4f;
  const wood = 0x5d4630;
  return mergeColored([
    { geo: new THREE.BoxGeometry(4, 2.3, 0.15), color: frond, matrix: mat(0, 1.15, -1.5) },
    { geo: new THREE.BoxGeometry(0.15, 2.3, 3), color: frond, matrix: mat(-2, 1.15, 0) },
    { geo: new THREE.BoxGeometry(0.15, 2.3, 3), color: frond, matrix: mat(2, 1.15, 0) },
    { geo: new THREE.BoxGeometry(4.4, 0.2, 3.4), color: 0x8a6c44, matrix: mat(0, 2.45, 0, 0.06, 0, 0) },
    { geo: new THREE.CylinderGeometry(0.07, 0.07, 2.4, 5), color: wood, matrix: mat(-2, 1.2, 1.5) },
    { geo: new THREE.CylinderGeometry(0.07, 0.07, 2.4, 5), color: wood, matrix: mat(2, 1.2, 1.5) },
    { geo: new THREE.BoxGeometry(3.4, 0.05, 2.4), color: 0x7a2f22, matrix: mat(0, 0.03, -0.1) }, // floor rug
  ]);
}

/** Shade shelter: four poles and a fabric roof (rest stop along tracks). */
export function shelter(): THREE.BufferGeometry {
  const pole = 0x6e6e6a;
  return mergeColored([
    { geo: new THREE.CylinderGeometry(0.06, 0.06, 2.6, 5), color: pole, matrix: mat(-2, 1.3, -1.5) },
    { geo: new THREE.CylinderGeometry(0.06, 0.06, 2.6, 5), color: pole, matrix: mat(2, 1.3, -1.5) },
    { geo: new THREE.CylinderGeometry(0.06, 0.06, 2.6, 5), color: pole, matrix: mat(-2, 1.3, 1.5) },
    { geo: new THREE.CylinderGeometry(0.06, 0.06, 2.6, 5), color: pole, matrix: mat(2, 1.3, 1.5) },
    { geo: new THREE.BoxGeometry(4.4, 0.06, 3.4), color: 0x2f6b5c, matrix: mat(0, 2.62, 0) },
  ]);
}

/** Wooden distribution power pole with cross-arm, ~9 m. */
export function powerPole(): THREE.BufferGeometry {
  return mergeColored([
    { geo: new THREE.CylinderGeometry(0.12, 0.17, 9, 6), color: 0x5a4632, matrix: mat(0, 4.5, 0) },
    { geo: new THREE.BoxGeometry(2.0, 0.12, 0.12), color: 0x4b3a2a, matrix: mat(0, 8.4, 0) },
    { geo: new THREE.CylinderGeometry(0.05, 0.05, 0.25, 5), color: 0xe8e8e0, matrix: mat(-0.85, 8.6, 0) },
    { geo: new THREE.CylinderGeometry(0.05, 0.05, 0.25, 5), color: 0xe8e8e0, matrix: mat(0.85, 8.6, 0) },
    { geo: new THREE.CylinderGeometry(0.05, 0.05, 0.25, 5), color: 0xe8e8e0, matrix: mat(0, 8.6, 0) },
  ]);
}

/** Camp fire pit: ring of stones. */
export function firePit(): THREE.BufferGeometry {
  const parts: { geo: THREE.BufferGeometry; color: THREE.ColorRepresentation; matrix?: THREE.Matrix4 }[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    parts.push({ geo: new THREE.DodecahedronGeometry(0.18, 0), color: 0x4a443d, matrix: mat(Math.cos(a) * 0.7, 0.1, Math.sin(a) * 0.7, a, a * 2, 0) });
  }
  parts.push({ geo: new THREE.CylinderGeometry(0.55, 0.6, 0.04, 9), color: 0x1d1a17, matrix: mat(0, 0.02, 0) });
  return mergeColored(parts);
}

export { M as _scratchMatrix };
