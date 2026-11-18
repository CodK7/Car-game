// Multiplayer client (DOM WebSocket). Enabled with ?mp (server ws://<page host>:8787) or ?server=ws://host:port.
// The local vehicle is simulated here (prediction) and sent 20×/s; remote vehicles are ghost sims driven by
// interpolated snapshots (netInterp.ts). Ropes between players are server-authoritative: the server decides who is
// tied to whom, the rest length and when a rope breaks; this client applies the rope force to its own vehicle with
// the same maths, using the remote's interpolated (or dead-reckoned) state.
import * as THREE from 'three';
import type { DriveSession, BodyFactory } from './driveSession';
import type { AudioSystem } from '../audio/audioSystem';
import { getSpec, PRESETS, VehicleSim } from '../vehicle/vehicleSim';
import { VehicleView } from '../vehicle/vehicleView';
import { hookLocal, HookSide } from './recovery';
import { Interp, ServerClock } from './netInterp';
import type { RopeKind } from './rope';
import audioCfg from '../config/audio.json';
import { t } from '../core/i18n';

interface Remote { id: number; kind: string; ghost: VehicleSim; view: VehicleView; interp: Interp; seen: number; rpm: number; thr: number }
interface NetRope { a: number; b: number; sa: number; sb: number; kind: RopeKind; rest: number; tension: number; broken: boolean }

const SIDE: HookSide[] = ['front', 'rear'];
const tmp = { p: [0, 0, 0], q: [0, 0, 0, 1], v: [0, 0, 0] };

export class NetClient {
  ws: WebSocket | null = null;
  id = 0;
  status = 'connecting';
  clock = new ServerClock();
  remotes = new Map<number, Remote>();
  rope: NetRope | null = null;
  private sendT = 0;
  private hf = new THREE.Vector3();
  private hr = new THREE.Vector3();
  messages: string[] = [];

  constructor(readonly url: string, readonly drive: DriveSession, readonly audio: AudioSystem | null, readonly bodyFactory: BodyFactory | null) {
    this.connect();
  }

