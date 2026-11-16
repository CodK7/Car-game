// Cascaded sun shadow maps for objects (vehicle, trees, shrubs, houses). The terrain's own shadows are baked
// (shadowBake.ts); these add object shadows onto the terrain and onto other objects.
// Cascades share one depth atlas (side by side). Each cascade is a stable bounding sphere of its view-frustum slice,
// snapped to whole shadow texels in light space (no shimmering when the camera moves). Budget: cascade 0 renders
// every frame, cascade 1 every 2nd frame, cascade 2 every 4th; a cascade's matrix is published only when it is
// re-rendered, so the shader always matches the map it samples.
import * as THREE from 'three';
import { atmo } from '../world/atmosphere';

export const SHADOW_LAYER = 1;

export interface ShadowCfg { size: number; splits: number[] }

export class ObjShadows {
  rt: THREE.WebGLRenderTarget | null = null;
  enabled = true;
  /** ms spent rendering shadow maps this frame */
  ms = 0;
  renders = 0;
  private cams: THREE.OrthographicCamera[] = [];
  private cfg: ShadowCfg = { size: 0, splits: [] };
  private depthMat = new THREE.MeshDepthMaterial();
  private frame = 0;
  private roots: THREE.Object3D[] = [];
  private tmp = new THREE.Vector3();
  private corners = Array.from({ length: 8 }, () => new THREE.Vector3());

  setRoots(roots: THREE.Object3D[]): void {
    this.roots = roots;
  }

  configure(cfg: ShadowCfg): void {
    this.cfg = cfg;
    this.rt?.dispose();
    this.rt = null;
    const n = cfg.splits.length - 1;
    if (!cfg.size || n < 1) {
      atmo.uObjShadowOn.value = 0;
      return;
    }
    const rt = new THREE.WebGLRenderTarget(cfg.size * n, cfg.size, { depthBuffer: true, stencilBuffer: false, type: THREE.UnsignedByteType });
    rt.texture.generateMipmaps = false;
    rt.depthTexture = new THREE.DepthTexture(cfg.size * n, cfg.size, THREE.UnsignedIntType);
    rt.depthTexture.minFilter = rt.depthTexture.magFilter = THREE.NearestFilter;
    this.rt = rt;
    this.cams = Array.from({ length: n }, () => {
      const c = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 1000);
      c.layers.set(SHADOW_LAYER);
      return c;
    });
    atmo.uObjShadow.value = rt.depthTexture;
    atmo.uObjShadowCount.value = n;
    const sp = atmo.uObjShadowSplits.value as THREE.Vector4;
    sp.set(cfg.splits[1] ?? 0, cfg.splits[2] ?? 0, cfg.splits[3] ?? 0, n);
    atmo.uObjShadowOn.value = 0; // until the first maps exist
    this.frame = 0;
  }

  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.ms = 0;
    this.renders = 0;
    if (!this.rt || !this.enabled) {
      atmo.uObjShadowOn.value = 0;
      return;
    }
    const t0 = performance.now();
    for (const r of this.roots) r.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !o.userData.noShadow) o.layers.enable(SHADOW_LAYER);
    });
    const n = this.cams.length;
    const size = this.cfg.size;
    const prevTarget = renderer.getRenderTarget();
    const prevOverride = scene.overrideMaterial;
    const prevAuto = renderer.autoClear;
    scene.overrideMaterial = this.depthMat;
    renderer.autoClear = false;
    const sun = atmo.uSunDir.value as THREE.Vector3;
    for (let i = 0; i < n; i++) {
      const period = i === 0 ? 1 : i === 1 ? 2 : 4;
      if (this.frame > 2 && (this.frame + i) % period !== 0) continue;
      this.fit(i, camera, sun);
      this.rt.viewport.set(i * size, 0, size, size);
      this.rt.scissor.set(i * size, 0, size, size);
      this.rt.scissorTest = true;
      renderer.setRenderTarget(this.rt);
      renderer.clear(false, true, false);
      renderer.render(scene, this.cams[i]);
      const m = (atmo.uObjShadowMats.value as THREE.Matrix4[])[i];
      m.multiplyMatrices(this.cams[i].projectionMatrix, this.cams[i].matrixWorldInverse);
      this.renders++;
    }
    scene.overrideMaterial = prevOverride;
    renderer.autoClear = prevAuto;
    renderer.setRenderTarget(prevTarget);
    atmo.uObjShadowOn.value = 1;
    this.frame++;
    this.ms = performance.now() - t0;
  }

  /** Fit cascade i around its frustum slice (bounding sphere, texel-snapped). */
  private fit(i: number, camera: THREE.PerspectiveCamera, sun: THREE.Vector3): void {
    const near = Math.max(camera.near, this.cfg.splits[i]);
    const far = this.cfg.splits[i + 1];
    const tanY = Math.tan((camera.fov * Math.PI) / 360);
    const tanX = tanY * camera.aspect;
    camera.updateMatrixWorld();
    let k = 0;
    for (const d of [near, far]) for (const sx of [-1, 1]) for (const sy of [-1, 1]) this.corners[k++].set(sx * tanX * d, sy * tanY * d, -d).applyMatrix4(camera.matrixWorld);
    const c = this.tmp.set(0, 0, 0);
    for (const p of this.corners) c.add(p);
    c.multiplyScalar(1 / 8);
    let r = 0;
    for (const p of this.corners) r = Math.max(r, p.distanceTo(c));
    r = Math.ceil(r); // whole metres: the projection size changes only in steps
    const size = this.cfg.size;
    const cam = this.cams[i];
    const back = r + 160; // casters up to ~160 m above the slice (tall trees, dune shoulders do not cast here)
    // light basis
    const up = Math.abs(sun.y) > 0.98 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    const zA = sun.clone().normalize();
    const xA = new THREE.Vector3().crossVectors(up, zA).normalize();
    const yA = new THREE.Vector3().crossVectors(zA, xA);
    // snap the centre to whole texels in light space
    const texel = (2 * r) / size;
    const cx = Math.round(c.dot(xA) / texel) * texel;
    const cy = Math.round(c.dot(yA) / texel) * texel;
    const cz = c.dot(zA);
    const centre = new THREE.Vector3().addScaledVector(xA, cx).addScaledVector(yA, cy).addScaledVector(zA, cz);
    cam.position.copy(centre).addScaledVector(zA, back);
    cam.up.copy(yA);
    cam.lookAt(centre);
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 0.5;
    cam.far = back + r + 20;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }
}
