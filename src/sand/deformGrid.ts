// CPU-authoritative sand deformation grid (pure TypeScript, no DOM/WebGL).
// A square window of n×n texels (cell = size/n metres) that follows the vehicle. Storage is toroidal: world texel
// (ix, iz) lives in slot (ix mod n, iz mod n), so moving the window only clears the strips that scroll in.
// h = height delta (m, negative = groove), d = "disturbed" 0..1 (colour/normal blend for tracks).
// The physics samples it directly (ruts, dug holes), the renderer uploads dirty rectangles to a texture.
import cfg from '../config/sand.json';

export type DeformParams = typeof cfg.deform;

export interface Rect {
  x0: number;
  z0: number;
  x1: number; // exclusive, world texel indices
  z1: number;
}

export class DeformGrid {
  readonly n: number;
  readonly cell: number;
  readonly h: Float32Array;
  readonly d: Float32Array;
  /** world texel index of the window's min corner */
  ix0 = 0;
  iz0 = 0;
  /** dirty rectangles in world texel indices since the last takeDirty() */
  private dirty: Rect[] = [];
  private relaxAcc = 0;
  private fillRow = 0;
  private tmp: Float32Array;
  p: DeformParams;

  constructor(n: number, readonly size: number, p: DeformParams = cfg.deform) {
    this.n = n;
    this.cell = size / n;
    this.h = new Float32Array(n * n);
    this.d = new Float32Array(n * n);
    this.tmp = new Float32Array(0);
    this.p = { ...p };
  }

  get centreX(): number {
    return (this.ix0 + this.n / 2) * this.cell;
  }
  get centreZ(): number {
    return (this.iz0 + this.n / 2) * this.cell;
  }

  private slot(ix: number, iz: number): number {
    const n = this.n;
    return (((iz % n) + n) % n) * n + (((ix % n) + n) % n);
  }

  inWindow(ix: number, iz: number): boolean {
    return ix >= this.ix0 && iz >= this.iz0 && ix < this.ix0 + this.n && iz < this.iz0 + this.n;
  }

  /** Move the window so (x, z) is near its centre. Returns true if it moved. Clears strips that scroll in. */
  follow(x: number, z: number, force = false): boolean {
    const n = this.n;
    const tx = Math.round(x / this.cell) - n / 2;
    const tz = Math.round(z / this.cell) - n / 2;
    const lim = n * this.p.recentreFrac;
    if (!force && Math.abs(tx - this.ix0) < lim && Math.abs(tz - this.iz0) < lim) return false;
    const dx = tx - this.ix0;
    const dz = tz - this.iz0;
    if (Math.abs(dx) >= n || Math.abs(dz) >= n || force) {
      this.h.fill(0);
      this.d.fill(0);
      this.ix0 = tx;
      this.iz0 = tz;
      this.dirty.length = 0;
      this.dirty.push({ x0: tx, z0: tz, x1: tx + n, z1: tz + n });
      return true;
    }
    // columns entering the window (new world columns reuse the slots of the leaving ones)
    const clearCols = (a: number, b: number) => {
      for (let ix = a; ix < b; ix++) {
        const sx = ((ix % n) + n) % n;
        for (let s = sx; s < n * n; s += n) {
          this.h[s] = 0;
          this.d[s] = 0;
        }
      }
    };
    const clearRows = (a: number, b: number) => {
      for (let iz = a; iz < b; iz++) {
        const r = (((iz % n) + n) % n) * n;
        this.h.fill(0, r, r + n);
        this.d.fill(0, r, r + n);
      }
    };
    const nx0 = tx, nz0 = tz;
    if (dx > 0) clearCols(this.ix0 + n, nx0 + n);
    else if (dx < 0) clearCols(nx0, this.ix0);
    if (dz > 0) clearRows(this.iz0 + n, nz0 + n);
    else if (dz < 0) clearRows(nz0, this.iz0);
    this.ix0 = nx0;
    this.iz0 = nz0;
    // whole window re-uploaded lazily via strips: mark the entered strips dirty
    if (dx > 0) this.dirty.push({ x0: nx0 + n - dx, z0: nz0, x1: nx0 + n, z1: nz0 + n });
    if (dx < 0) this.dirty.push({ x0: nx0, z0: nz0, x1: nx0 - dx, z1: nz0 + n });
    if (dz > 0) this.dirty.push({ x0: nx0, z0: nz0 + n - dz, x1: nx0 + n, z1: nz0 + n });
    if (dz < 0) this.dirty.push({ x0: nx0, z0: nz0, x1: nx0 + n, z1: nz0 - dz });
    return true;
  }

