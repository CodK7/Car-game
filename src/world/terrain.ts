// Terrain renderer: CDLOD quadtree over the 20 km heightmap. Heights are sampled from an R16UI texture in the
// vertex shader with the same bicubic formula as TerrainData.heightAt, so the drawn ground equals the physics ground.
import * as THREE from 'three';
import { TerrainData } from './terrainData';
import { atmo, ATMO_GLSL } from './atmosphere';
import world from '../config/world.json';

export interface TerrainQuality {
  terrainDetail: number;
  finestCell: number;
  aniso: number;
  sparkle: boolean;
  wisps: boolean;
  rippleFar: boolean;
}

const GRID = 32; // quads per node side
const MAX_NODES = 2048;
const ORIGIN_SNAP = 64; // pattern-origin snap (multiple of every tile size) keeps texture coordinates precise

const VERT = /* glsl */ `
uniform highp usampler2D uHeight;
uniform vec4 uHInfo;      // n, res, z0, zstep
uniform float uHalf;
uniform vec3 uLodCam;     // camera x, height above ground, z
uniform float uRange0;
uniform float uGrid;
uniform vec2 uOrigin;     // pattern origin (snapped camera position)
uniform vec3 uCamLocal;   // camera position relative to uOrigin (y absolute)
uniform sampler2D uDeform;
uniform vec4 uDeformRect; // centre x, centre z, size, enabled
attribute vec4 iNode;     // origin x, origin z, size, lod level
varying vec3 vWorld;
varying vec2 vLocal;
varying vec3 vDuv;

float hf(ivec2 p) {
  p = clamp(p, ivec2(0), ivec2(int(uHInfo.x) - 1));
  return float(texelFetch(uHeight, p, 0).r);
}
float heightAt(vec2 xz) {
  vec2 g = (xz + uHalf) / uHInfo.y;
  vec2 fl = floor(g);
  vec2 t = g - fl;
  ivec2 i = ivec2(fl);
  vec4 wx = vec4(((-t.x + 2.0) * t.x - 1.0) * t.x, (3.0 * t.x - 5.0) * t.x * t.x + 2.0, ((-3.0 * t.x + 4.0) * t.x + 1.0) * t.x, (t.x - 1.0) * t.x * t.x) * 0.5;
  vec4 wz = vec4(((-t.y + 2.0) * t.y - 1.0) * t.y, (3.0 * t.y - 5.0) * t.y * t.y + 2.0, ((-3.0 * t.y + 4.0) * t.y + 1.0) * t.y, (t.y - 1.0) * t.y * t.y) * 0.5;
  float s = 0.0;
  for (int j = 0; j < 4; j++) {
    ivec2 r = i + ivec2(-1, j - 1);
    float row = wx.x * hf(r) + wx.y * hf(r + ivec2(1, 0)) + wx.z * hf(r + ivec2(2, 0)) + wx.w * hf(r + ivec2(3, 0));
    s += row * wz[j];
  }
  return uHInfo.z + s * uHInfo.w;
}

void main() {
  vec2 grid = position.xy;
  float cell = iNode.z / uGrid;
  vec2 loc = (iNode.xy - uOrigin) + grid * cell;
  float rEnd = uRange0 * exp2(iNode.w);
  float rStart = rEnd * 0.8;
  float d = length(vec3(loc.x - uCamLocal.x, uLodCam.y, loc.y - uCamLocal.z));
  float m = clamp((d - rStart) / (rEnd - rStart), 0.0, 1.0);
  loc -= fract(grid * 0.5) * 2.0 * cell * m;
  vec2 xz = loc + uOrigin;
  float h = heightAt(xz);
  vec2 duv = (xz - uDeformRect.xy) / uDeformRect.z + 0.5;
  float inside = 0.0;
  if (uDeformRect.w > 0.5) {
    vec2 e = min(duv, 1.0 - duv);
    inside = smoothstep(0.0, 0.04, min(e.x, e.y));
    if (inside > 0.0) h += texture(uDeform, duv).r * inside;
  }
  vDuv = vec3(duv, inside);
  vWorld = vec3(xz.x, h, xz.y);
  vLocal = loc;
  vec3 rel = vec3(loc.x - uCamLocal.x, h - uCamLocal.y, loc.y - uCamLocal.z);
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * rel, 1.0);
}
`;

