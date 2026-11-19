// Procedural bodies: built without errors, fit the spec dimensions, and the camera eyes sit inside the cabin.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildBody, bodyLayout } from '../src/vehicle/vehicleMeshes';
import { getSpec } from '../src/vehicle/vehicleSim';
import { detailedWheel } from '../src/vehicle/wheelMesh';

describe('procedural vehicle bodies', () => {
  for (const k of ['patrol']) {
    it(`${k}: body matches the spec envelope and the eyes are placed sensibly`, () => {
      const s = getSpec(k);
      const g = buildBody(s, k);
      const b = new THREE.Box3().setFromObject(g);
      const size = b.getSize(new THREE.Vector3());
      expect(Math.abs(size.z - s.body.length)).toBeLessThan(0.45); // bumpers / spare add a little
      expect(size.x).toBeLessThan(s.body.width + 0.35); // mirrors
      expect(b.max.y + s.cgHeight).toBeLessThan(s.body.height + 0.2);
      const L = bodyLayout(s, k);
      // the roof matches the spec height
      expect(L.roofY + s.cgHeight).toBeGreaterThan(s.body.height - 0.12);
      expect(L.eyeCockpit.x).toBeLessThan(0); // left-hand drive (Oman)
      expect(L.eyeCockpit.y).toBeGreaterThan(L.hoodY);
      expect(L.eyeCockpit.y).toBeLessThan(L.roofY);
      expect(L.eyeCockpit.z).toBeGreaterThan(L.zScreenTop);
      expect(L.eyeBonnet.y).toBeGreaterThan(L.hoodY);
      let tris = 0;
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3;
      });
      expect(tris).toBeLessThan(45000); // ~37k measured; wheels add ~4x the wheel test budget
      expect(g.userData.wheelStyle).toBeTruthy();
      expect(g.userData.kind).toBe(k);
    });
  }
  it('detailed wheels build for every style', () => {
    for (const k of ['patrol']) {
      const s = getSpec(k);
      const st = buildBody(s, k).userData.wheelStyle;
      const w = detailedWheel(s.tyre.radius, s.tyre.width, st, s.tyre.sidewall_m);
      const size = new THREE.Box3().setFromObject(w).getSize(new THREE.Vector3());
      expect(Math.abs(size.y - 2 * s.tyre.radius)).toBeLessThan(0.05);
      expect(size.x).toBeLessThan(s.tyre.width * 1.25);
    }
  });

  it('nose and tail caps face outward (front-face culling would hide them)', () => {
    for (const k of ['patrol']) {
      const s = getSpec(k);
      const L = bodyLayout(s, k);
      const paint = buildBody(s, k).children[0] as THREE.Mesh; // first mesh = painted shell incl. caps
      const p = paint.geometry.getAttribute('position'), idx = paint.geometry.index!;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      let front = 0, rear = 0, wrong = 0;
      for (let i = 0; i < idx.count; i += 3) {
        a.fromBufferAttribute(p, idx.getX(i));
        b.fromBufferAttribute(p, idx.getX(i + 1));
        c.fromBufferAttribute(p, idx.getX(i + 2));
        const n = b.clone().sub(a).cross(c.clone().sub(a));
        if (n.length() < 1e-7 || Math.abs(n.z) < 0.95 * n.length()) continue;
        const z = (a.z + b.z + c.z) / 3;
        if (Math.abs(z - L.zFront) < 1e-3) { front++; if (n.z > 0) wrong++; }
        if (Math.abs(z - L.zRear) < 1e-3) { rear++; if (n.z < 0) wrong++; }
      }
      expect(front, k).toBeGreaterThan(10);
      expect(rear, k).toBeGreaterThan(10);
      expect(wrong, k).toBe(0);
    }
  });
});
