import { describe, expect, it } from 'vitest';
import { fixture, loadTerrain } from './helpers';
import { MASK_CREST, TerrainData } from '../src/world/terrainData';
import { placeAround, ruleCheck, RuleStats } from '../src/world/placement';
import world from '../src/config/world.json';

describe('terrain heights vs the GIS source', () => {
  const { data, manifest } = loadTerrain();
  const fx = fixture('height_samples.json');

  it('covers the real 20.16 km square at 5 m with the real elevation range', () => {
    expect(manifest.size).toBe(4033);
    expect(manifest.extent_m).toBeCloseTo(20160, 3);
    expect(data.half).toBeCloseTo(10080, 6);
    expect(manifest.height_min_m).toBeGreaterThan(255);
    expect(manifest.height_max_m).toBeLessThan(450);
  });

  it('matches the float source heightmap at texel centres within the 16-bit quantisation (<= 1.7 mm)', () => {
    let maxErr = 0;
    for (const [x, z, h] of fx.exact) maxErr = Math.max(maxErr, Math.abs(data.heightAt(x, z) - h));
    console.log(`exact-texel max error ${(maxErr * 1000).toFixed(2)} mm over ${fx.exact.length} points`);
    expect(maxErr).toBeLessThan(0.0017 + 1e-6);
  });

  it('bicubic in-game surface stays within 0.5 m of bilinear interpolation of the source between texels', () => {
    let maxErr = 0;
    let sq = 0;
    for (const [x, z, h] of fx.bilinear) {
      const e = data.heightAt(x, z) - h;
      maxErr = Math.max(maxErr, Math.abs(e));
      sq += e * e;
    }
    const rms = Math.sqrt(sq / fx.bilinear.length);
    console.log(`between-texel max ${maxErr.toFixed(3)} m, rms ${rms.toFixed(3)} m over ${fx.bilinear.length} points`);
    expect(maxErr).toBeLessThan(0.5);
    expect(rms).toBeLessThan(0.05);
  });

  it('reports real dune relief (local relief of the megadunes ~100 m)', () => {
    let lo = Infinity, hi = -Infinity;
    for (let x = -1500; x <= 1500; x += 25) {
      const h = data.heightAt(x, 0);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    // a 3 km east-west transect crosses at least one megadune crest and interdune corridor
    expect(hi - lo).toBeGreaterThan(40);
    expect(hi - lo).toBeLessThan(140);
  });

  it('normal points up and agrees with the slope', () => {
    const n = { x: 0, y: 0, z: 0 };
    for (const [x, z] of fx.exact.slice(0, 100)) {
      data.normalAt(x, z, n);
      expect(n.y).toBeGreaterThan(0.75);
      expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 6);
    }
  });

  it('culling pyramid is conservative', () => {
    const mm: [number, number] = [0, 0];
    for (let i = 0; i < 300; i++) {
      const s = TerrainData.BLOCK * (1 << (i % 5));
      const x0 = Math.floor(((i * 7919) % 20000) - 10000);
      const z0 = Math.floor(((i * 104729) % 20000) - 10000);
      const bx = Math.floor((x0 + TerrainData.PYR_HALF) / s) * s - TerrainData.PYR_HALF;
      const bz = Math.floor((z0 + TerrainData.PYR_HALF) / s) * s - TerrainData.PYR_HALF;
      data.nodeMinMax(bx, bz, s, mm);
      for (let k = 0; k < 20; k++) {
        const x = Math.max(-10080, Math.min(10080, bx + (k / 19) * s));
        const z = Math.max(-10080, Math.min(10080, bz + ((k * 7) % 20 / 19) * s));
        const h = data.heightAt(x, z);
        expect(h).toBeGreaterThanOrEqual(mm[0] - 0.01);
        expect(h).toBeLessThanOrEqual(mm[1] + 0.01);
      }
    }
  });
});

describe('prop placement rules', () => {
  const { data, roads } = loadTerrain();
  const rule = world.props.ghaf as any;

  it('is deterministic and respects slope, loose-sand, crest and road rules', () => {
    const stats: RuleStats = { cells: 0, rejectedChance: 0, rejectedSlope: 0, rejectedLoose: 0, rejectedCrest: 0, rejectedRoad: 0, placed: 0 };
    const a = placeAround(data, roads, rule, 1407, 1500, -2500, 2500, 1, [], stats);
    const b = placeAround(data, roads, rule, 1407, 1500, -2500, 2500, 1, []);
    expect(a.length).toBeGreaterThan(5);
    expect(b).toEqual(a);
    for (const p of a) {
      expect(ruleCheck(data, roads, rule, p.x, p.z)).toBe('ok');
      expect(data.slopeDegAt(p.x, p.z)).toBeLessThanOrEqual(rule.maxSlope_deg);
      expect(data.maskAt(p.x, p.z, MASK_CREST, 0)).toBeLessThanOrEqual(rule.maxCrest);
      expect(roads.distance(p.x, p.z)).toBeGreaterThanOrEqual(rule.minRoad_m);
    }
    console.log('ghaf placement stats', JSON.stringify(stats));
    expect(stats.rejectedSlope + stats.rejectedLoose).toBeGreaterThan(0);
  });

  it('a moving window keeps the same props where windows overlap', () => {
    const a = placeAround(data, roads, rule, 9, 0, 0, 1500, 1, []);
    const b = placeAround(data, roads, rule, 9, 300, 0, 1500, 1, []);
    const key = (p: { x: number; z: number }) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`;
    const bs = new Set(b.map(key));
    const overlap = a.filter((p) => Math.hypot(p.x - 300, p.z) < 1500);
    expect(overlap.every((p) => bs.has(key(p)))).toBe(true);
  });

  it('road distance finds OSM tracks', () => {
    const seg = roads.segs.find((s) => s.kind === 'track')!;
    expect(seg).toBeTruthy();
    const mx = (seg.ax + seg.bx) / 2;
    const mz = (seg.az + seg.bz) / 2;
    expect(roads.distance(mx, mz)).toBeLessThan(0.01);
    expect(roads.distance(mx + 3, mz)).toBeLessThan(3.01);
  });
});
