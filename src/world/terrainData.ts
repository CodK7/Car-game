// CPU-side terrain data: the single source of truth for ground height (physics + placement).
// Pure TypeScript (no DOM/WebGL) so it runs in Vitest. The GPU vertex shader uses the same bicubic formula.

export interface TerrainManifest {
  size: number;
  resolution_m: number;
  extent_m: number;
  z0_m: number;
  z_step_m: number;
  height_min_m: number;
  height_max_m: number;
  height: string;
  masks: string;
  masks_size: number;
  ripple: string;
  ripple_tile_m: number;
  osm: string;
  attribution: string[];
}

export const MASK_LOOSE = 0;
export const MASK_CREST = 1;
export const MASK_SLIP = 2;

/** Anything the physics can stand on. */
export interface Ground {
  heightAt(x: number, z: number): number;
  normalAt(x: number, z: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number };
  /** 0 = compacted sand / hard ground, 1 = loose sand. */
  looseAt(x: number, z: number): number;
}

export class TerrainData implements Ground {
  readonly n: number;
  readonly res: number;
  readonly half: number; // half extent in metres (texel centres span [-half, +half])
  readonly z0: number;
  readonly zs: number;
  readonly h: Uint16Array;
  masks: Uint8Array | null = null; // RGBA, masksN x masksN
  masksN = 0;
  /** Optional override (roads/tracks make the sand compact). */
  looseOverride: ((x: number, z: number, loose: number) => number) | null = null;
  // min/max pyramid for culling: level 0 blocks are BLOCK metres wide, origin at -PYR_HALF
  static readonly BLOCK = 160;
  static readonly PYR_DIM = 128;
  static readonly PYR_HALF = 10240;
  pyrMin: Float32Array[] = [];
  pyrMax: Float32Array[] = [];

  constructor(m: Pick<TerrainManifest, 'size' | 'resolution_m' | 'z0_m' | 'z_step_m'>, heights: Uint16Array) {
    this.n = m.size;
    this.res = m.resolution_m;
    this.half = ((m.size - 1) * m.resolution_m) / 2;
    this.z0 = m.z0_m;
    this.zs = m.z_step_m;
    this.h = heights;
    if (heights.length !== m.size * m.size) throw new Error(`height array size ${heights.length} != ${m.size}^2`);
  }

  private raw(c: number, r: number): number {
    const n1 = this.n - 1;
    c = c < 0 ? 0 : c > n1 ? n1 : c;
    r = r < 0 ? 0 : r > n1 ? n1 : r;
    return this.h[r * this.n + c];
  }

  /** Height (m AMSL) at a texel centre. */
  heightTexel(c: number, r: number): number {
    return this.z0 + this.raw(c, r) * this.zs;
  }

  /** Bicubic (Catmull-Rom) interpolated height; exact at texel centres. */
  heightAt(x: number, z: number): number {
    const gx = (x + this.half) / this.res;
    const gz = (z + this.half) / this.res;
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const tx = gx - ix;
    const tz = gz - iz;
    const wx0 = ((-tx + 2) * tx - 1) * tx * 0.5;
    const wx1 = ((3 * tx - 5) * tx * tx + 2) * 0.5;
    const wx2 = ((-3 * tx + 4) * tx + 1) * tx * 0.5;
    const wx3 = (tx - 1) * tx * tx * 0.5;
    const wz0 = ((-tz + 2) * tz - 1) * tz * 0.5;
    const wz1 = ((3 * tz - 5) * tz * tz + 2) * 0.5;
    const wz2 = ((-3 * tz + 4) * tz + 1) * tz * 0.5;
    const wz3 = (tz - 1) * tz * tz * 0.5;
    let sum = 0;
    for (let j = 0; j < 4; j++) {
      const r = iz - 1 + j;
      const row = wx0 * this.raw(ix - 1, r) + wx1 * this.raw(ix, r) + wx2 * this.raw(ix + 1, r) + wx3 * this.raw(ix + 2, r);
      sum += row * (j === 0 ? wz0 : j === 1 ? wz1 : j === 2 ? wz2 : wz3);
    }
    return this.z0 + sum * this.zs;
  }

  /** Unit surface normal by central differences of the bicubic surface. */
  normalAt(x: number, z: number, out: { x: number; y: number; z: number }, eps = 0.5): { x: number; y: number; z: number } {
    const dx = (this.heightAt(x + eps, z) - this.heightAt(x - eps, z)) / (2 * eps);
    const dz = (this.heightAt(x, z + eps) - this.heightAt(x, z - eps)) / (2 * eps);
    const inv = 1 / Math.sqrt(dx * dx + dz * dz + 1);
    out.x = -dx * inv;
    out.y = inv;
    out.z = -dz * inv;
    return out;
  }

  slopeDegAt(x: number, z: number): number {
    const dx = (this.heightAt(x + 2.5, z) - this.heightAt(x - 2.5, z)) / 5;
    const dz = (this.heightAt(x, z + 2.5) - this.heightAt(x, z - 2.5)) / 5;
    return (Math.atan(Math.sqrt(dx * dx + dz * dz)) * 180) / Math.PI;
  }

