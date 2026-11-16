// Web Audio graph for the game. Everything is procedural: engine (AudioWorklet, engineDsp.ts), tyre scrub / rolling /
// spray (filtered noise), low-range and reverse gear whine (oscillator), desert wind with gusts, one-shot impacts and
// suspension bottoming (buffers synthesised at start), sparse open-air reverb (generated impulse response), and
// spatialised remote vehicles (HRTF panner + distance high-frequency damping + Doppler applied to the engine pitch,
// nearest-N voice limit). Starts only after a user gesture (autoplay policy).
import type * as THREE from 'three';
import cfg from '../config/audio.json';
import type { VehicleSim } from '../vehicle/vehicleSim';
import { P } from '../core/params';
import { tun, tunButton } from '../core/tunables';
import workletUrl from './engineWorklet.ts?worker&url';

type EngineKind = 'I6' | 'V8';
const ENG = cfg.engines as Record<EngineKind, any>;

export interface Layers {
  pulses: number; intake: number; turbo: number; mech: number; pops: number;
  scrub: number; roll: number; spray: number; whine: number; wind: number; impacts: number; reverb: number;
}
interface Remote {
  id: string;
  kind: EngineKind;
  pos: THREE.Vector3Like;
  vel: THREE.Vector3Like;
  rpm: number; load: number; throttle: number;
  node: AudioWorkletNode | null;
  panner: PannerNode | null;
  lp: BiquadFilterNode | null;
  gain: GainNode | null;
}

function noiseBuffer(ctx: BaseAudioContext, seconds: number, brown = false): AudioBuffer {
  const n = Math.round(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0);
  let s = 22222, last = 0;
  for (let i = 0; i < n; i++) {
    s = (s * 16807) % 2147483647;
    const w = (s / 2147483647) * 2 - 1;
    if (brown) {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w;
  }
  // crossfade the loop seam
  const f = Math.min(2048, n >> 2);
  for (let i = 0; i < f; i++) {
    const a = i / f;
    d[n - f + i] = d[n - f + i] * (1 - a) + d[i] * a;
  }
  return b;
}

/** Sparse open-desert impulse response: a few ground/dune reflections and a short, thin tail (no cave reverb). */
export function makeImpulse(ctx: BaseAudioContext): AudioBuffer {
  const r = cfg.reverb;
  const n = Math.round(ctx.sampleRate * r.tail);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  let s = 777;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    r.early.forEach((t, i) => {
      const k = Math.min(n - 1, Math.round((t * (1 + (c ? 0.07 : -0.05))) * ctx.sampleRate));
      d[k] += (rnd() < 0.5 ? -1 : 1) * 0.7 * Math.pow(0.72, i);
    });
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / ctx.sampleRate;
      if (rnd() < 0.08) {
        lp += ((rnd() * 2 - 1) - lp) * 0.3;
        d[i] += lp * 0.25 * Math.exp(-t / (r.tail * 0.22));
      }
    }
  }
  return b;
}

function impactBuffer(ctx: BaseAudioContext, metal: boolean): AudioBuffer {
  const sr = ctx.sampleRate, n = Math.round(sr * (metal ? 0.35 : 0.45));
  const b = ctx.createBuffer(1, n, sr);
  const d = b.getChannelData(0);
  let s = metal ? 99 : 4242, lp = 0, ph = 0, ph2 = 0, ph3 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    s = (s * 16807) % 2147483647;
    const w = (s / 2147483647) * 2 - 1;
    lp += (w - lp) * (metal ? 0.2 : 0.06);
    const f = 38 + 50 * Math.exp(-t * 18); // body thump sweeps down
    ph += f / sr;
    let y = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 9) * 0.9 + lp * Math.exp(-t * 30) * 1.2;
    if (metal) {
      ph2 += 182 / sr;
      ph3 += 437 / sr;
      y += (Math.sin(2 * Math.PI * ph2) * 0.35 + Math.sin(2 * Math.PI * ph3) * 0.2) * Math.exp(-t * 22);
    }
    const atk = Math.min(1, i / (sr * 0.002));
    d[i] = y * atk * 0.8;
  }
  return b;
}

