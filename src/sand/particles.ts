// Sand spray: instanced camera-facing quads with analytic ballistic motion (gravity + linear drag) evaluated in the
// vertex shader. The CPU only writes a particle's spawn record into a ring buffer, so cost is O(spawns), not O(alive).
// Hard budget = ring size (quality preset); emission scaled down with camera distance (LOD).
import * as THREE from 'three';
import { atmo, ATMO_GLSL } from '../world/atmosphere';
import cfg from '../config/sand.json';
import { mulberry32 } from '../core/rng';

const VERT = /* glsl */ `
${ATMO_GLSL}
attribute vec4 aP0;   // spawn position xyz, spawn time
attribute vec4 aV0;   // velocity xyz, life
attribute vec2 aSz;   // size, seed
uniform float uNow;
uniform float uDrag;
uniform float uGrav;
varying float vA;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  float age = uNow - aP0.w;
  float life = aV0.w;
  vUv = position.xy;
  if (age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; return; }
  float k = uDrag;
  float e = exp(-k * age);
  vec3 p = aP0.xyz + aV0.xyz * (1.0 - e) / k;
  p.y -= uGrav / k * (age - (1.0 - e) / k);
  float u = age / life;
  float size = aSz.x * (0.7 + 1.3 * u);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float a = aSz.y * 6.283;
  vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * position.xy;
  vec3 wp = p + (right * q.x + up * q.y) * size;
  vWorld = wp;
  vA = (1.0 - u) * (1.0 - u) * smoothstep(0.0, 0.08, u);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const FRAG = /* glsl */ `
${ATMO_GLSL}
uniform vec3 uColor;
uniform float uOpacity;
varying float vA;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  float r = length(vUv) * 2.0;
  float m = smoothstep(1.0, 0.25, r);
  float a = m * vA * uOpacity;
  if (a < 0.01) discard;
  float sh = terrainShadow(vWorld);
  vec3 col = uColor * (uSunColor * (0.55 + 0.45 * max(uSunDir.y, 0.0)) * sh + uSkyAmb * 0.9 + uGroundAmb * 0.4);
  gl_FragColor = vec4(applyFog(col, vWorld), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface SprayEmit {
  x: number; y: number; z: number; // contact point
  fx: number; fz: number; // tyre forward (unit, ground plane)
  slipSpeed: number; // wheel surface speed minus ground speed (m/s, signed along forward)
  speed: number; // vehicle speed m/s
  loose: number; // 0..1
  steer: number; // -1..1, throws sand sideways
  radius: number; // tyre radius
}

export class SandSpray {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private p0: THREE.InstancedBufferAttribute;
  private v0: THREE.InstancedBufferAttribute;
  private sz: THREE.InstancedBufferAttribute;
  private head = 0;
  private cap: number;
  private acc: number[] = [];
  private rnd = mulberry32(77);
  private mat: THREE.ShaderMaterial;
  private dirtyLo = Infinity;
  private dirtyHi = -1;
  spawned = 0;
  budget: number;
  now = 0;

  constructor(maxParticles: number) {
    this.cap = Math.max(16, maxParticles);
    this.budget = this.cap;
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.p0 = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 4).fill(-1e6), 4);
    this.v0 = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 4), 4);
    this.sz = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 2), 2);
    for (const a of [this.p0, this.v0, this.sz]) a.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aP0', this.p0);
    this.geo.setAttribute('aV0', this.v0);
    this.geo.setAttribute('aSz', this.sz);
    this.geo.instanceCount = this.cap;
    const c = cfg.particles.color;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        ...atmo,
        uNow: { value: 0 },
        uDrag: { value: cfg.particles.drag },
        uGrav: { value: cfg.particles.gravity },
        uColor: { value: new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace) },
        uOpacity: { value: cfg.particles.opacity },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  setBudget(n: number): void {
    this.budget = Math.min(this.cap, Math.max(0, n));
  }

  /** Emit spray for one wheel this frame. `camDist` drives distance LOD. */
  emit(wheel: number, e: SprayEmit, dt: number, camDist: number): void {
    const P = cfg.particles;
    if (this.budget <= 0) return;
    const lod = 1 - Math.min(1, Math.max(0, (camDist - P.lodNear_m) / (P.lodFar_m - P.lodNear_m)));
    const slip = Math.abs(e.slipSpeed);
    const rate = Math.min(P.maxPerWheelPerSec, (slip * P.spawnPerSlipMeter * 10 + e.speed * P.spawnPerSpeed * 10 + Math.abs(e.steer) * e.speed * 3) * (0.25 + 0.75 * e.loose)) * lod * (this.budget / 1000);
    this.acc[wheel] = (this.acc[wheel] ?? 0) + rate * dt;
    let n = Math.floor(this.acc[wheel]);
    this.acc[wheel] -= n;
    n = Math.min(n, 64);
    const r = this.rnd;
    // spray is thrown backwards relative to the tyre spin direction, up and out
    const dir = Math.sign(e.slipSpeed + 0.3 * (e.speed > 0 ? 1 : 0)) || 1;
    const sideX = -e.fz, sideZ = e.fx;
    for (let i = 0; i < n; i++) {
      const k = this.head;
      this.head = (this.head + 1) % this.budget;
      const back = -(0.4 + r() * 0.8) * (slip * 0.9 + e.speed * 0.25 + 0.4) * dir;
      const side = (r() - 0.5) * (0.8 + slip * 0.35) + e.steer * e.speed * 0.15;
      const up = (0.6 + r() * 1.4) * (0.5 + slip * 0.35 + e.speed * 0.05);
      const P0 = this.p0.array as Float32Array, V0 = this.v0.array as Float32Array, S = this.sz.array as Float32Array;
      P0[k * 4] = e.x - e.fx * e.radius * 0.6 * dir + sideX * (r() - 0.5) * 0.3;
      P0[k * 4 + 1] = e.y + 0.05 + r() * 0.15;
      P0[k * 4 + 2] = e.z - e.fz * e.radius * 0.6 * dir + sideZ * (r() - 0.5) * 0.3;
      P0[k * 4 + 3] = this.now + r() * dt;
      V0[k * 4] = e.fx * back + sideX * side;
      V0[k * 4 + 1] = up;
      V0[k * 4 + 2] = e.fz * back + sideZ * side;
      V0[k * 4 + 3] = P.life_s[0] + r() * (P.life_s[1] - P.life_s[0]);
      S[k * 2] = P.size_m[0] + Math.pow(r(), 2) * (P.size_m[1] - P.size_m[0]);
      S[k * 2 + 1] = r();
      if (k < this.dirtyLo) this.dirtyLo = k;
      if (k > this.dirtyHi) this.dirtyHi = k;
      this.spawned++;
    }
  }

  update(now: number): void {
    this.now = now;
    this.mat.uniforms.uNow.value = now;
    if (this.dirtyHi >= 0) {
      for (const [a, w] of [[this.p0, 4], [this.v0, 4], [this.sz, 2]] as [THREE.InstancedBufferAttribute, number][]) {
        a.clearUpdateRanges();
        a.addUpdateRange(this.dirtyLo * w, (this.dirtyHi - this.dirtyLo + 1) * w);
        a.needsUpdate = true;
      }
      this.dirtyLo = Infinity;
      this.dirtyHi = -1;
    }
    this.geo.instanceCount = this.budget;
  }
}