  /** Bilinear mask lookup, 0..1. Channel: MASK_LOOSE / MASK_CREST / MASK_SLIP. Returns `fallback` if masks are not loaded. */
  maskAt(x: number, z: number, ch: number, fallback = 0.7): number {
    const m = this.masks;
    if (!m) return fallback;
    const mn = this.masksN;
    const ext = this.n * this.res;
    let u = ((x + this.half + this.res * 0.5) / ext) * mn - 0.5;
    let v = ((z + this.half + this.res * 0.5) / ext) * mn - 0.5;
    u = u < 0 ? 0 : u > mn - 1.001 ? mn - 1.001 : u;
    v = v < 0 ? 0 : v > mn - 1.001 ? mn - 1.001 : v;
    const iu = Math.floor(u);
    const iv = Math.floor(v);
    const fu = u - iu;
    const fv = v - iv;
    const i = (iv * mn + iu) * 4 + ch;
    const a = m[i];
    const b = m[i + 4];
    const c = m[i + mn * 4];
    const d = m[i + mn * 4 + 4];
    return (a * (1 - fu) * (1 - fv) + b * fu * (1 - fv) + c * (1 - fu) * fv + d * fu * fv) / 255;
  }

  looseAt(x: number, z: number): number {
    const l = this.maskAt(x, z, MASK_LOOSE);
    return this.looseOverride ? this.looseOverride(x, z, l) : l;
  }

  /** Build the min/max pyramid used for frustum culling of terrain nodes. */
  buildPyramid(): void {
    const D = TerrainData.PYR_DIM;
    const per = TerrainData.BLOCK / this.res; // texels per block
    const off = (TerrainData.PYR_HALF - this.half) / this.res; // texel offset of the pyramid origin
    const mn = new Float32Array(D * D);
    const mx = new Float32Array(D * D);
    const n1 = this.n - 1;
    for (let bz = 0; bz < D; bz++) {
      const r0 = Math.max(0, Math.min(n1, bz * per - off - 2));
      const r1 = Math.max(0, Math.min(n1, (bz + 1) * per - off + 2));
      for (let bx = 0; bx < D; bx++) {
        const c0 = Math.max(0, Math.min(n1, bx * per - off - 2));
        const c1 = Math.max(0, Math.min(n1, (bx + 1) * per - off + 2));
        let lo = 65535;
        let hi = 0;
        for (let r = r0; r <= r1; r += 2) {
          const base = r * this.n;
          for (let c = c0; c <= c1; c += 2) {
            const v = this.h[base + c];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        }
        mn[bz * D + bx] = this.z0 + lo * this.zs - 1.5;
        mx[bz * D + bx] = this.z0 + hi * this.zs + 1.5;
      }
    }
    this.pyrMin = [mn];
    this.pyrMax = [mx];
    for (let d = D >> 1; d >= 1; d >>= 1) {
      const pm = this.pyrMin[this.pyrMin.length - 1];
      const px = this.pyrMax[this.pyrMax.length - 1];
      const a = new Float32Array(d * d);
      const b = new Float32Array(d * d);
      const D2 = d * 2;
      for (let z = 0; z < d; z++)
        for (let x = 0; x < d; x++) {
          const i = z * 2 * D2 + x * 2;
          a[z * d + x] = Math.min(pm[i], pm[i + 1], pm[i + D2], pm[i + D2 + 1]);
          b[z * d + x] = Math.max(px[i], px[i + 1], px[i + D2], px[i + D2 + 1]);
        }
      this.pyrMin.push(a);
      this.pyrMax.push(b);
    }
  }

  /** Conservative [min,max] height for a square node (origin x0,z0, size s = BLOCK * 2^k, any integer k). */
  nodeMinMax(x0: number, z0: number, s: number, out: [number, number]): void {
    if (!this.pyrMin.length) {
      out[0] = this.z0;
      out[1] = this.z0 + 65535 * this.zs;
      return;
    }
    let lvl = Math.round(Math.log2(s / TerrainData.BLOCK));
    if (lvl < 0) lvl = 0;
    if (lvl > this.pyrMin.length - 1) lvl = this.pyrMin.length - 1;
    const d = TerrainData.PYR_DIM >> lvl;
    const bs = TerrainData.BLOCK * (1 << lvl);
    let bx = Math.floor((x0 + s * 0.5 + TerrainData.PYR_HALF) / bs);
    let bz = Math.floor((z0 + s * 0.5 + TerrainData.PYR_HALF) / bs);
    bx = bx < 0 ? 0 : bx > d - 1 ? d - 1 : bx;
    bz = bz < 0 ? 0 : bz > d - 1 ? d - 1 : bz;
    out[0] = this.pyrMin[lvl][bz * d + bx];
    out[1] = this.pyrMax[lvl][bz * d + bx];
  }
}

/** Simple analytic ground for tests: a plane with a constant grade and sand type. */
export class PlaneGround implements Ground {
  constructor(public slopeX = 0, public slopeZ = 0, public loose = 0, public y0 = 0) {}
  heightAt(x: number, z: number): number {
    return this.y0 + x * this.slopeX + z * this.slopeZ;
  }
  normalAt(_x: number, _z: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    const inv = 1 / Math.sqrt(this.slopeX * this.slopeX + this.slopeZ * this.slopeZ + 1);
    out.x = -this.slopeX * inv;
    out.y = inv;
    out.z = -this.slopeZ * inv;
    return out;
  }
  looseAt(): number {
    return this.loose;
  }
}
