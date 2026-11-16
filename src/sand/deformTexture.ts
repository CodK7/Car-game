// Uploads the CPU deformation grid to an RG16F texture (R = height delta, G = disturbed), dirty rectangles only.
// The texture wraps (RepeatWrapping) and is addressed by world position / size, matching the toroidal grid slots.
import * as THREE from 'three';
import { DeformGrid, Rect } from './deformGrid';

export class DeformTexture {
  readonly tex: THREE.DataTexture;
  private half: Uint16Array<ArrayBuffer>;
  private buf: Uint16Array<ArrayBuffer>;
  uploadedTexels = 0;
  uploadMs = 0;

  constructor(readonly grid: DeformGrid) {
    const n = grid.n;
    this.half = new Uint16Array(n * n * 2);
    this.buf = new Uint16Array(n * n * 2);
    this.tex = new THREE.DataTexture(this.half, n, n, THREE.RGFormat, THREE.HalfFloatType);
    this.tex.wrapS = this.tex.wrapT = THREE.RepeatWrapping;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = false;
    this.tex.flipY = false;
    this.tex.needsUpdate = true;
  }

  /** Push dirty rectangles to the GPU. Call once per frame after the grid changed. */
  upload(renderer: THREE.WebGLRenderer): void {
    const rects = this.grid.takeDirty();
    this.uploadedTexels = 0;
    if (!rects.length) return;
    const t0 = performance.now();
    const props = renderer.properties.get(this.tex) as { __webglTexture?: WebGLTexture };
    if (!props.__webglTexture) {
      // first use: let three allocate + upload the whole texture
      this.convert({ x0: this.grid.ix0, z0: this.grid.iz0, x1: this.grid.ix0 + this.grid.n, z1: this.grid.iz0 + this.grid.n }, true);
      renderer.initTexture(this.tex);
      this.uploadMs = performance.now() - t0;
      return;
    }
    const gl = renderer.getContext() as WebGL2RenderingContext;
    renderer.state.activeTexture(gl.TEXTURE0 + 15);
    renderer.state.bindTexture(gl.TEXTURE_2D, props.__webglTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    const n = this.grid.n;
    for (const r of rects) {
      // split at the wrap seams of the toroidal storage
      for (const [ax, bx] of this.splits(r.x0, r.x1))
        for (const [az, bz] of this.splits(r.z0, r.z1)) {
          const sx = this.grid.slotCoord(ax), sz = this.grid.slotCoord(az);
          const w = bx - ax, h = bz - az;
          if (w <= 0 || h <= 0) continue;
          const sub = this.pack(sx, sz, w, h);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, sx, sz, w, h, gl.RG, gl.HALF_FLOAT, sub);
          this.uploadedTexels += w * h;
        }
    }
    void n;
    this.uploadMs = performance.now() - t0;
  }

  private splits(a: number, b: number): [number, number][] {
    const n = this.grid.n;
    const sa = this.grid.slotCoord(a);
    const len = b - a;
    if (sa + len <= n) return [[a, b]];
    const cut = a + (n - sa);
    return [[a, cut], [cut, b]];
  }

  /** Convert a slot-space block (no wrap) to packed half floats in a scratch buffer. */
  private pack(sx: number, sz: number, w: number, h: number): Uint16Array<ArrayBuffer> {
    const n = this.grid.n;
    const out = this.buf.subarray(0, w * h * 2);
    const H = this.grid.h, D = this.grid.d;
    const toHalf = THREE.DataUtils.toHalfFloat;
    let k = 0;
    for (let z = sz; z < sz + h; z++) {
      const row = z * n;
      for (let x = sx; x < sx + w; x++) {
        out[k++] = toHalf(H[row + x]);
        out[k++] = toHalf(D[row + x]);
      }
    }
    return out;
  }

  private convert(_r: Rect, all: boolean): void {
    if (!all) return;
    const H = this.grid.h, D = this.grid.d;
    const toHalf = THREE.DataUtils.toHalfFloat;
    for (let i = 0; i < H.length; i++) {
      this.half[2 * i] = toHalf(H[i]);
      this.half[2 * i + 1] = toHalf(D[i]);
    }
  }
}