const FRAG = /* glsl */ `
${ATMO_GLSL}
uniform sampler2D uNormalTex;
uniform sampler2D uMaskTex;
uniform sampler2D uRipple;
uniform sampler2D uDeform;
uniform vec3 uColLoose;
uniform vec3 uColCompact;
uniform vec3 uColCrest;
uniform vec3 uColTrack;
uniform vec4 uRippleP;   // tile, strength, far tile, far strength
uniform vec4 uFx;        // sparkle, wisps, far ripple, wetness(unused)
varying vec3 vWorld;
varying vec2 vLocal;
varying vec3 vDuv;

float glintLayer(vec2 p, float cell, vec3 N, vec3 V, vec3 L) {
  vec2 q = p / cell;
  vec2 g = floor(q);
  float h = hash12(g);
  float h2 = hash12(g + 17.3);
  // each cell holds one small randomly tilted quartz facet (a sub-pixel spot, not the whole cell)
  vec2 c = vec2(hash12(g + 3.7), hash12(g + 9.1)) * 0.6 + 0.2;
  float spot = 1.0 - smoothstep(0.06, 0.24, length(q - g - c));
  vec3 fn = normalize(N + vec3(h - 0.5, 0.0, h2 - 0.5) * 0.9);
  float s = max(dot(reflect(-V, fn), L), 0.0);
  s = pow(s, 90.0);
  return s * spot * step(0.86, hash12(g + 5.1));
}

void main() {
  vec2 tuv = (vWorld.xz + uTerrUv.x) * uTerrUv.y;
  vec2 nxz = texture(uNormalTex, tuv).rg * 2.0 - 1.0;
  vec3 N = vec3(nxz.x, sqrt(max(1.0 - dot(nxz, nxz), 0.0)), nxz.y);
  vec3 mk = texture(uMaskTex, tuv).rgb;
  float loose = mk.r, crest = mk.g, slip = mk.b;
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec3 L = uSunDir;

  // wind ripples: texture has the wind along +X, rotate into the world wind direction
  vec2 wperp = vec2(-uWind.y, uWind.x);
  vec2 ruv = vec2(dot(vLocal, uWind), dot(vLocal, wperp));
  vec3 rp = texture(uRipple, ruv / uRippleP.x).rgb;
  vec2 rn = rp.rg * 2.0 - 1.0;
  float rFade = 1.0 - smoothstep(40.0, 160.0, dist);
  float rStr = uRippleP.y * (0.3 + 0.7 * loose) * (1.0 - 0.8 * slip) * rFade;
  vec2 bump = (uWind * rn.x + wperp * rn.y) * rStr;
  float macro = 0.5;
  if (uFx.z > 0.5) {
    vec3 rp2 = texture(uRipple, ruv.yx * vec2(1.0, -1.0) / uRippleP.z + 0.37).rgb;
    vec2 rn2 = rp2.rg * 2.0 - 1.0;
    float f2 = uRippleP.w * (0.4 + 0.6 * loose) * (1.0 - smoothstep(250.0, 900.0, dist));
    bump += (wperp * rn2.x - uWind * rn2.y) * f2;
    macro = texture(uRipple, vLocal / 173.0).b;
  }

  // tyre tracks (deformation layer): gb = height gradient, a = disturbed amount
  float track = 0.0;
  if (vDuv.z > 0.0) {
    vec4 df = texture(uDeform, vDuv.xy);
    bump *= 1.0 - 0.85 * df.a * vDuv.z;
    bump += -df.gb * vDuv.z;
    track = df.a * vDuv.z;
  }
  N = normalize(N + vec3(bump.x, 0.0, bump.y));

  vec3 albedo = mix(uColCompact, uColLoose, loose);
  albedo = mix(albedo, uColCrest, crest * 0.45);
  albedo *= 0.90 + 0.20 * macro;
  albedo *= 1.0 + 0.06 * (rp.b - 0.5) * rFade;
  albedo = mix(albedo, uColTrack, track * 0.55);
  if (uFx.y > 0.5) {
    // wind streaks: sand grains saltating over the crests
    vec2 suv = vec2(dot(vLocal, uWind) * 0.012 - uTime * 0.11, dot(vLocal, wperp) * 0.23);
    float st = texture(uRipple, suv).b;
    float st2 = texture(uRipple, suv * vec2(0.63, 1.7) + 0.31).b;
    float streak = smoothstep(0.50, 0.78, st * 0.55 + st2 * 0.55) * crest * (1.0 - smoothstep(300.0, 1200.0, dist));
    albedo = mix(albedo, uColCrest * 1.25, streak * 0.5);
  }

  float NL = max(dot(N, L), 0.0);
  float sh = terrainShadow(vWorld) * objShadow(vWorld);
  float retro = 0.12 * pow(max(dot(V, L), 0.0), 2.0);
  vec3 amb = mix(uGroundAmb * 0.6, uSkyAmb, N.y * 0.5 + 0.5);
  vec3 col = albedo * (uSunColor * NL * sh * (0.92 + retro) + amb);
  // broad grazing sheen of dry sand
  float NV = max(dot(N, V), 0.0);
  vec3 Hh = normalize(L + V);
  float sheen = pow(max(dot(N, Hh), 0.0), 24.0) * (0.02 + 0.10 * pow(1.0 - NV, 4.0));
  col += uSunColor * sheen * NL * sh;
  if (uFx.x > 0.5 && dist < 90.0) {
    // quartz sparkle: world-anchored facets at two footprint-matched scales, cross-faded (no flicker when still)
    float fp = max(length(fwidth(vLocal)), 0.002) * 2.5;
    float lv = log2(fp);
    float l0 = floor(lv);
    float f = lv - l0;
    float c0 = exp2(l0);
    float g = glintLayer(vLocal, c0, N, V, L) * (1.0 - f) + glintLayer(vLocal, c0 * 2.0, N, V, L) * f;
    col += uSunColor * g * 3.0 * sh * (1.0 - smoothstep(50.0, 90.0, dist)) * (0.4 + 0.6 * loose) * (1.0 - track);
  }
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function gridGeometry(g: number): THREE.InstancedBufferGeometry {
  const geo = new THREE.InstancedBufferGeometry();
  const pos = new Float32Array((g + 1) * (g + 1) * 3);
  let k = 0;
  for (let j = 0; j <= g; j++)
    for (let i = 0; i <= g; i++) {
      pos[k++] = i;
      pos[k++] = j;
      pos[k++] = 0;
    }
  const idx = new Uint16Array(g * g * 6);
  k = 0;
  for (let j = 0; j < g; j++)
    for (let i = 0; i < g; i++) {
      const a = j * (g + 1) + i;
      const b = a + 1;
      const c = a + g + 1;
      const d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  const inst = new THREE.InstancedBufferAttribute(new Float32Array(MAX_NODES * 4), 4);
  inst.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iNode', inst);
  geo.instanceCount = 0;
  return geo;
}

/** Normal map (RG8 = n.x, n.z) from the heights, dithered to hide 8-bit banding on gentle slopes. */
export function buildNormalTexture(data: TerrainData, aniso: number): THREE.DataTexture {
  const n = data.n;
  const h = data.h;
  const out = new Uint8Array(n * n * 2);
  const k = data.zs / (2 * data.res);
  let seed = 12345;
  for (let r = 0; r < n; r++) {
    const ru = r > 0 ? r - 1 : r;
    const rd = r < n - 1 ? r + 1 : r;
    for (let c = 0; c < n; c++) {
      const cl = c > 0 ? c - 1 : c;
      const cr = c < n - 1 ? c + 1 : c;
      const dx = (h[r * n + cr] - h[r * n + cl]) * k;
      const dz = (h[rd * n + c] - h[ru * n + c]) * k;
      const inv = 1 / Math.sqrt(dx * dx + dz * dz + 1);
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      const d1 = ((seed >>> 8) & 0xffff) / 65536;
      const d2 = ((seed >>> 16) & 0xffff) / 65536;
      const o = (r * n + c) * 2;
      out[o] = (-dx * inv * 0.5 + 0.5) * 255 + d1;
      out[o + 1] = (-dz * inv * 0.5 + 0.5) * 255 + d2;
    }
  }
  const t = new THREE.DataTexture(out, n, n, THREE.RGFormat, THREE.UnsignedByteType);
  t.unpackAlignment = 1;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

export class Terrain {
  readonly group = new THREE.Group();
  readonly uniforms: Record<string, THREE.IUniform>;
  stats = { nodes: 0, tris: 0 };
  detail = 1.25;
  private full: THREE.Mesh;
  private half: THREE.Mesh;
  private fullAttr: THREE.InstancedBufferAttribute;
  private halfAttr: THREE.InstancedBufferAttribute;
  private nFull = 0;
  private nHalf = 0;
  private levels = 11;
  private s0 = 20;
  private ranges: number[] = [];
  private frustum = new THREE.Frustum();
  private pv = new THREE.Matrix4();
  private box = new THREE.Box3();
  private mm: [number, number] = [0, 0];
  private cx = 0;
  private cz = 0;
  private hAbove2 = 0;
  heightTex: THREE.DataTexture;
  normalTex: THREE.DataTexture;

  constructor(readonly data: TerrainData, maskTex: THREE.Texture, rippleTex: THREE.Texture, q: TerrainQuality) {
    const ht = new THREE.DataTexture(data.h as any, data.n, data.n, THREE.RedIntegerFormat, THREE.UnsignedShortType);
    ht.internalFormat = 'R16UI';
    ht.unpackAlignment = 1;
    ht.minFilter = ht.magFilter = THREE.NearestFilter;
    ht.generateMipmaps = false;
    ht.needsUpdate = true;
    this.heightTex = ht;
    this.normalTex = buildNormalTexture(data, q.aniso);
    atmo.uTerrUv.value.set(data.half + data.res * 0.5, 1 / (data.n * data.res), 0);
    const col = (c: number[]) => {
      const k = new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
      return new THREE.Vector3(k.r, k.g, k.b);
    };
    const sc = world.sandColor;
    this.uniforms = {
      ...atmo,
      uHeight: { value: ht },
      uHInfo: { value: new THREE.Vector4(data.n, data.res, data.z0, data.zs) },
      uHalf: { value: data.half },
      uLodCam: { value: new THREE.Vector3() },
      uRange0: { value: 40 },
      uOrigin: { value: new THREE.Vector2() },
      uCamLocal: { value: new THREE.Vector3() },
      uDeform: { value: null },
      uDeformRect: { value: new THREE.Vector4(0, 0, 100, 0) },
      uNormalTex: { value: this.normalTex },
      uMaskTex: { value: maskTex },
      uRipple: { value: rippleTex },
      uColLoose: { value: col(sc.loose) },
      uColCompact: { value: col(sc.compact) },
      uColCrest: { value: col(sc.crestTint) },
      uColTrack: { value: col(sc.trackTint) },
      uRippleP: { value: new THREE.Vector4(world.ripple.tile_m, world.ripple.strength, world.ripple.farTile_m, world.ripple.farStrength) },
      uFx: { value: new THREE.Vector4(0, 0, 0, 0) },
    };
    const mk = (grid: number) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...this.uniforms, uGrid: { value: grid } },
        vertexShader: VERT,
        fragmentShader: FRAG,
      });
      const mesh = new THREE.Mesh(gridGeometry(grid), mat);
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      return mesh;
    };
    this.full = mk(GRID);
    this.half = mk(GRID / 2);
    this.fullAttr = this.full.geometry.getAttribute('iNode') as THREE.InstancedBufferAttribute;
    this.halfAttr = this.half.geometry.getAttribute('iNode') as THREE.InstancedBufferAttribute;
    this.group.add(this.full, this.half);
    this.setQuality(q);
  }

  setQuality(q: TerrainQuality): void {
    this.detail = q.terrainDetail;
    this.s0 = GRID * q.finestCell;
    this.levels = Math.round(Math.log2((2 * TerrainData.PYR_HALF) / this.s0)) + 1;
    this.normalTex.anisotropy = q.aniso;
    this.normalTex.needsUpdate = true;
    (this.uniforms.uFx.value as THREE.Vector4).set(q.sparkle ? 1 : 0, q.wisps ? 1 : 0, q.rippleFar ? 1 : 0, 0);
  }

  /** Select visible nodes for this camera. Call once per frame before rendering. */
  update(camera: THREE.PerspectiveCamera): void {
    const cp = camera.position;
    const ground = this.data.heightAt(cp.x, cp.z);
    const hAbove = Math.max(cp.y - ground, 0);
    // LOD ranges double per level; range 0 keeps the finest cells close to the camera only
    const r0 = this.s0 * 1.6 * this.detail * (0.625 / (this.s0 / GRID));
    this.ranges.length = 0;
    for (let l = 0; l < this.levels; l++) this.ranges.push(r0 * Math.pow(2, l));
    this.ranges[this.levels - 1] = Infinity;
    const u = this.uniforms;
    u.uRange0.value = r0;
    const ox = Math.round(cp.x / ORIGIN_SNAP) * ORIGIN_SNAP;
    const oz = Math.round(cp.z / ORIGIN_SNAP) * ORIGIN_SNAP;
    (u.uOrigin.value as THREE.Vector2).set(ox, oz);
    (u.uCamLocal.value as THREE.Vector3).set(cp.x - ox, cp.y, cp.z - oz);
    (u.uLodCam.value as THREE.Vector3).set(cp.x, hAbove, cp.z);
    this.cx = cp.x;
    this.cz = cp.z;
    this.hAbove2 = hAbove * hAbove;
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    this.nFull = 0;
    this.nHalf = 0;
    const root = 2 * TerrainData.PYR_HALF;
    this.select(-TerrainData.PYR_HALF, -TerrainData.PYR_HALF, root, this.levels - 1);
    (this.full.geometry as THREE.InstancedBufferGeometry).instanceCount = this.nFull;
    (this.half.geometry as THREE.InstancedBufferGeometry).instanceCount = this.nHalf;
    this.fullAttr.clearUpdateRanges();
    this.fullAttr.addUpdateRange(0, this.nFull * 4);
    this.fullAttr.needsUpdate = true;
    this.halfAttr.clearUpdateRanges();
    this.halfAttr.addUpdateRange(0, this.nHalf * 4);
    this.halfAttr.needsUpdate = true;
    this.full.visible = this.nFull > 0;
    this.half.visible = this.nHalf > 0;
    this.stats.nodes = this.nFull + this.nHalf;
    this.stats.tris = this.nFull * GRID * GRID * 2 + this.nHalf * (GRID * GRID) / 2;
  }

  private add(full: boolean, x0: number, z0: number, size: number, level: number): void {
    const attr = full ? this.fullAttr : this.halfAttr;
    const i = full ? this.nFull : this.nHalf;
    if (i >= MAX_NODES) return;
    const a = attr.array as Float32Array;
    a[i * 4] = x0;
    a[i * 4 + 1] = z0;
    a[i * 4 + 2] = size;
    a[i * 4 + 3] = level;
    if (full) this.nFull++;
    else this.nHalf++;
  }

  private select(x0: number, z0: number, size: number, level: number): boolean {
    const dx = Math.max(x0 - this.cx, 0, this.cx - (x0 + size));
    const dz = Math.max(z0 - this.cz, 0, this.cz - (z0 + size));
    const d2 = dx * dx + dz * dz + this.hAbove2;
    const r = this.ranges[level];
    if (d2 > r * r) return false;
    this.data.nodeMinMax(x0, z0, size, this.mm);
    this.box.min.set(x0, this.mm[0] - 2, z0);
    this.box.max.set(x0 + size, this.mm[1] + 1, z0 + size);
    if (!this.frustum.intersectsBox(this.box)) return true;
    if (level === 0) {
      this.add(true, x0, z0, size, 0);
      return true;
    }
    const rp = this.ranges[level - 1];
    if (d2 > rp * rp) {
      this.add(true, x0, z0, size, level);
      return true;
    }
    const hs = size / 2;
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 2; i++) {
        const cx0 = x0 + i * hs;
        const cz0 = z0 + j * hs;
        if (!this.select(cx0, cz0, hs, level - 1)) this.add(false, cx0, cz0, hs, level);
      }
    return true;
  }
}
