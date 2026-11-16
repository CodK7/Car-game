// Procedural bodies: built without errors, fit the spec dimensions, and the camera eyes sit inside the cabin.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildBody, bodyLayout } from '../src/vehicle/vehicleMeshes';
import { getSpec } from '../src/vehicle/vehicleSim';

describe('procedural vehicle bodies', () => {
  for (const k of ['patrol', 'lc70']) {
    it(`${k}: body matches the spec envelope and the eyes are placed sensibly`, () => {
      const s = getSpec(k);
      const g = buildBody(s, k);
      const b = new THREE.Box3().setFromObject(g);
      const size = b.getSize(new THREE.Vector3());
      expect(Math.abs(size.z - s.body.length)).toBeLessThan(0.45); // bumpers / spare add a little
      expect(size.x).toBeLessThan(s.body.width + 0.35); // mirrors
      expect(b.max.y + s.cgHeight).toBeLessThan(s.body.height + 0.2);
      const L = bodyLayout(s);
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
      expect(tris).toBeLessThan(20000);
    });
  }
});
