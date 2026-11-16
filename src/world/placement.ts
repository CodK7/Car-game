// Rule-based, deterministic prop placement (pure TS, unit-tested). One candidate per grid cell with jitter;
// each rule reads the GIS masks (slope, loose sand, crest) and the OSM road distance.
import { hash2 } from '../core/rng';
import { MASK_CREST, TerrainData } from './terrainData';
import { RoadNet } from './roadNet';

export interface PropRule {
  spacing_m: number;
  probability: number;
  maxSlope_deg: number;
  maxLoose: number;
  maxCrest: number;
  minRoad_m: number;
  scale: number[];
}

export interface Placed {
  x: number;
  y: number;
  z: number;
  s: number;
  rot: number;
}

export interface RuleStats {
  cells: number;
  rejectedChance: number;
  rejectedSlope: number;
  rejectedLoose: number;
  rejectedCrest: number;
  rejectedRoad: number;
  placed: number;
}

/** Why a single point passes/fails a rule (exported for tests). */
export function ruleCheck(t: TerrainData, roads: RoadNet | null, rule: PropRule, x: number, z: number): 'ok' | 'slope' | 'loose' | 'crest' | 'road' {
  if (t.slopeDegAt(x, z) > rule.maxSlope_deg) return 'slope';
  if (t.looseAt(x, z) > rule.maxLoose) return 'loose';
  if (t.maskAt(x, z, MASK_CREST, 0) > rule.maxCrest) return 'crest';
  if (roads && roads.distance(x, z) < rule.minRoad_m) return 'road';
  return 'ok';
}

/**
 * Candidates in the square [cx-range, cx+range] x [cz-range, cz+range], kept if within `range` of the centre.
 * `density` multiplies the probability (quality preset). Results are identical for the same seed and cell,
 * so props do not change when the window moves.
 */
export function placeAround(t: TerrainData, roads: RoadNet | null, rule: PropRule, seed: number, cx: number, cz: number, range: number,
  density = 1, out: Placed[] = [], stats?: RuleStats): Placed[] {
  out.length = 0;
  const sp = rule.spacing_m;
  const i0 = Math.floor((cx - range) / sp);
  const i1 = Math.floor((cx + range) / sp);
  const j0 = Math.floor((cz - range) / sp);
  const j1 = Math.floor((cz + range) / sp);
  const r2 = range * range;
  const p = rule.probability * density;
  const lim = t.half - 10;
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const x = (i + 0.15 + 0.7 * hash2(i, j, seed)) * sp;
      const z = (j + 0.15 + 0.7 * hash2(i, j, seed + 1)) * sp;
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz > r2 || Math.abs(x) > lim || Math.abs(z) > lim) continue;
      if (stats) stats.cells++;
      if (hash2(i, j, seed + 2) > p) {
        if (stats) stats.rejectedChance++;
        continue;
      }
      const why = ruleCheck(t, roads, rule, x, z);
      if (why !== 'ok') {
        if (stats) {
          if (why === 'slope') stats.rejectedSlope++;
          else if (why === 'loose') stats.rejectedLoose++;
          else if (why === 'crest') stats.rejectedCrest++;
          else stats.rejectedRoad++;
        }
        continue;
      }
      const h = hash2(i, j, seed + 3);
      out.push({ x, y: t.heightAt(x, z), z, s: rule.scale[0] + (rule.scale[1] - rule.scale[0]) * h, rot: hash2(i, j, seed + 4) * Math.PI * 2 });
      if (stats) stats.placed++;
    }
  return out;
}
