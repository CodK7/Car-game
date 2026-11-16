// Sun / sky / fog state shared by every material (same uniform objects everywhere), driven by time of day.
import * as THREE from 'three';
import tod from '../config/tod.json';
import { clamp } from '../core/rng';

const v3 = () => new THREE.Vector3();

/** Shared uniforms. Spread into each ShaderMaterial's uniforms: the {value} holders are shared by reference. */
export const atmo = {
  uSunDir: { value: new THREE.Vector3(0.3, 0.6, 0.2).normalize() },
  uSunColor: { value: v3() },
  uSkyZenith: { value: v3() },
  uSkyHorizon: { value: v3() },
  uSunGlow: { value: v3() },
  uGroundAmb: { value: v3() },
  uSkyAmb: { value: v3() },
  uFog: { value: new THREE.Vector4(0.00007, 1 / 600, 300, 0.97) }, // density, height falloff, base height, max
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector2(1, 0) }, // unit vector the wind blows towards (x east, z south)
  uTerrShadow: { value: null as THREE.Texture | null }, // baked heightfield sun shadow (R), terrain uv space
  uObjShadow: { value: null as THREE.Texture | null }, // depth map of vehicles/props near the player
  uObjShadowMat: { value: new THREE.Matrix4() },
  uObjShadowOn: { value: 0 },
  uTerrUv: { value: new THREE.Vector3(10082.5, 1 / 20165, 0) }, // world xz -> terrain uv: (xz + x) * y
};

/** GLSL shared by terrain, props, vehicles and sky. Needs `cameraPosition` (three built-in). */
export const ATMO_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSunGlow;
uniform vec3 uGroundAmb;
uniform vec3 uSkyAmb;
uniform vec4 uFog;
uniform float uTime;
uniform vec2 uWind;
uniform sampler2D uTerrShadow;
uniform sampler2D uObjShadow;
uniform mat4 uObjShadowMat;
uniform float uObjShadowOn;
uniform vec3 uTerrUv;

vec3 skyColor(vec3 d) {
  float hz = exp(-max(d.y, 0.0) * 5.0);
  vec3 c = mix(uSkyZenith, uSkyHorizon, hz);
  float cs = max(dot(d, uSunDir), 0.0);
  float cs2 = cs * cs;
  float cs8 = cs2 * cs2; cs8 *= cs8;
  c += uSunGlow * (0.30 * cs2 * cs2 * cs * (0.3 + 0.7 * hz) + 0.9 * cs8 * cs8 * cs8 * cs8 * cs8 * cs8);
  if (d.y < 0.0) c = mix(c, uSkyHorizon * 0.55 + uGroundAmb * 0.35, smoothstep(0.0, -0.25, d.y));
  return c;
}

vec3 applyFog(vec3 col, vec3 worldPos) {
  vec3 v = worldPos - cameraPosition;
  float dist = length(v);
  vec3 rd = v / max(dist, 1e-3);
  float dy = rd.y;
  if (abs(dy) < 1e-4) dy = 1e-4;
  float a = uFog.x * exp(-uFog.y * max(cameraPosition.y - uFog.z, -200.0));
  float od = a * (1.0 - exp(-uFog.y * dy * dist)) / (uFog.y * dy);
  float f = min(1.0 - exp(-od), uFog.w);
  vec3 fc = skyColor(normalize(vec3(rd.x, max(rd.y, 0.0) * 0.5 + 0.015, rd.z)));
  return mix(col, fc, f);
}

float terrainShadow(vec3 wp) {
  return texture(uTerrShadow, (wp.xz + uTerrUv.x) * uTerrUv.y).r;
}

float objShadow(vec3 wp) {
  if (uObjShadowOn < 0.5) return 1.0;
  vec4 sc = uObjShadowMat * vec4(wp, 1.0);
  vec3 p = sc.xyz * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  vec2 ts = 1.0 / vec2(textureSize(uObjShadow, 0));
  float z = p.z - 0.0025;
  float s = 0.0;
  s += step(z, texture(uObjShadow, p.xy + ts * vec2(-0.5, -0.5)).r);
  s += step(z, texture(uObjShadow, p.xy + ts * vec2(0.5, -0.5)).r);
  s += step(z, texture(uObjShadow, p.xy + ts * vec2(-0.5, 0.5)).r);
  s += step(z, texture(uObjShadow, p.xy + ts * vec2(0.5, 0.5)).r);
  vec2 e = min(p.xy, 1.0 - p.xy);
  float edge = smoothstep(0.0, 0.06, min(e.x, e.y));
  return mix(1.0, s * 0.25, edge);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

interface Key {
  el: number;
  sun: number[];
  zenith: number[];
  horizon: number[];
  glow: number[];
  ground: number[];
  fog: number;
  exposure: number;
}

/** Time of day: computes the real sun direction for the site latitude and blends the sky keyframes by sun elevation. */
export class TimeOfDay {
  hour = tod.default_hour;
  latitudeDeg = tod.latitude_deg;
  declinationDeg = tod.declination_deg;
  windDirDeg = tod.wind_dir_deg;
  exposure = 1;
  exposureBias = 1;
  hazeScale = 1;
  elevationDeg = 0;
  /** Bumped whenever the sun moved enough to require re-baking terrain shadows. */
  version = 0;
  private lastBakedDir = new THREE.Vector3();
  private keys: Key[] = tod.keys as Key[];

  update(): void {
    const lat = (this.latitudeDeg * Math.PI) / 180;
    const dec = (this.declinationDeg * Math.PI) / 180;
    const H = ((this.hour - 12) * 15 * Math.PI) / 180;
    const sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
    const east = -Math.cos(dec) * Math.sin(H);
    const north = Math.cos(lat) * Math.sin(dec) - Math.sin(lat) * Math.cos(dec) * Math.cos(H);
    const el = (Math.asin(clamp(sinEl, -1, 1)) * 180) / Math.PI;
    this.elevationDeg = el;
    // Keep a tiny positive elevation for lighting maths below the horizon (sun colour goes to zero anyway).
    const dir = atmo.uSunDir.value.set(east, Math.max(sinEl, 0.02), -north).normalize();
    if (dir.distanceTo(this.lastBakedDir) > 0.004) {
      this.lastBakedDir.copy(dir);
      this.version++;
    }

    const k = this.keys;
    let i = 0;
    while (i < k.length - 2 && el > k[i + 1].el) i++;
    const a = k[i];
    const b = k[i + 1];
    const t = clamp((el - a.el) / (b.el - a.el), 0, 1);
    const mix = (u: THREE.Vector3, x: number[], y: number[]) =>
      u.set(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
    mix(atmo.uSunColor.value, a.sun, b.sun);
    mix(atmo.uSkyZenith.value, a.zenith, b.zenith);
    mix(atmo.uSkyHorizon.value, a.horizon, b.horizon);
    mix(atmo.uSunGlow.value, a.glow, b.glow);
    mix(atmo.uGroundAmb.value, a.ground, b.ground);
    atmo.uSkyAmb.value.copy(atmo.uSkyZenith.value).multiplyScalar(0.55).addScaledVector(atmo.uSkyHorizon.value, 0.45);
    atmo.uFog.value.x = (a.fog + (b.fog - a.fog) * t) * this.hazeScale;
    this.exposure = (a.exposure + (b.exposure - a.exposure) * t) * this.exposureBias;
    const w = (this.windDirDeg * Math.PI) / 180; // compass bearing the wind blows towards
    atmo.uWind.value.set(Math.sin(w), -Math.cos(w));
  }
}
