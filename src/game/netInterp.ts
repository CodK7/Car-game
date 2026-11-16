// Remote-vehicle smoothing for multiplayer (import-free, so Node test scripts can import it directly).
// Snapshots are stamped with the server's receive time. The client renders remotes `delay` seconds in the past,
// interpolating between the two snapshots around that time; when packets are late or lost it dead-reckons
// (position + velocity × gap) for at most `maxExtrapolate` seconds, then holds.

export interface NetState { t: number; p: number[]; q: number[]; v: number[]; w?: number[] }

export class Interp {
  buf: NetState[] = [];
  extrapolated = false;
  constructor(public delay = 0.15, public maxExtrapolate = 0.5) {}

  push(s: NetState): void {
    const b = this.buf;
    if (b.length && s.t <= b[b.length - 1].t) return; // out of order / duplicate
    b.push(s);
    if (b.length > 40) b.shift();
  }

  /** state at server time `now - delay` written into out (p, q, v); returns false if nothing received yet */
  sample(now: number, out: { p: number[]; q: number[]; v: number[] }): boolean {
    const b = this.buf;
    if (!b.length) return false;
    const t = now - this.delay;
    let i = b.length - 1;
    while (i > 0 && b[i - 1].t > t) i--;
    const a = b[Math.max(0, i - 1)], c = b[i];
    if (t >= c.t || a === c) {
      // past the newest snapshot: dead reckoning
      const last = b[b.length - 1];
      const dt = Math.min(Math.max(0, t - last.t), this.maxExtrapolate);
      this.extrapolated = t > last.t;
      for (let k = 0; k < 3; k++) out.p[k] = last.p[k] + last.v[k] * dt;
      for (let k = 0; k < 4; k++) out.q[k] = last.q[k];
      for (let k = 0; k < 3; k++) out.v[k] = last.v[k];
      return true;
    }
    this.extrapolated = false;
    const u = Math.min(1, Math.max(0, (t - a.t) / Math.max(1e-6, c.t - a.t)));
    // cubic Hermite on position (uses the velocities: smooth through turns), nlerp on rotation
    const h = c.t - a.t;
    const u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    for (let k = 0; k < 3; k++) {
      out.p[k] = h00 * a.p[k] + h10 * h * a.v[k] + h01 * c.p[k] + h11 * h * c.v[k];
      out.v[k] = a.v[k] + (c.v[k] - a.v[k]) * u;
    }
    const dot = a.q[0] * c.q[0] + a.q[1] * c.q[1] + a.q[2] * c.q[2] + a.q[3] * c.q[3];
    const sgn = dot < 0 ? -1 : 1;
    let n = 0;
    for (let k = 0; k < 4; k++) {
      out.q[k] = a.q[k] * (1 - u) + c.q[k] * sgn * u;
      n += out.q[k] * out.q[k];
    }
    n = Math.sqrt(n) || 1;
    for (let k = 0; k < 4; k++) out.q[k] /= n;
    return true;
  }
}

/** Server-clock estimate: offset = server time - local time, smoothed, biased to the fastest (least delayed) packets. */
export class ServerClock {
  offset = NaN;
  observe(serverTime: number, localTime: number): void {
    const o = serverTime - localTime;
    if (!Number.isFinite(this.offset)) this.offset = o;
    else if (o > this.offset) this.offset += (o - this.offset) * 0.5; // a faster packet: move quickly
    else this.offset += (o - this.offset) * 0.02; // slower packets drift it back slowly (clock drift)
  }
  now(localTime: number): number {
    return localTime + (Number.isFinite(this.offset) ? this.offset : 0);
  }
}
