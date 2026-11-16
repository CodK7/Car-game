// Test helpers: load the real web terrain assets from public/terrain in Node (no browser needed).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from './png';
import { TerrainData, TerrainManifest } from '../src/world/terrainData';
import { RoadNet } from '../src/world/roadNet';

const ROOT = resolve(__dirname, '..');
let cached: { manifest: TerrainManifest; data: TerrainData; osm: any; roads: RoadNet } | null = null;

export function loadTerrain(withMasks = true) {
  if (cached) return cached;
  const dir = resolve(ROOT, 'public/terrain');
  const manifest: TerrainManifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8'));
  const buf = readFileSync(resolve(dir, manifest.height));
  const h = new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
  const data = new TerrainData(manifest, h);
  data.buildPyramid();
  if (withMasks) {
    const png = PNG.decode(readFileSync(resolve(dir, manifest.masks)));
    data.masks = png.rgba;
    data.masksN = png.width;
  }
  const osm = JSON.parse(readFileSync(resolve(dir, manifest.osm), 'utf8'));
  const roads = new RoadNet(osm.roads);
  cached = { manifest, data, osm, roads };
  return cached;
}

export function fixture(name: string): any {
  return JSON.parse(readFileSync(resolve(ROOT, 'tests/fixtures', name), 'utf8'));
}