export class AudioSystem {
  ctx: AudioContext | null = null;
  started = false;
  volume = cfg.master;
  mute = P.mute;
  layers: Layers = { pulses: 1, intake: 1, turbo: 1, mech: 1, pops: 1, scrub: 1, roll: 1, spray: 1, whine: 1, wind: 1, impacts: 1, reverb: 1 };
  audition = { on: false, rpm: 2500, load: 0.5, throttle: 0.5, boost: 0.5, speed: 10, slip: 0, loose: 0.8, psi: 20, cut: false, lowRange: false };
  /** main-thread cost of update() in ms (debug overlay) */
  updateMs = 0;
  cabin = false;
  private master!: GainNode;
  private bus!: GainNode;
  private cabinLp!: BiquadFilterNode;
  private revSend!: GainNode;
  private engine: AudioWorkletNode | null = null;
  private engineKind: EngineKind = 'I6';
  private scrub!: { g: GainNode; f: BiquadFilterNode };
  private roll!: { g: GainNode; f: BiquadFilterNode };
  private spray!: { g: GainNode; f: BiquadFilterNode };
  private wind!: { g: GainNode; f: BiquadFilterNode };
  private whine!: { g: GainNode; o: OscillatorNode };
  private bufImpact!: AudioBuffer;
  private bufBottom!: AudioBuffer;
  private shots: { src: AudioBufferSourceNode; end: number }[] = [];
  private remotes = new Map<string, Remote>();
  private prevBody = 0;
  private prevS: number[] = [];
  private t = 0;
  private vehKey = '';
  private windSrc: AudioBufferSourceNode | null = null;
  private lastSrc: AudioBufferSourceNode | null = null;
  private warned = false;
  private flutterAmt = 0;
  private driveBy: { t: number } | null = null;
  private listenerPos = { x: 0, y: 0, z: 0 };
  private listenerVel = { x: 0, y: 0, z: 0 };

  constructor() {
    tun('Audio', this, 'volume', 0, 1, 0.01);
    tun('Audio', this, 'mute');
    for (const k of Object.keys(this.layers)) tun('Audio layers', this.layers, k, 0, 1, 0.05);
    for (const [k, v] of Object.entries(this.audition)) {
      const range: Record<string, [number, number, number]> = {
        rpm: [600, 6000, 10], load: [0, 1, 0.01], throttle: [0, 1, 0.01], boost: [0, 1, 0.01], speed: [0, 50, 0.1], slip: [0, 12, 0.1], loose: [0, 1, 0.01], psi: [8, 40, 1],
      };
      if (typeof v === 'boolean') tun('Audio audition', this.audition, k);
      else tun('Audio audition', this.audition, k, ...range[k]);
    }
    tunButton('Audio audition', 'impact (belly)', () => this.oneShot(this.bufImpact, 0.9));
    tunButton('Audio audition', 'suspension bottom-out', () => this.oneShot(this.bufBottom, 0.8));
    tunButton('Audio audition', 'blow-off flutter (lift)', () => this.liftTest());
    tunButton('Audio audition', 'drive-by (V8, 90 km/h, Doppler + HRTF)', () => (this.driveBy = { t: 0 }));
    tunButton('Audio', 'CPU benchmark (offline 10 s)', () => void this.benchmark().then((r) => console.log('AUDIO BENCH ' + JSON.stringify(r))));
  }

  /** Call from a user gesture handler. Safe to call repeatedly. */
  async start(): Promise<void> {
    if (this.started) {
      if (this.ctx?.state === 'suspended') await this.ctx.resume();
      return;
    }
    this.started = true;
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    await ctx.audioWorklet.addModule(workletUrl);
    this.buildGraph(ctx, ctx.destination);
    (window as any).__audio = this;
    void this.loadSamples(ctx);
  }

