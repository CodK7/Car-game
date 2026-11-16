// Loads the web terrain assets (see Tools/Web/export_web.py) and builds the CPU + GPU resources.
import * as THREE from 'three';
import { TerrainData, TerrainManifest } from './terrainData';

export interface OsmData {
  license: string;
  roads: { c: string; s: string | null; p: number[] }[];
  buildings: number[][];
  places: { n: string | null; ar?: string | null; k: string | null; x: number; z: number; in: boolean }[];
  pois: { n: string | null; k: string; x: number; z: number }[];
  power: number[][];
}

export interface WorldAssets {
  manifest: TerrainManifest;
  data: TerrainData;
  maskTex: THREE.Texture;
  rippleTex: THREE.Texture;
  osm: OsmData;
}

const BASE = `${import.meta.env.BASE_URL}terrain/`;

async function fetchBuffer(url: string, onProgress: (f: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  if (!res.body || !total) return res.arrayBuffer();
  const out = new Uint8Array(total);
  const reader = res.body.getReader();
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.length > total) return (await fetch(url)).arrayBuffer(); // compressed transfer: length mismatch
    out.set(value, got);
    got += value.length;
    onProgress(got / total);
  }
  return out.buffer;
}

async function loadBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}

export async function loadWorld(status: (msg: string) => void): Promise<WorldAssets> {
  status('manifest');
  const manifest: TerrainManifest = await (await fetch(`${BASE}manifest.json`)).json();
  const [buf, maskBmp, rippleBmp, osm] = await Promise.all([
    fetchBuffer(BASE + manifest.height, (f) => status(`heightmap ${(f * 100).toFixed(0)}%`)),
    loadBitmap(BASE + manifest.masks),
    loadBitmap(BASE + manifest.ripple),
    fetch(BASE + manifest.osm).then((r) => r.json() as Promise<OsmData>),
  ]);
  status('terrain data');
  const data = new TerrainData(manifest, new Uint16Array(buf));
  data.buildPyramid();

  // masks: keep the pixels for CPU queries (sand type, placement) and upload the same canvas as a texture
  const mn = maskBmp.width;
  const cv = document.createElement('canvas');
  cv.width = cv.height = mn;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(maskBmp, 0, 0);
  data.masks = new Uint8Array(ctx.getImageData(0, 0, mn, mn).data.buffer);
  data.masksN = mn;
  const maskTex = new THREE.Texture(maskBmp as any);
  maskTex.flipY = false;
  maskTex.colorSpace = THREE.NoColorSpace;
  maskTex.minFilter = THREE.LinearMipmapLinearFilter;
  maskTex.magFilter = THREE.LinearFilter;
  maskTex.generateMipmaps = true;
  maskTex.needsUpdate = true;

  const rippleTex = new THREE.Texture(rippleBmp as any);
  rippleTex.flipY = false;
  rippleTex.colorSpace = THREE.NoColorSpace;
  rippleTex.wrapS = rippleTex.wrapT = THREE.RepeatWrapping;
  rippleTex.minFilter = THREE.LinearMipmapLinearFilter;
  rippleTex.magFilter = THREE.LinearFilter;
  rippleTex.generateMipmaps = true;
  rippleTex.needsUpdate = true;
  return { manifest, data, maskTex, rippleTex, osm };
}