  private connect(): void {
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.status = 'offline (bad url)';
      return;
    }
    this.ws.onopen = () => {
      this.status = 'online';
      this.ws!.send(JSON.stringify({ t: 'hello', kind: this.drive.kind, paint: this.drive.paint ?? null }));
    };
    this.ws.onclose = () => {
      if (this.status !== 'room full') this.status = 'offline';
      for (const r of this.remotes.values()) this.drop(r);
    };
    this.ws.onerror = () => (this.status = 'offline (no server)');
    this.ws.onmessage = (e) => this.onMessage(JSON.parse(String(e.data)));
  }

  private onMessage(m: any): void {
    const local = performance.now() / 1000;
    if (m.t === 'welcome') {
      this.id = m.id;
      this.clock.observe(m.time, local);
      this.say(t('net.online', m.id, m.max));
    } else if (m.t === 'full') {
      this.status = 'room full';
      this.say(t('net.full', m.max));
    } else if (m.t === 'snap') {
      this.clock.observe(m.time, local);
      const ids = new Set<number>();
      for (const p of m.players) {
        if (p.id === this.id) continue;
        ids.add(p.id);
        let r = this.remotes.get(p.id);
        if (!r || r.kind !== p.kind) {
          if (r) this.drop(r);
          const ghost = new VehicleSim(getSpec(p.kind in PRESETS ? p.kind : 'patrol'), this.drive.ground);
          const view = new VehicleView(ghost, this.bodyFactory ? this.bodyFactory(ghost, p.kind, p.paint ?? undefined) : null);
          this.drive.group.add(view.group);
          r = { id: p.id, kind: p.kind, ghost, view, interp: new Interp(), seen: local, rpm: 0, thr: 0 };
          this.remotes.set(p.id, r);
          this.say(t('net.joined', p.id));
        }
        r.seen = local;
        r.rpm = p.s.rpm;
        r.thr = p.s.thr;
        r.ghost.mass = p.s.mass;
        r.interp.push({ t: p.ts, p: p.s.p, q: p.s.q, v: p.s.v });
      }
      for (const r of [...this.remotes.values()]) if (!ids.has(r.id) && local - r.seen > 3) this.drop(r);
      this.syncRope(m.ropes as NetRope[]);
    }
  }

  private syncRope(ropes: NetRope[]): void {
    const rec = this.drive.rec;
    const mine = ropes.find((r) => r.a === this.id || r.b === this.id) ?? null;
    if (mine && mine.broken) {
      if (rec.partnerRole === 'remote' && rec.rope) {
        rec.release(false);
        this.say(t('net.broke', mine.kind === 'strap' ? 78 : 60));
      }
    } else if (mine) {
      const otherId = mine.a === this.id ? mine.b : mine.a;
      const other = this.remotes.get(otherId);
      const meA = mine.a === this.id;
      if (other && !(rec.partnerRole === 'remote' && rec.rope && rec.partner === other.ghost)) {
        rec.attachRemote(this.drive.sim, other.ghost, mine.kind, mine.rest, SIDE[meA ? mine.sa : mine.sb], SIDE[meA ? mine.sb : mine.sa]);
      }
      if (rec.rope) rec.rope.restLength = mine.rest;
    } else if (rec.partnerRole === 'remote' && rec.rope) rec.release();
    this.rope = mine;
  }

  private drop(r: Remote): void {
    this.drive.group.remove(r.view.group);
    this.audio?.removeRemote('net' + r.id);
    if (this.drive.rec.partner === r.ghost) {
      this.drive.rec.release(false);
      this.drive.rec.partner = null;
    }
    this.remotes.delete(r.id);
  }

  /** T near another player: ask the server for a strap (or drop the current one). Returns true when handled. */
  ropeKey(): boolean {
    if (this.status !== 'online' || !this.ws) return false;
    if (this.rope) {
      this.ws.send(JSON.stringify({ t: 'unrope' }));
      return true;
    }
    const s = this.drive.sim;
    let best: Remote | null = null, bd = 16;
    for (const r of this.remotes.values()) {
      const d = r.ghost.pos.distanceTo(s.pos);
      if (d < bd) (bd = d), (best = r);
    }
    if (!best) return false;
    this.ws.send(JSON.stringify({ t: 'rope', to: best.id, kind: 'strap' }));
    this.say(t('net.strap', best.id));
    return true;
  }

  update(dt: number): void {
    const local = performance.now() / 1000;
    const now = this.clock.now(local);
    for (const r of this.remotes.values()) {
      if (!r.interp.sample(now, tmp)) continue;
      const g = r.ghost;
      g.pos.fromArray(tmp.p);
      g.quat.fromArray(tmp.q);
      g.vel.fromArray(tmp.v);
      g.updateFrame();
      r.view.update();
      const kind = (audioCfg.vehicles as Record<string, { engine: string }>)[r.kind]?.engine === 'V8' ? 'V8' : 'I6';
      this.audio?.setRemote('net' + r.id, kind, g.pos, g.vel, r.rpm, r.thr, r.thr);
    }
    this.sendT += dt;
    const ws = this.ws;
    if (!ws || ws.readyState !== 1 || this.sendT < 0.05) return;
    this.sendT = 0;
    const s = this.drive.sim;
    hookLocal(s, 'front', this.hf).applyMatrix3(s.R).add(s.pos);
    hookLocal(s, 'rear', this.hr).applyMatrix3(s.R).add(s.pos);
    const r3 = (v: THREE.Vector3) => [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)];
    ws.send(JSON.stringify({
      t: 's', p: r3(s.pos), q: s.quat.toArray().map((x) => +x.toFixed(5)), v: r3(s.vel), w: r3(s.angVel),
      h: [r3(this.hf), r3(this.hr)], mass: s.mass, rpm: Math.round(s.rpm), thr: +s.input.throttle.toFixed(2),
    }));
  }

  hudLine(): string {
    const n = this.remotes.size + (this.status === 'online' ? 1 : 0);
    const r = this.rope ? '  ' + t('net.rope', (this.rope.tension / 1000).toFixed(1)) : '';
    return `\n${this.status}${this.status === 'online' ? ' · ' + t('net.players', n) : ''}${r}`;
  }

  say(m: string): void {
    this.messages.push(m);
  }
}