  /** Optional drop-in samples (config 'samples': CC0 or your own files). Missing/failed files keep the synthesised layer. */
  private engineSample: AudioBufferSourceNode | null = null;
  private async loadSamples(ctx: AudioContext): Promise<void> {
    const S = cfg.samples as Record<string, { url: string | null; rpm?: number }>;
    const load = async (u: string | null) => (u ? ctx.decodeAudioData(await (await fetch(u)).arrayBuffer()) : null);
    try {
      const imp = await load(S.impact?.url ?? null);
      if (imp) this.bufImpact = this.bufBottom = imp;
      const wind = await load(S.wind?.url ?? null);
      if (wind) this.windSrc!.buffer = wind;
      const eng = await load(S.engine?.url ?? null);
      if (eng) {
        const src = ctx.createBufferSource();
        src.buffer = eng;
        src.loop = true;
        src.connect(this.bus);
        src.start();
        this.engineSample = src;
        this.layers.pulses = 0; // the sample replaces the combustion pulses; intake/turbo/pops stay synthesised
      }
    } catch (e) {
      console.warn('audio sample slot failed, using the procedural layer', e);
    }
  }

  private buildGraph(ctx: BaseAudioContext, dest: AudioNode): void {
    this.master = ctx.createGain();
    this.master.gain.value = this.mute ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    this.master.connect(comp).connect(dest);
    const rev = ctx.createConvolver();
    rev.normalize = false;
    rev.buffer = makeImpulse(ctx);
    this.revSend = ctx.createGain();
    this.revSend.gain.value = cfg.reverb.send;
    this.revSend.connect(rev).connect(this.master);
    // player bus (2D) through a cabin low-pass (cockpit view muffles the outside)
    this.bus = ctx.createGain();
    this.cabinLp = ctx.createBiquadFilter();
    this.cabinLp.type = 'lowpass';
    this.cabinLp.frequency.value = 20000;
    this.bus.connect(this.cabinLp);
    this.cabinLp.connect(this.master);
    this.cabinLp.connect(this.revSend);
    const white = noiseBuffer(ctx, 3), brown = noiseBuffer(ctx, 4, true);
    const noiseLayer = (buf: AudioBuffer, type: BiquadFilterType, f: number, q: number) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.playbackRate.value = 0.9 + Math.random() * 0.2;
      const fl = ctx.createBiquadFilter();
      fl.type = type;
      fl.frequency.value = f;
      fl.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(fl).connect(g).connect(this.bus);
      src.start();
      this.lastSrc = src;
      return { g, f: fl };
    };
    const s = cfg.surface;
    this.scrub = noiseLayer(white, 'bandpass', s.scrubHzLoose, 0.8);
    this.roll = noiseLayer(brown, 'lowpass', 180, 0.7);
    this.spray = noiseLayer(white, 'highpass', s.sprayHz, 0.5);
    this.wind = noiseLayer(brown, 'lowpass', cfg.wind.lowpassHz, 0.5);
    this.windSrc = this.lastSrc;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = 300;
    const wg = ctx.createGain();
    wg.gain.value = 0;
    o.connect(wg).connect(this.bus);
    o.start();
    this.whine = { g: wg, o };
    this.bufImpact = impactBuffer(ctx, false);
    this.bufBottom = impactBuffer(ctx, true);
  }

  private makeEngineNode(ctx: BaseAudioContext, kind: EngineKind, seed: number, script?: unknown): AudioWorkletNode {
    return new AudioWorkletNode(ctx, 'wahiba-engine', {
      numberOfInputs: 0,
      outputChannelCount: [2],
      processorOptions: { engine: ENG[kind], turbo: cfg.turbo, seed, script },
    });
  }

  private ensureEngine(vehName: string): void {
    const ctx = this.ctx!;
    if (this.vehKey === vehName && this.engine) return;
    this.vehKey = vehName;
    const vc = (cfg.vehicles as Record<string, { engine: string; flutter: number }>)[vehName] ?? { engine: 'I6', flutter: 0 };
    this.engineKind = vc.engine as EngineKind;
    this.flutterAmt = vc.flutter;
    this.engine?.disconnect();
    this.engine = this.makeEngineNode(ctx, this.engineKind, 1234);
    this.engine.connect(this.bus);
  }

  private set(p: AudioParam, v: number, tc = 0.05): void {
    if (!Number.isFinite(v)) {
      if (!this.warned) {
        const names: [string, AudioParam][] = [['scrubF', this.scrub.f.frequency], ['scrubG', this.scrub.g.gain], ['rollG', this.roll.g.gain], ['rollF', this.roll.f.frequency], ['sprayG', this.spray.g.gain], ['whineF', this.whine.o.frequency], ['whineG', this.whine.g.gain], ['windG', this.wind.g.gain], ['windF', this.wind.f.frequency]];
        console.warn('INFO audio non-finite param ' + (names.find((x) => x[1] === p)?.[0] ?? '?'));
      }
      this.warned = true;
      return;
    }
    p.setTargetAtTime(v, this.ctx!.currentTime, tc);
  }

  private oneShot(buf: AudioBuffer, amp: number, rate = 1): void {
    const ctx = this.ctx;
    if (!ctx || !buf) return;
    const now = ctx.currentTime;
    this.shots = this.shots.filter((s) => s.end > now);
    if (this.shots.length >= cfg.spatial.maxOneShots) {
      const old = this.shots.shift()!;
      try { old.src.stop(); } catch { /* already stopped */ }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = Math.min(1.2, amp) * cfg.surface.impactGain * this.layers.impacts;
    src.connect(g).connect(this.bus);
    src.start();
    this.shots.push({ src, end: now + buf.duration / rate });
  }

  private liftTest(): void {
    this.audition.on = true;
    this.audition.throttle = 1;
    this.audition.boost = 1;
    this.audition.load = 1;
    setTimeout(() => {
      this.audition.throttle = 0;
      this.audition.load = 0;
    }, 1200);
  }

  /** Per-frame update from the player vehicle and the camera (listener). */
  update(dt: number, sim: VehicleSim | null, vehName: string, cam: THREE.Camera, camMode: string): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.master) return;
    const t0 = performance.now();
    this.t += dt;
    this.set(this.master.gain, this.mute ? 0 : this.volume, 0.03);
    this.set(this.revSend.gain, cfg.reverb.send * this.layers.reverb);
    this.cabin = camMode === 'cockpit';
    this.set(this.cabinLp.frequency, this.cabin ? 2600 : 20000, 0.1);
    // listener = camera
    const L = ctx.listener;
    const cp = cam.position;
    this.listenerVel = { x: (cp.x - this.listenerPos.x) / Math.max(dt, 1e-3), y: (cp.y - this.listenerPos.y) / Math.max(dt, 1e-3), z: (cp.z - this.listenerPos.z) / Math.max(dt, 1e-3) };
    this.listenerPos = { x: cp.x, y: cp.y, z: cp.z };
    const fw = { x: 0, y: 0, z: -1 }, up = { x: 0, y: 1, z: 0 };
    const q = cam.quaternion;
    // rotate (0,0,-1) and (0,1,0) by the camera quaternion
    const rot = (v: { x: number; y: number; z: number }) => {
      const ix = q.w * v.x + q.y * v.z - q.z * v.y, iy = q.w * v.y + q.z * v.x - q.x * v.z, iz = q.w * v.z + q.x * v.y - q.y * v.x, iw = -q.x * v.x - q.y * v.y - q.z * v.z;
      return { x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y, y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z, z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x };
    };
    const f = rot(fw), u = rot(up);
    if (L.positionX) {
      const now = ctx.currentTime;
      L.positionX.setValueAtTime(cp.x, now); L.positionY.setValueAtTime(cp.y, now); L.positionZ.setValueAtTime(cp.z, now);
      L.forwardX.setValueAtTime(f.x, now); L.forwardY.setValueAtTime(f.y, now); L.forwardZ.setValueAtTime(f.z, now);
      L.upX.setValueAtTime(u.x, now); L.upY.setValueAtTime(u.y, now); L.upZ.setValueAtTime(u.z, now);
    } else {
      L.setPosition(cp.x, cp.y, cp.z);
      L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
    if (sim) this.updatePlayer(dt, sim, vehName);
    this.updateDriveBy(dt);
    this.updateRemotes();
    this.updateMs = performance.now() - t0;
  }

  private updatePlayer(dt: number, sim: VehicleSim, vehName: string): void {
    this.ensureEngine(vehName);
    const A = this.audition, lay = this.layers, s = cfg.surface;
    const e = sim.spec.engine;
    const rpmSim = (sim.engineOmega * 30) / Math.PI;
    const peak = Math.max(...e.torqueCurve.map((p) => p[1]));
    const load = A.on ? A.load : Math.max(0, Math.min(1, sim.engineTorque / peak));
    const speed = A.on ? A.speed : sim.vel.length();
    this.engine!.port.postMessage({
      rpm: A.on ? A.rpm : rpmSim,
      load,
      throttle: A.on ? A.throttle : sim.throttleEff,
      boost: A.on ? A.boost : sim.boost,
      cut: A.on ? A.cut : sim.limiterCut,
      turbo: A.on ? true : !!e.turbo,
      flutter: A.on ? Math.max(0.5, this.flutterAmt) : this.flutterAmt,
      redline: e.redlineRpm,
      gain: 1,
      layers: { pulses: lay.pulses, intake: lay.intake, turbo: lay.turbo, mech: lay.mech, pops: lay.pops },
    });
    if (this.engineSample) this.set(this.engineSample.playbackRate, Math.max(0.2, (A.on ? A.rpm : rpmSim) / ((cfg.samples as any).engine.rpm || 3000)), 0.03);
    // tyres: scrub ∝ slip speed, rolling rumble ∝ speed, spray hiss ∝ loose-sand slip × speed
    let slip = 0, loose = 0, psi = 0, sprayRate = 0, nc = 0;
    for (const w of sim.wheels) {
      psi += w.pressurePsi / 4;
      if (!w.contact) continue;
      nc++;
      slip += Math.abs(w.slipSpeed);
      loose += w.loose;
      sprayRate += w.loose * (Math.abs(w.slipSpeed) * 0.7 + Math.abs(w.vLong) * 0.15);
    }
    loose = nc ? loose / nc : 0;
    if (A.on) {
      slip = A.slip * 4;
      loose = A.loose;
      psi = A.psi;
      sprayRate = loose * (A.slip * 2.8 + A.speed * 0.6);
    }
    const scrubF = (s.scrubHzHard + (s.scrubHzLoose - s.scrubHzHard) * loose) * Math.pow(Math.max(8, psi) / s.scrubPsiRef, 0.35);
    this.set(this.scrub.f.frequency, scrubF);
    this.set(this.scrub.g.gain, s.scrubGain * Math.pow(Math.min(1, slip / 10), 0.7) * (0.7 + 0.3 * Math.min(1, speed / 10)) * lay.scrub);
    this.set(this.roll.g.gain, s.rollGain * Math.min(1.5, speed / 15) * (1 + 0.6 * loose) * lay.roll);
    this.set(this.roll.f.frequency, 120 + speed * 8);
    this.set(this.spray.g.gain, s.sprayGain * Math.min(1, sprayRate / 12) * lay.spray);
    // gear whine: straight-cut transfer low range and reverse gear, frequency from the driveshaft speed
    const lowRange = A.on ? A.lowRange : sim.mode === '4L';
    const rev = !A.on && sim.gear < 0;
    const wheelOmega = A.on ? A.speed / 0.39 : Math.abs(sim.wheels[2].omega + sim.wheels[3].omega) / 2;
    const shaftHz = (wheelOmega * sim.spec.gearbox.final * (lowRange ? sim.spec.gearbox.lowRange : 1)) / (2 * Math.PI);
    const vc = (cfg.vehicles as Record<string, { whineLow4L: number }>)[vehName];
    this.set(this.whine.o.frequency, Math.max(40, shaftHz * s.gearWhineTeeth), 0.03);
    this.set(this.whine.g.gain, (lowRange || rev ? (vc?.whineLow4L ?? s.gearWhineGain) : 0) * Math.min(1, shaftHz / 6) * lay.whine);
    // wind with gusts
    const W = cfg.wind;
    const gust = 1 + W.gustDepth * 0.5 * (Math.sin((2 * Math.PI * this.t) / W.gustPeriod) * 0.6 + Math.sin((2 * Math.PI * this.t) / (W.gustPeriod * 0.37) + 1.3) * 0.4);
    this.set(this.wind.g.gain, (W.base + W.speedGain * speed) * gust * (this.cabin ? 0.4 : 1) * lay.wind, 0.2);
    this.set(this.wind.f.frequency, W.lowpassHz + speed * 25, 0.2);
    // impacts: belly / bumper contact onset, suspension hitting the bump stops
    const body = sim.bodyContactLoad;
    if (body > s.impactMinN && this.prevBody < s.impactMinN * 0.5) this.oneShot(this.bufImpact, body / 20000);
    this.prevBody = body;
    sim.wheels.forEach((w, i) => {
      const prev = this.prevS[i] ?? w.s;
      const v = (prev - w.s) / Math.max(dt, 1e-3);
      if (w.s < 0.012 && prev >= 0.012 && v > s.bottomMinSpeed) this.oneShot(this.bufBottom, Math.min(1, v / 3) * s.bottomGain, 0.9 + Math.random() * 0.2);
      this.prevS[i] = w.s;
    });
  }

  // ---- remote vehicles (multiplayer / AI): HRTF panner, distance HF damping, Doppler, voice limit ----
  setRemote(id: string, kind: EngineKind, pos: THREE.Vector3Like, vel: THREE.Vector3Like, rpm: number, load: number, throttle: number): void {
    let r = this.remotes.get(id);
    if (!r) {
      r = { id, kind, pos: { ...pos }, vel: { ...vel }, rpm, load, throttle, node: null, panner: null, lp: null, gain: null };
      this.remotes.set(id, r);
    }
    r.pos = { ...pos };
    r.vel = { ...vel };
    r.rpm = rpm;
    r.load = load;
    r.throttle = throttle;
  }

  removeRemote(id: string): void {
    const r = this.remotes.get(id);
    if (!r) return;
    this.releaseVoice(r);
    this.remotes.delete(id);
  }

  private releaseVoice(r: Remote): void {
    r.node?.disconnect();
    r.panner?.disconnect();
    r.lp?.disconnect();
    r.gain?.disconnect();
    r.node = r.panner = r.lp = r.gain = null;
  }

  private updateRemotes(): void {
    const ctx = this.ctx!;
    const sp = cfg.spatial;
    const lp = this.listenerPos, lv = this.listenerVel;
    const list = [...this.remotes.values()].map((r) => ({ r, d: Math.hypot(r.pos.x - lp.x, r.pos.y - lp.y, r.pos.z - lp.z) }));
    list.sort((a, b) => a.d - b.d);
    list.forEach(({ r, d }, i) => {
      const audible = i < sp.maxRemoteVoices && d < sp.maxDistance;
      if (!audible) {
        if (r.node) this.releaseVoice(r);
        return;
      }
      if (!r.node) {
        r.node = this.makeEngineNode(ctx, r.kind, 5000 + i * 77);
        r.lp = ctx.createBiquadFilter();
        r.lp.type = 'lowpass';
        r.panner = new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: sp.refDistance, maxDistance: sp.maxDistance, rolloffFactor: sp.rolloff });
        r.gain = ctx.createGain();
        r.node.connect(r.lp).connect(r.panner).connect(r.gain).connect(this.master);
        r.gain.connect(this.revSend);
      }
      const now = ctx.currentTime;
      r.panner!.positionX.setValueAtTime(r.pos.x, now);
      r.panner!.positionY.setValueAtTime(r.pos.y, now);
      r.panner!.positionZ.setValueAtTime(r.pos.z, now);
      // high frequencies die with distance (air absorption, ASSUMPTION: ~3 kHz cutoff at 100 m)
      this.set(r.lp!.frequency, Math.min(20000, Math.max(700, (sp.hfDampHzAt100m * 100) / Math.max(1, d))), 0.05);
      // Doppler: f' = f (c - v_listener·u) / (c - v_source·u), u = unit vector source -> listener
      const ux = (lp.x - r.pos.x) / Math.max(d, 0.01), uy = (lp.y - r.pos.y) / Math.max(d, 0.01), uz = (lp.z - r.pos.z) / Math.max(d, 0.01);
      const vs = r.vel.x * ux + r.vel.y * uy + r.vel.z * uz;
      const vl = lv.x * ux + lv.y * uy + lv.z * uz;
      const c = sp.speedOfSound;
      const pitch = Math.max(0.5, Math.min(2, (c - vl) / (c - Math.min(vs, c * 0.9))));
      r.node!.port.postMessage({ rpm: r.rpm, load: r.load, throttle: r.throttle, pitch, gain: 1.4, redline: r.kind === 'V8' ? 3800 : 5400 });
    });
  }

  private updateDriveBy(dt: number): void {
    if (!this.driveBy) return;
    const db = this.driveBy;
    db.t += dt;
    const v = 25; // 90 km/h
    const lp = this.listenerPos;
    const x = lp.x + 15, z = lp.z + 200 - v * db.t;
    this.setRemote('driveby', 'V8', { x, y: lp.y, z }, { x: 0, y: 0, z: -v }, 3100, 0.8, 0.8);
    if (db.t > 16) {
      this.removeRemote('driveby');
      this.driveBy = null;
    }
  }

  /** CPU cost: render 10 s of the full graph (engine + 1 remote + all noise layers + reverb) offline and time it. */
  async benchmark(seconds = 10, kind: EngineKind = 'I6', samples = false): Promise<{ msPerSecond: number; percentOfRealtime: number; voices: number; peak: number; clickRatio: number; pcm?: number[] }> {
    const sr = 48000;
    const off = new OfflineAudioContext(2, sr * seconds, sr);
    await off.audioWorklet.addModule(workletUrl);
    const keys = ['master', 'bus', 'cabinLp', 'revSend', 'scrub', 'roll', 'spray', 'wind', 'whine', 'bufImpact', 'bufBottom'] as const;
    const saved: Record<string, unknown> = {};
    for (const k of keys) saved[k] = (this as any)[k];
    this.buildGraph(off, off.destination);
    this.master.gain.value = 1;
    // scripted engine: rev sweeps, lift-offs (flutter, crackle) and limiter bounces
    const script: [number, Record<string, unknown>][] = [];
    for (let t = 0; t < seconds; t += 0.05) {
      const ph = (t % 4) / 4;
      const rpm = ph < 0.6 ? 900 + ph / 0.6 * 4700 : 5600 - (ph - 0.6) / 0.4 * 4500;
      script.push([t, { rpm, throttle: ph < 0.6 ? 1 : 0, load: ph < 0.6 ? 1 : 0, boost: ph < 0.6 ? Math.min(1, ph * 3) : 0.6, turbo: true, flutter: 1, cut: ph > 0.55 && ph < 0.6 && Math.floor(t * 20) % 2 === 0, redline: 5400 }]);
    }
    const redline = kind === 'V8' ? 3800 : 5400;
    for (const k of script) {
      const q = k[1] as { rpm: number; redline: number };
      q.rpm = 900 + ((q.rpm - 900) * (redline + 200 - 900)) / (5600 - 900);
      q.redline = redline;
    }
    const eng = this.makeEngineNode(off, kind, 1, script);
    eng.connect(this.bus);
    const rem = this.makeEngineNode(off, 'V8', 2, [[0, { rpm: 3000, load: 0.7, throttle: 0.7 }]]);
    const pan = new PannerNode(off, { panningModel: 'HRTF', positionX: 10, positionZ: -20 });
    rem.connect(pan).connect(this.master);
    // noise layers audible
    for (const l of [this.scrub, this.roll, this.spray, this.wind]) l.g.gain.value = 0.15;
    this.whine.g.gain.value = 0.03;
    const t0 = performance.now();
    const buf = await off.startRendering();
    const ms = performance.now() - t0;
    Object.assign(this, saved);
    const d = buf.getChannelData(0);
    let peak = 0, mx = 0, sum = 0;
    for (let i = 1; i < d.length; i++) {
      peak = Math.max(peak, Math.abs(d[i]));
      const j = Math.abs(d[i] - d[i - 1]);
      mx = Math.max(mx, j);
      sum += j;
    }
    const pcm = samples ? Array.from(d, (x) => Math.round(Math.max(-1, Math.min(1, x)) * 32767)) : undefined;
    return { msPerSecond: +(ms / seconds).toFixed(2), percentOfRealtime: +((ms / (seconds * 1000)) * 100).toFixed(2), voices: 2, peak: +peak.toFixed(3), clickRatio: +(mx / (sum / d.length)).toFixed(1), pcm };
  }
}
