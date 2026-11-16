// Procedural engine synthesiser (pure TS, no DOM): runs inside the AudioWorklet and in Vitest.
// Model: the crank angle advances with rpm; each cylinder fires at its slot in the firing order and launches a smooth
// exhaust pressure pulse into its bank's exhaust (a few resonators = pipe formants). Banks are panned slightly, so a
// cross-plane V8's uneven per-bank firing gives the burble while an I6 stays smooth. On top: diesel knock, mechanical
// noise, intake roar, turbo whine/hiss, blow-off flutter, limiter-cut pops and overrun crackle.
// Every control is smoothed per sample (no zipper noise or clicks); pulses are raised-cosine (no steps).

export interface EngineCfg {
  cylinders: number;
  firingOrder: number[];
  bankOf: number[];
  bankFormants: number[][];
  bankPan: number[];
  pulseWidthMs: number;
  cylVar: number;
  jitter: number;
  knock: number;
  mech: number;
  crackle: number;
  limiterPops: number;
  intake: number;
  gain: number;
}
export interface TurboCfg {
  whineHzMin: number; whineHzMax: number; whineGain: number; hissGain: number; flutterHz: number; flutterGain: number; flutterTime: number;
}
export interface EngineParams {
  rpm: number;
  load: number; // 0..1 torque fraction
  throttle: number;
  boost: number; // 0..1
  cut: boolean; // rev limiter fuel cut active
  turbo: boolean;
  flutter: number; // blow-off valve strength 0..1
  pitch: number; // Doppler factor (1 = none)
  gain: number;
  redline: number;
  active: boolean;
  /** per-layer gains for the audition panel */
  layers: { pulses: number; intake: number; turbo: number; mech: number; pops: number };
}

