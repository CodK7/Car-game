// Cascaded shadow fit (W5): each cascade's light-space centre moves only in whole shadow texels while the camera moves
// slowly (no shimmering shadow edges), the projection size stays constant while the camera turns, and every cascade
// covers its frustum slice.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ObjShadows } from '../src/gfx/shadows';

describe('object shadow cascades', () => {
  const sun = new THREE.Vector3(-0.6, 0.45, 0.3).normalize();
  const mk = () => {
    const s = new ObjShadows();
    // configure() needs WebGL only for the render target; fit() is pure maths, so set the state directly
    const any = s as unknown as { cfg: { size: number; splits: number[] }; cams: THREE.OrthographicCamera[]; fit: (i: number, c: THREE.PerspectiveCamera, s: THREE.Vector3) => void };
    any.cfg = { size: 1024, splits: [0, 24, 110] };
    any.cams = [new THREE.OrthographicCamera(), new THREE.OrthographicCamera()];
    return any;
  };
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.4, 45000);

  it('centre snaps to whole texels in light space while the camera slides', () => {
    const s = mk();
    const zA = sun.clone();
    const xA = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), zA).normalize();
    const yA = new THREE.Vector3().crossVectors(zA, xA);
    let maxFrac = 0;
    for (let k = 0; k < 40; k++) {
      cam.position.set(100 + k * 0.037, 320, -50 + k * 0.021);
      cam.rotation.set(-0.2, 0.7, 0);
      for (let i = 0; i < 2; i++) {
        s.fit(i, cam, sun);
        const c = s.cams[i];
        const texel = (c.right - c.left) / s.cfg.size;
        for (const a of [xA, yA]) {
          const v = c.position.dot(a) / texel;
          maxFrac = Math.max(maxFrac, Math.abs(v - Math.round(v)));
        }
      }
    }
    expect(maxFrac).toBeLessThan(1e-3);
  });

  it('projection size does not change while the camera turns in place', () => {
    const s = mk();
    const sizes = new Set<number>();
    cam.position.set(0, 320, 0);
    for (let k = 0; k < 36; k++) {
      cam.rotation.set(-0.15, (k * Math.PI) / 18, 0);
      s.fit(0, cam, sun);
      sizes.add(s.cams[0].right);
    }
    expect(sizes.size).toBe(1);
  });

  it('each cascade contains its frustum slice corners', () => {
    const s = mk();
    cam.position.set(10, 300, 20);
    cam.rotation.set(-0.3, 1.1, 0);
    cam.updateMatrixWorld();
    for (let i = 0; i < 2; i++) {
      s.fit(i, cam, sun);
      const c = s.cams[i];
      c.updateMatrixWorld();
      const vp = new THREE.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
      const tanY = Math.tan((cam.fov * Math.PI) / 360), tanX = tanY * cam.aspect;
      for (const d of [Math.max(cam.near, s.cfg.splits[i]), s.cfg.splits[i + 1]])
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
          const p = new THREE.Vector3(sx * tanX * d, sy * tanY * d, -d).applyMatrix4(cam.matrixWorld).applyMatrix4(vp);
          expect(Math.abs(p.x)).toBeLessThanOrEqual(1);
          expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
          expect(Math.abs(p.z)).toBeLessThanOrEqual(1);
        }
    }
  });
});
