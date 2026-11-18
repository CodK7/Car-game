// Optional imported body model (public/local, git-ignored): placement maths + safe fallback without a browser.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { modelPlacement, attachModel, type ModelDef } from '../src/vehicle/modelBody';
import { buildBody } from '../src/vehicle/vehicleMeshes';
import { getSpec } from '../src/vehicle/vehicleSim';
import bodies from '../src/config/bodies.json';

describe('modelBody', () => {
  const spec = getSpec('patrol');
  const def: ModelDef = { url: 'local/x.glb', fitWheelbase: true };

  it('puts the model hub line on the sim rest wheel centres', () => {
    const hub: [number, number] = [-1.5, 1.4]; // model axles, 2.9 m apart, off-centre
    const pl = modelPlacement(spec, def, hub);
    const zF = -spec.wheelbase * (1 - spec.frontWeightFrac);
    const zR = spec.wheelbase * spec.frontWeightFrac;
    expect(pl.pos.z + hub[0] * pl.scaleZ).toBeCloseTo(zF, 6);
    expect(pl.pos.z + hub[1] * pl.scaleZ).toBeCloseTo(zR, 6);
    expect(pl.pos.y).toBeCloseTo(-spec.cgHeight + spec.tyre.radius, 6);
    expect(modelPlacement(spec, { ...def, fitWheelbase: false }, hub).scaleZ).toBe(1);
    expect(modelPlacement(spec, { ...def, pitchDeg: 2 }, hub).pitch).toBeCloseTo((2 * Math.PI) / 180, 9);
  });

  it('is a no-op without a browser and the procedural body stays', () => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh());
    expect(() => attachModel(g, spec, def, '#ffffff')).not.toThrow();
    expect(g.children.length).toBe(1);
    expect(g.children[0].visible).toBe(true);
    const body = buildBody(spec, 'patrol');
    expect(body.userData.model).toBeUndefined();
    let meshes = 0;
    body.traverse((o) => ((o as THREE.Mesh).isMesh && o.visible ? meshes++ : 0));
    expect(meshes).toBeGreaterThan(5);
  });

  it('model URLs in the config point into the git-ignored public/local folder', () => {
    for (const [k, d] of Object.entries(bodies as unknown as Record<string, { model?: { url: string } }>)) {
      if (d.model) expect(d.model.url, k).toMatch(/^local\//);
    }
  });
});
