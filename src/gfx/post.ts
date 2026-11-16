// Post-processing (Medium/High): the scene renders linear HDR into a half-float target with a depth texture, then one
// full-screen pass adds (each toggleable) heat shimmer (distance-masked, strongest at noon), dust haze (depth-based
// in-scattering, brighter towards the sun), subtle lens dust (only when looking near the sun), a gentle contrast
// curve, ACES tone mapping, sRGB output and dithering. No temporal accumulation is used, so there is no ghosting.
import * as THREE from 'three';
import { atmo } from '../world/atmosphere';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = /* glsl */ `
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tLens;
uniform float uNear, uFar, uTime, uHeat;
uniform vec4 uFxOn;        // shimmer, haze, lens dust, contrast
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uSunDir, uSunColor, uSkyHorizon;
uniform vec3 uSunScreen;   // uv.xy of the sun, z = visibility
uniform float uHazeDensity;
uniform vec2 uTexel;
varying vec2 vUv;

float viewDist(vec2 uv) {
  float d = texture2D(tDepth, uv).r;
  return -perspectiveDepthToViewZ(d, uNear, uFar);
}
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}

void main() {
  vec2 uv = vUv;
  float dist = viewDist(uv);
  // heat shimmer: rising, smoothly varying refraction of distant ground near the horizon
  if (uFxOn.x > 0.5 && uHeat > 0.0) {
    float m = smoothstep(80.0, 600.0, dist) * uHeat;
    if (m > 0.001) {
      vec2 q = vec2(uv.x * 90.0, uv.y * 160.0 - uTime * 2.2);
      vec2 off = (vec2(vnoise(q), vnoise(q + 17.3)) - 0.5) * vec2(0.0012, 0.0020) * m;
      // never pull a nearer object's colour into the background (no halo around the car)
      if (viewDist(uv + off) > dist * 0.8) uv += off;
    }
  }
  vec3 col = texture2D(tColor, uv).rgb;
  // world-space view ray
  vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 rd = normalize((uCamWorld * vec4(normalize(vp.xyz / vp.w), 0.0)).xyz);
  if (uFxOn.y > 0.5) {
    // suspended dust: extinction with distance, forward scattering towards the sun
    float dd = min(dist, 9000.0);
    float f = 1.0 - exp(-dd * uHazeDensity * (1.0 + 2.0 * exp(-max(rd.y, 0.0) * 6.0)));
    float mu = max(dot(rd, uSunDir), 0.0);
    vec3 dust = uSkyHorizon * vec3(1.0, 0.86, 0.66) * 0.9 + uSunColor * vec3(1.0, 0.8, 0.55) * (0.02 + 0.10 * pow(mu, 6.0));
    col = mix(col, dust, f * 0.85);
  }
  if (uFxOn.z > 0.5 && uSunScreen.z > 0.0) {
    // lens dust lit by the sun when it is in or near the frame
    float ds = distance(uv * vec2(1.0, uTexel.x / uTexel.y), uSunScreen.xy * vec2(1.0, uTexel.x / uTexel.y));
    float glow = uSunScreen.z * (0.25 + 0.75 * exp(-ds * 2.5));
    vec3 lens = texture2D(tLens, vUv).rgb;
    col += lens * uSunColor * glow * 0.035;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  if (uFxOn.w > 0.0) {
    vec3 c = clamp(gl_FragColor.rgb, 0.0, 1.0);
    gl_FragColor.rgb = mix(c, c * c * (3.0 - 2.0 * c), uFxOn.w); // gentle S-curve: dune shading reads photographic
  }
  #include <colorspace_fragment>
  gl_FragColor.rgb += (h21(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0;
}
`;

/** Procedural lens dust: soft specks and a few smears on a dark canvas (generated once). */
function lensTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 288;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  let s = 1234;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 140; i++) {
    const x = rnd() * c.width, y = rnd() * c.height, r = 1 + rnd() * rnd() * 14;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.05 + rnd() * 0.25;
    gr.addColorStop(0, `rgba(255,240,220,${a})`);
    gr.addColorStop(1, 'rgba(255,240,220,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 0.05;
  g.strokeStyle = '#fff';
  for (let i = 0; i < 6; i++) {
    g.lineWidth = 4 + rnd() * 10;
    g.beginPath();
    g.moveTo(rnd() * c.width, rnd() * c.height);
    g.bezierCurveTo(rnd() * c.width, rnd() * c.height, rnd() * c.width, rnd() * c.height, rnd() * c.width, rnd() * c.height);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export class PostFx {
  fx = { shimmer: true, haze: true, lensDust: true, contrast: 0.12, hazeDensity: 0.00011 };
  ms = 0;
  private rt: THREE.WebGLRenderTarget;
  private mat: THREE.ShaderMaterial;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private v = new THREE.Vector3();

  constructor() {
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false });
    this.rt.depthTexture = new THREE.DepthTexture(4, 4, THREE.UnsignedIntType);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.rt.texture },
        tDepth: { value: this.rt.depthTexture },
        tLens: { value: lensTexture() },
        uNear: { value: 0.4 },
        uFar: { value: 45000 },
        uTime: { value: 0 },
        uHeat: { value: 0 },
        uFxOn: { value: new THREE.Vector4() },
        uInvProj: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uSunDir: atmo.uSunDir,
        uSunColor: atmo.uSunColor,
        uSkyHorizon: atmo.uSkyHorizon,
        uSunScreen: { value: new THREE.Vector3() },
        uHazeDensity: { value: 0 },
        uTexel: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
  }

  setSize(w: number, h: number): void {
    if (this.rt.width === w && this.rt.height === h) return;
    this.rt.setSize(w, h);
    (this.mat.uniforms.uTexel.value as THREE.Vector2).set(1 / w, 1 / h);
  }

  /** flags from the quality preset (each effect also needs its own toggle in `fx`) */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, q: { shimmer: boolean; haze?: boolean; lensDust: boolean }, time: number, sunElevDeg: number): void {
    const t0 = performance.now();
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.setSize(size.x, size.y);
    renderer.setRenderTarget(this.rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    const u = this.mat.uniforms;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uTime.value = time;
    // heat shimmer grows with sun height (ground heating); none at dusk
    u.uHeat.value = Math.max(0, Math.min(1, (sunElevDeg - 8) / 30));
    (u.uFxOn.value as THREE.Vector4).set(q.shimmer && this.fx.shimmer ? 1 : 0, (q.haze ?? true) && this.fx.haze ? 1 : 0, q.lensDust && this.fx.lensDust ? 1 : 0, this.fx.contrast);
    (u.uInvProj.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    (u.uCamWorld.value as THREE.Matrix4).copy(camera.matrixWorld);
    u.uHazeDensity.value = this.fx.hazeDensity;
    // sun position on screen; visibility fades as it leaves the frame and when it is behind the camera
    const sp = this.v.copy(atmo.uSunDir.value as THREE.Vector3).multiplyScalar(10000).add(camera.position).project(camera);
    const ahead = (atmo.uSunDir.value as THREE.Vector3).dot(camera.getWorldDirection(new THREE.Vector3()));
    const off = Math.max(Math.abs(sp.x), Math.abs(sp.y));
    const vis = ahead > 0 ? Math.max(0, 1 - Math.max(0, off - 0.8) / 0.9) * Math.min(1, ahead * 2) : 0;
    (u.uSunScreen.value as THREE.Vector3).set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5, vis);
    renderer.render(this.quadScene, this.quadCam);
    this.ms = performance.now() - t0;
  }
}
