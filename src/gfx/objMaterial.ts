// One lightweight lit material for every non-terrain object (props, vehicles, buildings): Lambert sun + hemisphere
// ambient + the shared fog/shadow functions. Supports instancing, vertex colours and instance colours.
import * as THREE from 'three';
import { atmo, ATMO_GLSL } from '../world/atmosphere';

export interface ObjMatOpts {
  color?: THREE.ColorRepresentation;
  vertexColors?: boolean;
  side?: THREE.Side;
  /** 0..1 specular amount (paint, glass). */
  gloss?: number;
  /** Vertex sway in the wind (vegetation). */
  sway?: number;
  /** Self-illumination multiplier (lamps). */
  emissive?: number;
  transparent?: boolean;
  opacity?: number;
  receiveShadow?: boolean;
  /** Instanced only: shrink instances to nothing between fade[0] and fade[1] metres from the camera. */
  fade?: [number, number];
  /** Albedo texture on uv (multiplied with color); used by imported body models. */
  map?: THREE.Texture | null;
}

const VERT = /* glsl */ `
uniform float uTime;
uniform vec2 uWind;
uniform float uSway;
uniform vec2 uFade; // instance distance fade start/end (m); y = 0 disables
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vCol;
#ifdef USE_ALBEDO_MAP
varying vec2 vUv;
#endif
void main() {
  #ifdef USE_ALBEDO_MAP
    vUv = uv;
  #endif
  vec4 lp = vec4(position, 1.0);
  vec3 n = normal;
  #ifdef USE_INSTANCING
    if (uFade.y > 0.0) {
      vec3 io = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
      float f = 1.0 - smoothstep(uFade.x, uFade.y, distance(io.xz, cameraPosition.xz));
      lp.xyz *= f;
    }
    lp = instanceMatrix * lp;
    n = mat3(instanceMatrix) * n;
  #endif
  vec4 wp = modelMatrix * lp;
  if (uSway > 0.0) {
    float k = uSway * position.y * position.y * 0.02;
    float ph = wp.x * 0.37 + wp.z * 0.23;
    wp.xz += uWind * k * (sin(uTime * 1.7 + ph) + 0.5 * sin(uTime * 3.1 + ph * 1.7));
  }
  vWorld = wp.xyz;
  vN = normalize(mat3(modelMatrix) * n);
  vCol = vec3(1.0);
  #ifdef USE_COLOR
    vCol *= color;
  #endif
  #ifdef USE_INSTANCING_COLOR
    vCol *= instanceColor;
  #endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
${ATMO_GLSL}
uniform vec3 uColor;
uniform float uGloss;
uniform float uEmissive;
uniform float uOpacity;
uniform float uRecv;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vCol;
#ifdef USE_ALBEDO_MAP
uniform sampler2D uMap;
varying vec2 vUv;
#endif
void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 albedo = uColor * vCol;
  #ifdef USE_ALBEDO_MAP
    albedo *= texture2D(uMap, vUv).rgb;
  #endif
  float NL = max(dot(N, uSunDir), 0.0);
  float sh = terrainShadow(vWorld);
  if (uRecv > 0.5) sh *= objShadow(vWorld + N * 0.05);
  vec3 amb = mix(uGroundAmb, uSkyAmb, N.y * 0.5 + 0.5);
  vec3 col = albedo * (uSunColor * NL * sh + amb);
  if (uGloss > 0.0) {
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 H = normalize(V + uSunDir);
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    col += uSunColor * pow(max(dot(N, H), 0.0), 120.0) * uGloss * 2.5 * sh * NL;
    col = mix(col, skyColor(reflect(-V, N)), fres * uGloss * 0.6);
  }
  col += albedo * uEmissive;
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function objMaterial(o: ObjMatOpts = {}): THREE.ShaderMaterial {
  const c = new THREE.Color(o.color ?? 0xffffff);
  return new THREE.ShaderMaterial({
    uniforms: {
      ...atmo,
      uColor: { value: new THREE.Vector3(c.r, c.g, c.b) },
      uGloss: { value: o.gloss ?? 0 },
      uSway: { value: o.sway ?? 0 },
      uEmissive: { value: o.emissive ?? 0 },
      uOpacity: { value: o.opacity ?? 1 },
      uRecv: { value: o.receiveShadow ? 1 : 0 },
      uFade: { value: new THREE.Vector2(o.fade?.[0] ?? 0, o.fade?.[1] ?? 0) },
      uMap: { value: o.map ?? null },
    },
    defines: o.map ? { USE_ALBEDO_MAP: '' } : {},
    vertexShader: VERT,
    fragmentShader: FRAG,
    vertexColors: o.vertexColors ?? false,
    side: o.side ?? THREE.FrontSide,
    transparent: o.transparent ?? false,
  });
}

export function setObjColor(m: THREE.ShaderMaterial, color: THREE.ColorRepresentation): void {
  const c = new THREE.Color(color);
  (m.uniforms.uColor.value as THREE.Vector3).set(c.r, c.g, c.b);
}

/** Merge geometries (positions + normals) into one, baking a per-part colour into the vertex colours. */
export function mergeColored(parts: { geo: THREE.BufferGeometry; color: THREE.ColorRepresentation; matrix?: THREE.Matrix4 }[]): THREE.BufferGeometry {
  let count = 0;
  const prepared = parts.map((p) => {
    let g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    if (p.matrix) g.applyMatrix4(p.matrix);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    count += g.getAttribute('position').count;
    return { g, c: new THREE.Color(p.color) };
  });
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  let o = 0;
  for (const { g, c } of prepared) {
    const gp = g.getAttribute('position');
    const gn = g.getAttribute('normal');
    pos.set(gp.array as Float32Array, o * 3);
    nor.set(gn.array as Float32Array, o * 3);
    for (let i = 0; i < gp.count; i++) {
      col[(o + i) * 3] = c.r;
      col[(o + i) * 3 + 1] = c.g;
      col[(o + i) * 3 + 2] = c.b;
    }
    o += gp.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}
