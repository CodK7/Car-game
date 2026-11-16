// Mission framework (pure TS, no DOM): missions come from src/config/missions.json. The runner tracks gates, timers,
// the stranded vehicle of recovery missions, and pays credits into the save game on success.
import data from '../config/missions.json';
import { getSpec, VehicleSim, SimGround } from '../vehicle/vehicleSim';
import type { SaveData } from './save';

export interface Gate { x: number; z: number; r: number }
export interface MissionDef {
  id: string;
  type: 'free' | 'timeAttack' | 'recovery' | 'checkpoints';
  title: string;
  desc: string;
  start?: { x: number; z: number; heading: number };
  gates?: Gate[];
  timeLimit?: number;
  goldTime?: number;
  reward?: number;
  creditsPerKm?: number;
  stranded?: { vehicle: string; x: number; z: number; heading: number; livery: string; dug: number };
  pullDistance?: number;
}
export const MISSIONS = data.missions as MissionDef[];
export type MissionStatus = 'idle' | 'running' | 'won' | 'failed';

export class MissionRunner {
  def: MissionDef = MISSIONS[0];
  status: MissionStatus = 'idle';
  time = 0;
  gate = 0;
  stranded: VehicleSim | null = null;
  private strandedStart = { x: 0, z: 0 };
  private odo0 = 0;
  private paidKm = 0;
  messages: string[] = [];

  constructor(readonly save: SaveData) {}

  /** Start a mission: places the player at its start and creates the stranded vehicle if any. */
  start(id: string, player: VehicleSim, ground: SimGround): MissionDef {
    const def = MISSIONS.find((m) => m.id === id) ?? MISSIONS[0];
    this.def = def;
    this.time = 0;
    this.gate = 0;
    this.stranded = null;
    this.status = def.type === 'free' ? 'running' : 'running';
    if (def.start) player.reset(def.start.x, def.start.z, def.start.heading);
    player.vel.set(0, 0, 0);
    this.odo0 = player.odo;
    this.paidKm = 0;
    if (def.stranded) {
      const s = def.stranded;
      const v = new VehicleSim(getSpec(s.vehicle), ground);
      v.reset(s.x, s.z, s.heading);
      v.mode = '2H';
      v.setPressure(40);
      // settle on its wheels first (dropping from reset unloads the tyres), then dig it in
      v.input.brake = 1;
      for (let i = 0; i < 120; i++) v.step(1 / 120);
      v.input.brake = 0;
      for (const w of v.wheels) {
        w.sink.dug = s.dug;
        w.sink.depth = w.sink.static + s.dug;
        w.sink.stuck = true;
      }
      this.stranded = v;
      this.strandedStart = { x: s.x, z: s.z };
    }
    this.say(def.title + (def.timeLimit ? ` · ${def.timeLimit} s` : ''));
    return def;
  }

  stop(): void {
    this.status = 'idle';
    this.stranded = null;
  }

  /** current target (gate or stranded car) for the HUD arrow */
  target(): { x: number; z: number } | null {
    if (this.status !== 'running') return null;
    if (this.def.type === 'recovery' && this.stranded) return { x: this.stranded.pos.x, z: this.stranded.pos.z };
    const g = this.def.gates?.[this.gate];
    return g ? { x: g.x, z: g.z } : null;
  }

  update(dt: number, player: VehicleSim): void {
    if (this.status !== 'running') return;
    const d = this.def;
    this.time += dt;
    if (d.type === 'free') {
      const km = (player.odo - this.odo0) / 1000;
      const whole = Math.floor(km);
      if (whole > this.paidKm) {
        const n = whole - this.paidKm;
        this.paidKm = whole;
        this.save.credits += n * (d.creditsPerKm ?? 0);
        this.save.odoKm += n;
        this.say(`+${n * (d.creditsPerKm ?? 0)} credits (${whole} km)`);
      }
      return;
    }
    if (d.timeLimit && this.time > d.timeLimit) {
      this.status = 'failed';
      this.say('Out of time');
      return;
    }
    if (d.type === 'recovery') {
      const s = this.stranded;
      if (s && Math.hypot(s.pos.x - this.strandedStart.x, s.pos.z - this.strandedStart.z) > (d.pullDistance ?? 10) && !s.beached) this.win();
      return;
    }
    const g = d.gates?.[this.gate];
    if (g && Math.hypot(player.pos.x - g.x, player.pos.z - g.z) < g.r) {
      this.gate++;
      if (this.gate >= (d.gates?.length ?? 0)) this.win();
      else this.say(`Checkpoint ${this.gate}/${d.gates!.length}  ${this.time.toFixed(1)} s`);
    }
  }

  private win(): void {
    const d = this.def;
    this.status = 'won';
    let reward = d.reward ?? 0;
    if (d.goldTime && this.time <= d.goldTime) reward = Math.round(reward * 1.5);
    this.save.credits += reward;
    const best = this.save.best[d.id];
    if (best === undefined || this.time < best) this.save.best[d.id] = +this.time.toFixed(2);
    if (!this.save.done.includes(d.id)) this.save.done.push(d.id);
    this.say(`${d.title}: done in ${this.time.toFixed(1)} s · +${reward} credits${d.goldTime && this.time <= d.goldTime ? ' (gold)' : ''}`);
  }

  say(m: string): void {
    this.messages.push(m);
  }
}