class Biquad {
  b0 = 0; b1 = 0; b2 = 0; a1 = 0; a2 = 0; z1 = 0; z2 = 0;
  /** RBJ band-pass, 0 dB peak gain */
  bp(f: number, q: number, sr: number): this {
    const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
    const al = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + al;
    this.b0 = al / a0; this.b1 = 0; this.b2 = -al / a0; this.a1 = (-2 * c) / a0; this.a2 = (1 - al) / a0;
    return this;
  }
  hp(f: number, q: number, sr: number): this {
    const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
    const al = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + al;
    this.b0 = (1 + c) / 2 / a0; this.b1 = -(1 + c) / a0; this.b2 = (1 + c) / 2 / a0; this.a1 = (-2 * c) / a0; this.a2 = (1 - al) / a0;
    return this;
  }
  run(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

export type EngineParamsIn = Partial<Omit<EngineParams, 'layers'>> & { layers?: Partial<EngineParams['layers']> };

interface Burst { env: number; decay: number; amp: number; }

export class EngineDsp {
  readonly p: EngineParams;
  /** total firings (tests) and an optional log of [sampleIndex, bank] */
  firings = 0;
  log: number[][] | null = null;
  private sr: number;
  private seed: number;
  private slotPos = 0; // fraction of the way to the next firing slot
  private next = 0; // next firing slot index
  private cylAmp: number[];
  private bankPulse: { p: number; amp: number; inc: number }[];
  private bankRes: Biquad[][];
  private bankLp: number[];
  private knockEnv = 0;
  private knockHp = new Biquad();
  private mechBp = new Biquad();
  private intakeBp = new Biquad();
  private hissHp = new Biquad();
  private popBp = new Biquad();
  private crackBp = new Biquad();
  private flutBp = new Biquad();
  private pop: Burst = { env: 0, decay: 0, amp: 0 };
  private crack: Burst = { env: 0, decay: 0, amp: 0 };
  private flutterT = 0;
  private flutterPh = 0;
  private whinePh = 0;
  private wasCut = false;
  private thrHist = 0; // slow throttle follower for blow-off detection
  private rpmS: number;
  private loadS = 0;
  private thrS = 0;
  private boostS = 0;
  private gainS = 0;
  private pitchS = 1;
  private rpmPrev = 0;
  private rpmRate = 0;
  private dcL = { x: 0, y: 0 };
  private dcR = { x: 0, y: 0 };
  private nSamples = 0;

  constructor(readonly cfg: EngineCfg, readonly turbo: TurboCfg, sampleRate: number, seed = 12345) {
    this.sr = sampleRate;
    this.seed = seed >>> 0 || 1;
    this.p = {
      rpm: 800, load: 0, throttle: 0, boost: 0, cut: false, turbo: false, flutter: 0, pitch: 1, gain: 1, redline: 5500, active: true,
      layers: { pulses: 1, intake: 1, turbo: 1, mech: 1, pops: 1 },
    };
    this.rpmS = 800;
    this.cylAmp = cfg.firingOrder.map(() => 1 + (this.rnd() * 2 - 1) * cfg.cylVar);
    this.bankPulse = [0, 1].map(() => ({ p: 1, amp: 0, inc: 0 }));
    this.bankRes = cfg.bankFormants.map(() => [new Biquad(), new Biquad(), new Biquad()]);
    this.bankLp = [0, 0];
    this.knockHp.hp(2500, 0.7, this.sr);
    this.popBp.bp(650, 0.9, this.sr);
    this.crackBp.bp(1900, 1.1, this.sr);
    this.flutBp.bp(1100, 1.4, this.sr);
    this.hissHp.hp(5000, 0.7, this.sr);
  }

  set(p: EngineParamsIn): void {
    if (p.layers) Object.assign(this.p.layers, p.layers);
    const { layers, ...rest } = p;
    void layers;
    Object.assign(this.p, rest);
  }

  private rnd(): number {
    // xorshift32
    let x = this.seed;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 4294967296;
  }

  private updateFilters(): void {
    const ps = this.pitchS;
    const bright = 0.85 + 0.3 * this.loadS;
    for (let b = 0; b < this.bankRes.length; b++) {
      const f = this.cfg.bankFormants[b];
      this.bankRes[b][0].bp(f[0] * ps, 1.6, this.sr);
      this.bankRes[b][1].bp(f[1] * ps * bright, 2.2, this.sr);
      this.bankRes[b][2].bp(f[2] * ps * bright, 2.8, this.sr);
    }
    this.mechBp.bp(2600 * ps, 1.2, this.sr);
    this.intakeBp.bp((180 + this.rpmS * 0.12) * ps, 1.2, this.sr);
  }

  private fire(slot: number, sampleIdx: number): void {
    const cfg = this.cfg;
    const cyl = cfg.firingOrder[slot];
    const bank = cfg.bankOf[cyl - 1];
    this.firings++;
    this.log?.push([sampleIdx, bank]);
    const p = this.p;
    if (p.cut) {
      // fuel cut: no combustion; sometimes unburnt fuel lights in the hot exhaust
      if (this.rnd() < 0.07 * cfg.limiterPops * p.layers.pops) this.trigPop(0.7 + 0.3 * this.rnd());
      return;
    }
    const rpmF = Math.min(1.2, this.rpmS / p.redline);
    let amp = (0.22 + 0.78 * this.loadS) * (0.55 + 0.45 * rpmF) * this.cylAmp[slot] * (1 + (this.rnd() * 2 - 1) * cfg.jitter);
    if (this.thrS < 0.04) amp *= 0.55; // overrun: weak, partly misfiring pulses
    const bp = this.bankPulse[bank];
    // pulse width: config width, but never longer than 60 % of the per-bank spacing
    const spacing = 120 / Math.max(200, this.rpmS * this.pitchS) / cfg.cylinders; // s between firings
    const w = Math.max(0.0006, Math.min(cfg.pulseWidthMs / 1000, spacing * 1.2));
    bp.p = 0;
    bp.amp = amp;
    bp.inc = 1 / (w * this.sr);
    this.knockEnv = Math.max(this.knockEnv, cfg.knock * amp * (0.4 + 0.6 * this.loadS));
    // overrun crackle (petrol, lifting off at high rpm while rpm is falling)
    if (this.thrS < 0.05 && this.rpmS > 2200 && this.rpmRate < -60) {
      const ch = cfg.crackle * 0.07 * Math.min(1, (this.rpmS - 2200) / 2500) * p.layers.pops;
      if (this.rnd() < ch) {
        this.crack.env = 1;
        this.crack.amp = 0.25 + 0.6 * this.rnd();
        this.crack.decay = Math.exp(-1 / ((0.002 + this.rnd() * 0.006) * this.sr));
      }
    }
  }

  private trigPop(a: number): void {
    this.pop.env = 1;
    this.pop.amp = a;
    this.pop.decay = Math.exp(-1 / ((0.012 + this.rnd() * 0.02) * this.sr));
  }

  /** Writes n samples to L/R (overwrites). */
  process(L: Float32Array, R: Float32Array, n: number): void {
    const p = this.p;
    if (!p.active && this.gainS < 1e-4) {
      L.fill(0, 0, n);
      if (R !== L) R.fill(0, 0, n);
      return;
    }
    const sr = this.sr;
    const k = 1 - Math.exp(-1 / (0.03 * sr)); // 30 ms smoothing
    const kG = 1 - Math.exp(-1 / (0.02 * sr));
    const cfg = this.cfg, t = this.turbo, lay = p.layers;
    const nb = this.bankRes.length;
    const panL = cfg.bankPan.map((x) => Math.cos(((x + 1) * Math.PI) / 4));
    const panR = cfg.bankPan.map((x) => Math.sin(((x + 1) * Math.PI) / 4));
    // block-rate: filters, cut edge, blow-off detection
    this.updateFilters();
    if (this.wasCut && !p.cut && this.rnd() < 0.6 * cfg.limiterPops * lay.pops) this.trigPop(0.8 + 0.4 * this.rnd());
    this.wasCut = p.cut;
    const dtBlock = n / sr;
    if (p.turbo && p.flutter > 0 && this.thrHist > 0.55 && p.throttle < 0.2 && this.boostS > 0.4 && this.flutterT <= 0) this.flutterT = t.flutterTime;
    this.thrHist += (p.throttle - this.thrHist) * Math.min(1, dtBlock / 0.25);
    this.rpmRate = (this.rpmS - this.rpmPrev) / dtBlock;
    this.rpmPrev = this.rpmS;
    const g0 = cfg.gain * 0.5;
    const ncyl = cfg.firingOrder.length;
    for (let i = 0; i < n; i++) {
      this.rpmS += (p.rpm - this.rpmS) * k;
      this.loadS += (p.load - this.loadS) * k;
      this.thrS += (p.throttle - this.thrS) * k;
      this.boostS += ((p.turbo ? p.boost : 0) - this.boostS) * k;
      this.pitchS += (p.pitch - this.pitchS) * k;
      this.gainS += ((p.active ? p.gain : 0) - this.gainS) * kG;
      // crank: one engine cycle = 2 revolutions; slots are evenly spaced in crank angle (firing order picks the cylinder)
      this.slotPos += ((Math.max(0, this.rpmS) * this.pitchS) / 120 / sr) * ncyl;
      while (this.slotPos >= 1) {
        this.slotPos -= 1;
        this.fire(this.next, this.nSamples + i);
        this.next = (this.next + 1) % ncyl;
      }
      let l = 0, r = 0;
      for (let b = 0; b < nb; b++) {
        const bp = this.bankPulse[b];
        let e = 0;
        if (bp.p < 1) {
          e = bp.amp * 0.5 * (1 - Math.cos(2 * Math.PI * bp.p));
          bp.p += bp.inc;
        }
        this.bankLp[b] += (e - this.bankLp[b]) * 0.25;
        const rs = this.bankRes[b];
        const y = (this.bankLp[b] * 0.9 + rs[0].run(e) * 1.4 + rs[1].run(e) * 0.7 + rs[2].run(e) * 0.3 * (0.5 + this.loadS)) * lay.pulses;
        l += y * panL[b];
        r += y * panR[b];
      }
      // diesel knock / combustion clatter
      let c = 0;
      if (this.knockEnv > 1e-4) {
        c += this.knockHp.run((this.rnd() * 2 - 1) * this.knockEnv) * 0.5 * lay.pulses;
        this.knockEnv *= 0.985;
      }
      const rpmF = Math.min(1.3, this.rpmS / p.redline);
      // mechanical whirr
      c += this.mechBp.run(this.rnd() * 2 - 1) * cfg.mech * (0.3 + rpmF) * lay.mech;
      // intake roar
      c += this.intakeBp.run(this.rnd() * 2 - 1) * cfg.intake * this.thrS * Math.pow(rpmF, 1.3) * 1.6 * lay.intake;
      // turbo whine + hiss + blow-off flutter
      if (p.turbo) {
        const fw = (t.whineHzMin + (t.whineHzMax - t.whineHzMin) * this.boostS) * this.pitchS;
        this.whinePh += fw / sr;
        if (this.whinePh > 1) this.whinePh -= 1;
        c += Math.sin(2 * Math.PI * this.whinePh) * t.whineGain * this.boostS * this.boostS * lay.turbo;
        c += this.hissHp.run(this.rnd() * 2 - 1) * t.hissGain * this.boostS * this.thrS * lay.turbo;
        if (this.flutterT > 0) {
          this.flutterPh += t.flutterHz / sr;
          if (this.flutterPh > 1) this.flutterPh -= 1;
          const env = this.flutterT / t.flutterTime;
          const m = Math.pow(Math.abs(Math.sin(Math.PI * this.flutterPh)), 3);
          c += this.flutBp.run(this.rnd() * 2 - 1) * t.flutterGain * p.flutter * env * m * 3 * lay.turbo;
          this.flutterT -= 1 / sr;
        }
      }
      // pops and crackle
      if (this.pop.env > 1e-4) {
        const x = this.popBp.run((this.rnd() * 2 - 1) * this.pop.env * this.pop.amp) * 2.2;
        c += x;
        l += x * 0.3; // a pop shakes the whole exhaust
        r += x * 0.3;
        this.pop.env *= this.pop.decay;
      }
      if (this.crack.env > 1e-4) {
        c += this.crackBp.run((this.rnd() * 2 - 1) * this.crack.env * this.crack.amp) * 1.8;
        this.crack.env *= this.crack.decay;
      }
      let oL = (l + c) * g0 * this.gainS;
      let oR = (r + c) * g0 * this.gainS;
      // DC blocker (the pulses are one-sided) + soft clip
      const yl = oL - this.dcL.x + 0.995 * this.dcL.y; this.dcL.x = oL; this.dcL.y = yl; oL = yl;
      const yr = oR - this.dcR.x + 0.995 * this.dcR.y; this.dcR.x = oR; this.dcR.y = yr; oR = yr;
      L[i] = oL / (1 + Math.abs(oL) * 0.4);
      if (R !== L) R[i] = oR / (1 + Math.abs(oR) * 0.4);
    }
    this.nSamples += n;
  }
}