  /** Bilinear height delta at world (x, z); 0 outside the window. */
  heightAt(x: number, z: number): number {
    const gx = x / this.cell - 0.5;
    const gz = z / this.cell - 0.5;
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    if (ix < this.ix0 || iz < this.iz0 || ix + 1 >= this.ix0 + this.n || iz + 1 >= this.iz0 + this.n) return 0;
    const fx = gx - ix;
    const fz = gz - iz;
    const h = this.h;
    const a = h[this.slot(ix, iz)], b = h[this.slot(ix + 1, iz)];
    const c = h[this.slot(ix, iz + 1)], e = h[this.slot(ix + 1, iz + 1)];
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + e * fx) * fz;
  }

  /** Height gradient (dh/dx, dh/dz) at world (x, z). */
  gradAt(x: number, z: number, out: [number, number]): [number, number] {
    const e = this.cell;
    out[0] = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    out[1] = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return out;
  }

  private mark(x0: number, z0: number, x1: number, z1: number): void {
    x0 = Math.max(x0, this.ix0);
    z0 = Math.max(z0, this.iz0);
    x1 = Math.min(x1, this.ix0 + this.n);
    z1 = Math.min(z1, this.iz0 + this.n);
    if (x1 <= x0 || z1 <= z0) return;
    // merge with the last rect when they overlap a lot (wheel stamps are local)
    const l = this.dirty[this.dirty.length - 1];
    if (l) {
      const ux0 = Math.min(l.x0, x0), uz0 = Math.min(l.z0, z0), ux1 = Math.max(l.x1, x1), uz1 = Math.max(l.z1, z1);
      const ua = (ux1 - ux0) * (uz1 - uz0);
      if (ua <= (l.x1 - l.x0) * (l.z1 - l.z0) + (x1 - x0) * (z1 - z0) + 4096) {
        l.x0 = ux0; l.z0 = uz0; l.x1 = ux1; l.z1 = uz1;
        return;
      }
    }
    this.dirty.push({ x0, z0, x1, z1 });
  }

  /**
   * Tyre groove along segment a→b (world metres): carve to `depth` across `width` (flat-bottomed tyre profile),
   * push a berm of displaced sand to both sides. Idempotent per position (min/max), so it is frame-rate independent.
   */
  stampGroove(ax: number, az: number, bx: number, bz: number, width: number, depth: number, loose = 1): void {
    if (depth <= 1e-4) return;
    const c = this.cell;
    const hw = width * 0.5;
    const bw = Math.max(width * this.p.bermWidthOfTyre, c * 1.5);
    const berm = depth * this.p.bermRatio * (0.4 + 0.6 * loose);
    const R = hw + bw;
    const x0 = Math.floor((Math.min(ax, bx) - R) / c), x1 = Math.ceil((Math.max(ax, bx) + R) / c) + 1;
    const z0 = Math.floor((Math.min(az, bz) - R) / c), z1 = Math.ceil((Math.max(az, bz) + R) / c) + 1;
    const sx = bx - ax, sz = bz - az;
    const L2 = sx * sx + sz * sz;
    const h = this.h, d = this.d;
    for (let iz = Math.max(z0, this.iz0); iz < Math.min(z1, this.iz0 + this.n); iz++) {
      const pz = (iz + 0.5) * c;
      for (let ix = Math.max(x0, this.ix0); ix < Math.min(x1, this.ix0 + this.n); ix++) {
        const px = (ix + 0.5) * c;
        let t = L2 > 0 ? ((px - ax) * sx + (pz - az) * sz) / L2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = ax + sx * t - px, qz = az + sz * t - pz;
        const dist = Math.sqrt(qx * qx + qz * qz);
        if (dist >= R) continue;
        const s = this.slot(ix, iz);
        if (dist < hw) {
          const u = dist / hw;
          const prof = -depth * (1 - u * u * u * u);
          if (prof < h[s]) h[s] = prof;
          if (d[s] < 1) d[s] = 1;
        } else {
          const u = (dist - hw) / bw;
          const b = berm * Math.sin(Math.PI * Math.min(u * 1.15, 1));
          if (b > h[s] && h[s] > -0.02) h[s] = b;
          const dd = 0.7 * (1 - u);
          if (dd > d[s]) d[s] = dd;
        }
      }
    }
    this.mark(x0, z0, x1, z1);
  }

  /** Remove `amount` m of sand in a disc (wheel spin / shovel) and pile it in a ring around. */
  dig(x: number, z: number, radius: number, amount: number): void {
    const c = this.cell;
    const R = radius * 1.8;
    const x0 = Math.floor((x - R) / c), x1 = Math.ceil((x + R) / c) + 1;
    const z0 = Math.floor((z - R) / c), z1 = Math.ceil((z + R) / c) + 1;
    const h = this.h, d = this.d;
    for (let iz = Math.max(z0, this.iz0); iz < Math.min(z1, this.iz0 + this.n); iz++) {
      for (let ix = Math.max(x0, this.ix0); ix < Math.min(x1, this.ix0 + this.n); ix++) {
        const r = Math.hypot((ix + 0.5) * c - x, (iz + 0.5) * c - z) / radius;
        if (r >= 1.8) continue;
        const s = this.slot(ix, iz);
        // volume removed inside r<1 ≈ volume added in the ring 1<r<1.8 (area ratio 2.24)
        const dh = r < 1 ? -amount * (1 - r * r) : amount * 0.45 * Math.sin(Math.PI * (r - 1) / 0.8);
        h[s] += dh;
        d[s] = 1;
      }
    }
    this.mark(x0, z0, x1, z1);
  }

  /** Set height delta at a point directly (tests/tools). */
  setAt(x: number, z: number, v: number): void {
    const ix = Math.floor(x / this.cell), iz = Math.floor(z / this.cell);
    if (!this.inWindow(ix, iz)) return;
    this.h[this.slot(ix, iz)] = v;
    this.mark(ix, iz, ix + 1, iz + 1);
  }

  /**
   * Relaxation: slumping of slopes steeper than the angle of repose inside a radius around (x, z), plus a slow
   * wind fill of the whole window (a few rows per tick). Runs at a fixed rate (relaxHz) from `dt`.
   */
  relax(x: number, z: number, dt: number): void {
    const p = this.p;
    this.relaxAcc += dt;
    const step = 1 / p.relaxHz;
    let ticks = 0;
    while (this.relaxAcc >= step && ticks < 3) {
      this.relaxAcc -= step;
      ticks++;
      this.slump(x, z, p.relaxRadius_m, step);
      this.windFill(step);
    }
    if (ticks === 3) this.relaxAcc = 0;
  }

  private slump(x: number, z: number, radius: number, dt: number): void {
    const c = this.cell;
    const n = this.n;
    const r = Math.ceil(radius / c);
    const cx = Math.floor(x / c), cz = Math.floor(z / c);
    const x0 = Math.max(cx - r, this.ix0 + 1), x1 = Math.min(cx + r, this.ix0 + n - 1);
    const z0 = Math.max(cz - r, this.iz0 + 1), z1 = Math.min(cz + r, this.iz0 + n - 1);
    if (x1 <= x0 || z1 <= z0) return;
    const w = x1 - x0, hgt = z1 - z0;
    if (this.tmp.length < w * hgt) this.tmp = new Float32Array(w * hgt);
    const out = this.tmp;
    const h = this.h;
    const maxDiff = Math.tan((p_repose(this.p) * Math.PI) / 180) * c;
    const k = Math.min(0.24, this.p.slumpRate * dt);
    let any = false;
    for (let iz = z0; iz < z1; iz++) {
      const row = (((iz % n) + n) % n) * n;
      const rowU = ((((iz - 1) % n) + n) % n) * n;
      const rowD = ((((iz + 1) % n) + n) % n) * n;
      for (let ix = x0; ix < x1; ix++) {
        const sx = ((ix % n) + n) % n;
        const sL = (((ix - 1) % n) + n) % n;
        const sR = (((ix + 1) % n) + n) % n;
        const hc = h[row + sx];
        let flow = 0;
        // material moves from higher to lower neighbour only for the part above the repose slope
        const nb0 = h[row + sL], nb1 = h[row + sR], nb2 = h[rowU + sx], nb3 = h[rowD + sx];
        let e = nb0 - hc;
        if (e > maxDiff) flow += e - maxDiff; else if (e < -maxDiff) flow += e + maxDiff;
        e = nb1 - hc;
        if (e > maxDiff) flow += e - maxDiff; else if (e < -maxDiff) flow += e + maxDiff;
        e = nb2 - hc;
        if (e > maxDiff) flow += e - maxDiff; else if (e < -maxDiff) flow += e + maxDiff;
        e = nb3 - hc;
        if (e > maxDiff) flow += e - maxDiff; else if (e < -maxDiff) flow += e + maxDiff;
        if (flow !== 0) any = true;
        out[(iz - z0) * w + (ix - x0)] = hc + k * flow;
      }
    }
    if (!any) return;
    for (let iz = z0; iz < z1; iz++) {
      const row = (((iz % n) + n) % n) * n;
      for (let ix = x0; ix < x1; ix++) h[row + (((ix % n) + n) % n)] = out[(iz - z0) * w + (ix - x0)];
    }
    this.mark(x0, z0, x1, z1);
  }

  private windFill(dt: number): void {
    // decay a band of rows per tick so the whole window is visited every ~4 s
    const n = this.n;
    const rows = Math.max(1, Math.ceil(n / (4 * this.p.relaxHz)));
    // each row is visited once per n/rows ticks = `period` seconds; apply that much decay at once
    const period = (n / rows) * dt;
    const fh = Math.pow(1 - Math.min(0.99, this.p.windFillPerMin), period / 60);
    const fd = Math.pow(1 - Math.min(0.99, this.p.disturbedFadePerMin), period / 60);
    const h = this.h, d = this.d;
    for (let k = 0; k < rows; k++) {
      const sr = this.fillRow++ % n;
      const r = sr * n;
      let any = false;
      for (let s = r; s < r + n; s++) {
        if (h[s] !== 0) { h[s] *= fh; any = true; }
        if (d[s] !== 0) d[s] *= fd;
      }
      if (any) {
        const iz = this.iz0 + ((((sr - this.iz0) % n) + n) % n);
        this.mark(this.ix0, iz, this.ix0 + n, iz + 1);
      }
    }
  }

  /** Volume (m³) of the height delta in the window (tests: conservation checks). */
  volume(): number {
    let s = 0;
    for (let i = 0; i < this.h.length; i++) s += this.h[i];
    return s * this.cell * this.cell;
  }

  /** Dirty rectangles since the last call (world texel indices, clipped to the window). */
  takeDirty(): Rect[] {
    const r = this.dirty;
    this.dirty = [];
    return r;
  }

  /** Map a world texel index to its storage slot coordinate (0..n-1). */
  slotCoord(i: number): number {
    return ((i % this.n) + this.n) % this.n;
  }
}

function p_repose(p: DeformParams): number {
  return p.reposeDeg;
}
