// Terrain self-shadowing: a GPU pass marches from every texel towards the sun through a half-float copy of the
// heightmap and writes a soft shadow factor (penumbra from the sun's angular size + haze). Re-baked only when the
// sun moves. Cheap at run time: one texture fetch per pixel.
import * as THREE from 'three';
import { atmo } from './atmosphere';
import { TerrainData } from './terrainData';

const MARCH_STEPS = 56;

export class TerrainShadowBaker {
  private rt: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: THREE.ShaderMaterial;
  private hTex: THREE.DataTexture;
  lastVersion = -1;
  bakeMs = 0;
  softnessDeg = 1.2;

  constructor(readonly t: TerrainData, readonly res: number) {
    // downsampled height copy (metres above z0), half float with linear filtering
    const n = Math.min(res, 2048);
    const h = new Uint16Array(n * n);
    const step = (t.n - 1) / (n - 1);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) h[j * n + i] = THREE.DataUtils.toHalfFloat(t.heightTexel(Math.round(i * step), Math.round(j * step)) - t.z0);
    this.hTex = new THREE.DataTexture(h, n, n, THREE.RedFormat, THREE.HalfFloatType);
    this.hTex.minFilter = this.hTex.magFilter = THREE.LinearFilter;
    this.hTex.needsUpdate = true;
    this.rt = new THREE.WebGLRenderTarget(res, res, { type: THREE.UnsignedByteType, format: THREE.RedFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uH: { value: this.hTex },
        uExtent: { value: t.n * t.res },
        uSun: atmo.uSunDir,
        uTanSoft: { value: Math.tan((this.softnessDeg * Math.PI) / 180) },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform sampler2D uH; uniform float uExtent; uniform vec3 uSun; uniform float uTanSoft;
        varying vec2 vUv;
        void main() {
          vec3 s = normalize(uSun);
          vec2 dir = s.xz / max(length(s.xz), 1e-4);
          float tanEl = s.y / max(length(s.xz), 1e-4);
          float h0 = texture2D(uH, vUv).r + 0.6;
          float res = 1.0;
          float d = 6.0;
          for (int i = 0; i < ${MARCH_STEPS}; i++) {
            vec2 uv = vUv + dir * d / uExtent;
            if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) break;
            float hr = h0 + d * tanEl;
            if (hr > 200.0) break;
            float ht = texture2D(uH, uv).r;
            res = min(res, (hr - ht) / (d * uTanSoft));
            d *= 1.11;
          }
          float sh = clamp(0.5 + 0.5 * res, 0.0, 1.0);
          gl_FragColor = vec4(sh * sh * (3.0 - 2.0 * sh), 0.0, 0.0, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
    atmo.uTerrShadow.value = this.rt.texture;
  }

  /** Bake if the sun moved (tod.version changed). Returns true if a bake happened. */
  update(renderer: THREE.WebGLRenderer, version: number): boolean {
    if (version === this.lastVersion) return false;
    this.lastVersion = version;
    this.mat.uniforms.uTanSoft.value = Math.tan((this.softnessDeg * Math.PI) / 180);
    const t0 = performance.now();
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(prev);
    this.bakeMs = performance.now() - t0;
    return true;
  }

  dispose(): void {
    this.rt.dispose();
    this.hTex.dispose();
    this.mat.dispose();
  }
}
