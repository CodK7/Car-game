// Recovery rope physics (pure TS, no DOM): an elastic spring-damper that only pulls (never pushes), breaks when the
// tension exceeds its minimum breaking strength, and optionally reels in like a winch.
// - Stiffness from catalogue data: EA = MBS / elongation-at-MBS, k = EA / current length (a longer line is softer).
// - Damping is mass-aware: c = 2 ζ sqrt(k m_eff), m_eff = m1 m2 / (m1 + m2) (m2 = ∞ for a fixed anchor), so the same
//   rope behaves alike between two cars and between a car and a tree.
// - A kinetic strap is the same model with ~20 % elongation and little damping: the energy of a moving recovery car is
//   stored as ½ k x² and returned as a long, smooth pull (the "snatch").
// - Winch: the rest length shrinks at a line speed that falls linearly with load and is zero at stall pull.
import cfg from '../config/recovery.json';
import { effectiveMass, ropeTension } from './ropeCore';

export interface RopeSpec { label?: string; length: number; mbsN: number; elongAtMbs: number; dampingRatio: number }
export interface WinchSpec { lineSpeedNoLoad: number; stallPullN: number; payoutSpeed: number }
export type RopeKind = keyof typeof cfg.ropes;

export interface Vec { x: number; y: number; z: number }

export class Rope {
  restLength: number;
  tension = 0;
  peakTension = 0;
  broken = false;
  /** strain energy currently stored (J) */
  energy = 0;
  /** winch command: +1 reel in, -1 pay out, 0 hold; only used when `winch` is set */
  winchCmd = 0;
  winchSpeed = 0;
  readonly EA: number;

  constructor(readonly spec: RopeSpec, readonly winch: WinchSpec | null = null, length = spec.length) {
    this.restLength = length;
    this.EA = spec.mbsN / spec.elongAtMbs;
  }

  static of(kind: RopeKind, length?: number): Rope {
    return new Rope(cfg.ropes[kind], kind === 'winch' ? cfg.winch : null, length);
  }

  get k(): number {
    return this.EA / Math.max(0.5, this.restLength);
  }

  /** tension as a fraction of the breaking strength (HUD) */
  get load(): number {
    return this.tension / this.spec.mbsN;
  }

  /**
   * Advance by dt and return the tension (N). The pull on A is +T along (B - A), on B the opposite.
   * mA / mB in kg (Infinity for a fixed anchor).
   */
  update(dt: number, a: Vec, va: Vec, b: Vec, vb: Vec, mA: number, mB: number): number {
    if (this.broken) {
      this.tension = 0;
      return 0;
    }
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const dist = Math.hypot(dx, dy, dz) || 1e-6;
    const ux = dx / dist, uy = dy / dist, uz = dz / dist;
    // winch: line speed falls with load, stalls at stall pull
    if (this.winch) {
      const w = this.winch;
      if (this.winchCmd > 0) this.winchSpeed = w.lineSpeedNoLoad * Math.max(0, 1 - this.tension / w.stallPullN);
      else if (this.winchCmd < 0) this.winchSpeed = -w.payoutSpeed;
      else this.winchSpeed = 0;
      this.restLength = Math.max(1, Math.min(this.spec.length, this.restLength - this.winchSpeed * dt));
      // paying out never leaves the line tight beyond the drum: rest length follows the distance when slack
      if (this.winchCmd < 0) this.restLength = Math.min(this.spec.length, Math.max(this.restLength, dist - 0.05));
    }
    const ext = dist - this.restLength;
    if (ext <= 0) {
      this.tension = 0;
      this.energy = 0;
      return 0;
    }
    const rate = (vb.x - va.x) * ux + (vb.y - va.y) * uy + (vb.z - va.z) * uz; // extension speed
    const k = this.k;
    this.tension = ropeTension(dist, rate, this.restLength, this.EA, this.spec.dampingRatio, effectiveMass(mA, mB));
    this.energy = 0.5 * k * ext * ext;
    this.peakTension = Math.max(this.peakTension, this.tension);
    if (this.tension > this.spec.mbsN) {
      this.broken = true;
      this.tension = 0;
    }
    return this.tension;
  }
}
