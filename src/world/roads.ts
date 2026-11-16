// OSM roads and sand tracks drawn as ribbons draped on the terrain (chunked for frustum culling).
import * as THREE from 'three';
import { atmo, ATMO_GLSL } from './atmosphere';
import { TerrainData } from './terrainData';
import { roadKind } from './roadNet';
import { OsmData } from './assets';
import world from '../config/world.json';

const TILE = 2560;

export function buildRoads(osm: OsmData, data: TerrainData): THREE.Group {
  const cfg = world.roads;
  const buckets = new Map<string, { pos: number[]; nor: number[]; uv: number[]; kind: number[]; idx: number[] }>();
  const n = { x: 0, y: 1, z: 0 };
  for (const r of osm.roads) {
    const kind = roadKind(r.c, r.s);
    const big = /motorway|primary|secondary/.test(r.c);
    const hw = (kind === 'paved' ? cfg.pavedWidth_m * (big ? 1.5 : r.c === 'residential' || r.c === 'service' ? 0.75 : 1) : cfg.trackWidth_m) / 2;
    // resample the polyline at a fixed step so the ribbon follows the dunes
    const pts: number[] = [];
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const ax = r.p[i], az = r.p[i + 1], bx = r.p[i + 2], bz = r.p[i + 3];
      const len = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.ceil(len / cfg.step_m));
      for (let s = i === 0 ? 0 : 1; s <= steps; s++) pts.push(ax + ((bx - ax) * s) / steps, az + ((bz - az) * s) / steps);
    }
    const m = pts.length / 2;
    if (m < 2) continue;
    const key = `${Math.floor(pts[0] / TILE)},${Math.floor(pts[1] / TILE)}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { pos: [], nor: [], uv: [], kind: [], idx: [] }));
    const base = b.pos.length / 3;
    let dist = 0;
    for (let i = 0; i < m; i++) {
      const x = pts[i * 2], z = pts[i * 2 + 1];
      const px = pts[Math.max(i - 1, 0) * 2], pz = pts[Math.max(i - 1, 0) * 2 + 1];
      const qx = pts[Math.min(i + 1, m - 1) * 2], qz = pts[Math.min(i + 1, m - 1) * 2 + 1];
      let tx = qx - px, tz = qz - pz;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      if (i > 0) dist += Math.hypot(x - pts[i * 2 - 2], z - pts[i * 2 - 1]);
      for (const side of [-1, 1]) {
        const vx = x - tz * hw * side;
        const vz = z + tx * hw * side;
        data.normalAt(vx, vz, n, 2);
        b.pos.push(vx, data.heightAt(vx, vz) + 0.07, vz);
        b.nor.push(n.x, n.y, n.z);
        b.uv.push(side < 0 ? 0 : 1, dist);
        b.kind.push(kind === 'paved' ? 1 : 0);
      }
      if (i > 0) {
        const a = base + (i - 1) * 2;
        b.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }

  const mat = new THREE.ShaderMaterial({
    uniforms: { ...atmo },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float aKind;
      varying vec3 vWorld; varying vec3 vN; varying vec2 vUv; varying float vKind;
      void main() {
        vWorld = position; vN = normal; vUv = uv; vKind = aKind;
        gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${ATMO_GLSL}
      varying vec3 vWorld; varying vec3 vN; varying vec2 vUv; varying float vKind;
      void main() {
        float e = min(vUv.x, 1.0 - vUv.x);
        float n1 = hash12(floor(vWorld.xz * 3.0));
        vec3 albedo; float alpha;
        if (vKind > 0.5) {
          vec3 asphalt = vec3(0.060, 0.058, 0.055) * (0.85 + 0.3 * n1);
          vec3 drift = vec3(0.50, 0.30, 0.15);
          float sand = 1.0 - smoothstep(0.03, 0.22, e + (n1 - 0.5) * 0.08);
          albedo = mix(asphalt, drift, sand * 0.85);
          alpha = smoothstep(0.0, 0.03, e);
        } else {
          float rut = 1.0 - smoothstep(0.03, 0.15, abs(abs(vUv.x - 0.5) - 0.27));
          albedo = vec3(0.40, 0.25, 0.135) * (0.92 + 0.16 * n1) * (1.0 - 0.22 * rut);
          alpha = smoothstep(0.0, 0.22, e) * (0.55 + 0.3 * rut);
        }
        vec3 N = normalize(vN);
        float sh = terrainShadow(vWorld) * objShadow(vWorld);
        vec3 col = albedo * (uSunColor * max(dot(N, uSunDir), 0.0) * sh + mix(uGroundAmb * 0.6, uSkyAmb, N.y * 0.5 + 0.5));
        col = applyFog(col, vWorld);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const group = new THREE.Group();
  for (const b of buckets.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(b.kind, 1));
    g.setIndex(b.idx);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mat);
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 1;
    group.add(mesh);
  }
  return group;
}
