// Recovery (pure TS, no DOM): rope / snatch strap / winch between the player's vehicle and a sand anchor or an AI
// partner vehicle, plus shovel digging. The DriveSession calls step(dt) before each physics step.
// A beached vehicle gets out only through the real mechanisms: air down (sink model), rock/reverse (driving),
// dig (this file: lowers dug-in depth and the sand under the belly), tow/snatch (partner), winch (anchor/partner).
import { Vector3 } from 'three';
import cfg from '../config/recovery.json';
import { Rope, RopeKind } from './rope';
import { getSpec, VehicleSim } from '../vehicle/vehicleSim';
import type { DeformGrid } from '../sand/deformGrid';
import { t, tf } from '../core/i18n';

export type HookSide = 'front' | 'rear';

/** Recovery point on the chassis (body frame): bumper height, at the very front or rear. */
export function hookLocal(sim: VehicleSim, side: HookSide, out = new Vector3()): Vector3 {
  const s = sim.spec;
  const zF = -s.wheelbase * (1 - s.frontWeightFrac);
  const zFront = zF - s.body.overhangF;
  const yb = -s.cgHeight + s.body.groundClearance + 0.35;
  return out.set(0, yb, side === 'front' ? zFront : zFront + s.body.length);
}

const tA = new Vector3(), tB = new Vector3(), vA = new Vector3(), vB = new Vector3(), tR = new Vector3(), tU = new Vector3();

function worldPoint(sim: VehicleSim, local: Vector3, out: Vector3): Vector3 {
  return out.copy(local).applyMatrix3(sim.R).add(sim.pos);
}
function pointVel(sim: VehicleSim, world: Vector3, out: Vector3): Vector3 {
  return out.copy(world).sub(sim.pos).cross(tU.copy(sim.angVel).negate()).add(sim.vel); // v + ω × r
}

export class Recovery {
  rope: Rope | null = null;
  kind: RopeKind | null = null;
  player: VehicleSim | null = null;
  playerHook = new Vector3();
  partner: VehicleSim | null = null;
  partnerHook = new Vector3();
  anchor: Vector3 | null = null;
  /** AI partner drives away to tension the rope (tow) or to snatch */
  partnerDrive = false;
  /** helper = AI recovery car; stranded = a stuck vehicle the player recovers (no brakes, no throttle) */
  partnerRole: 'helper' | 'stranded' | 'remote' = 'helper';
  /** body kind / paint for the partner's visual */
  partnerKind = cfg.partner.vehicle;
  partnerPaint: string | undefined = undefined;
  digT = 0;
  digging = false;
  digs = 0;
  /** world-space end points for rendering (valid while a rope exists) */
  endA = new Vector3();
  endB = new Vector3();
  messages: string[] = [];
  private anchorHold = cfg.anchor.holdN;

  get active(): boolean {
    return !!this.rope && !this.rope.broken;
  }

  /** Winch (or rope) from the player's front to a sand anchor `dist` metres ahead (or `at` if given). */
  attachAnchor(sim: VehicleSim, kind: RopeKind = 'winch', at?: Vector3, side: HookSide = 'front'): void {
    this.release(false);
    this.player = sim;
    hookLocal(sim, side, this.playerHook);
    const p = worldPoint(sim, this.playerHook, tA);
    const dir = side === 'front' ? sim.fwd : tR.copy(sim.fwd).negate();
    const len = cfg.ropes[kind].length;
    this.anchor = at ? at.clone() : new Vector3(p.x + dir.x * (len - 3), sim.pos.y, p.z + dir.z * (len - 3));
    this.anchor.y = sim.ground.heightAt(this.anchor.x, this.anchor.z) + 0.2;
    const dist = p.distanceTo(this.anchor);
    this.rope = Rope.of(kind, Math.min(cfg.ropes[kind].length, dist + 0.3));
    this.kind = kind;
    this.say(t('rec.anchor', tf(cfg.ropes[kind], 'label'), dist.toFixed(0)));
  }

  /** Create the AI partner (if needed) parked behind/ahead of the player and connect a strap or tow rope. */
  attachPartner(sim: VehicleSim, kind: RopeKind = 'strap', side: HookSide = 'rear', slack = 1.5): VehicleSim {
    this.release(false);
    this.player = sim;
    hookLocal(sim, side, this.playerHook);
    const dir = side === 'rear' ? tR.copy(sim.fwd).negate() : tR.copy(sim.fwd);
    dir.y = 0;
    dir.normalize();
    const p = worldPoint(sim, this.playerHook, tA);
    const partner = this.partner ?? new VehicleSim(getSpec(cfg.partner.vehicle), sim.ground);
    partner.deform = null;
    const ropeLen = cfg.ropes[kind].length;
    // partner's rear hook ends up (ropeLen - slack) away from the player's hook, partner facing away
    const pr = hookLocal(partner, 'rear', this.partnerHook);
    const back = pr.z; // rear hook distance behind the partner's centre
    const d = ropeLen - slack + back;
    const heading = (Math.atan2(dir.x, -dir.z) * 180) / Math.PI;
    partner.reset(p.x + dir.x * d, p.z + dir.z * d, heading);
    partner.mode = '4L';
    partner.setPressure(18);
    this.partner = partner;
    this.partnerRole = 'helper';
    this.rope = Rope.of(kind);
    this.kind = kind;
    this.partnerDrive = false;
    this.say(t('rec.partner', tf(cfg.ropes[kind], 'label')));
    return partner;
  }

  /** Connect the player to another existing vehicle (e.g. a stranded car in a mission), nearest hooks on each side. */
  attachVehicle(sim: VehicleSim, other: VehicleSim, kind: RopeKind = 'strap'): void {
    this.release(false);
    this.player = sim;
    const toOther = tR.copy(other.pos).sub(sim.pos);
    const sideA: HookSide = toOther.dot(sim.fwd) > 0 ? 'front' : 'rear';
    const sideB: HookSide = toOther.dot(other.fwd) < 0 ? 'front' : 'rear';
    hookLocal(sim, sideA, this.playerHook);
    hookLocal(other, sideB, this.partnerHook);
    this.partner = other;
    this.partnerRole = 'stranded';
    const dist = worldPoint(sim, this.playerHook, tA).distanceTo(worldPoint(other, this.partnerHook, tB));
    this.rope = Rope.of(kind, Math.max(dist + 0.5, cfg.ropes[kind].length));
    this.kind = kind;
    this.say(t('rec.stranded', tf(cfg.ropes[kind], 'label')));
  }

  /** Multiplayer: rope to another player's (ghost) vehicle with the server's rest length and hook sides. */
  attachRemote(sim: VehicleSim, ghost: VehicleSim, kind: RopeKind, rest: number, sideA: HookSide, sideB: HookSide): void {
    this.release(false);
    this.player = sim;
    hookLocal(sim, sideA, this.playerHook);
    hookLocal(ghost, sideB, this.partnerHook);
    this.partner = ghost;
    this.partnerRole = 'remote';
    this.rope = Rope.of(kind, rest);
    this.kind = kind;
    this.say(t('rec.remote', tf(cfg.ropes[kind], 'label')));
  }

  release(say = true): void {
    if (this.rope && say) this.say(this.rope.broken ? t('rec.broke') : t('rec.released'));
    this.rope = null;
    this.kind = null;
    this.anchor = null;
    this.partnerDrive = false;
    if (this.player) this.player.extActive = false;
    if (this.partner) this.partner.extActive = false;
  }

  /** Remove the partner vehicle entirely. */
  dismissPartner(): void {
    if (this.rope && !this.anchor) this.release(false);
    this.partner = null;
  }

  /** Called before each physics step (player and partner). Steps the partner sim itself. */
  step(dt: number, grid: DeformGrid | null): void {
    const sim = this.player;
    if (this.digging && sim) this.digStep(sim, grid, dt);
    if (this.partner && this.partnerRole === 'remote') {
      // another player's vehicle: its own client simulates it; we only feel the rope
      if (this.rope && !this.anchor) this.applyRope(dt);
    } else if (this.partner) {
      this.partnerAI(dt);
      if (this.rope && !this.anchor) this.applyRope(dt);
      this.partner.step(dt);
    }
    if (this.rope && this.anchor) this.applyRope(dt);
    if (this.rope?.broken) {
      this.say(t('rec.brokeMbs'));
      const r = this.rope;
      this.release(false);
      this.lastBroken = r;
    }
  }

  lastBroken: Rope | null = null;

  private applyRope(dt: number): void {
    const sim = this.player!, rope = this.rope!;
    const a = worldPoint(sim, this.playerHook, this.endA);
    const va = pointVel(sim, a, vA);
    let b: Vector3, vb: Vector3, mB: number;
    if (this.anchor) {
      b = this.endB.copy(this.anchor);
      vb = vB.set(0, 0, 0);
      mB = Infinity;
    } else {
      const p = this.partner!;
      b = worldPoint(p, this.partnerHook, this.endB);
      vb = pointVel(p, b, vB);
      mB = p.mass;
    }
    const T = rope.update(dt, a, va, b, vb, sim.mass, mB);
    const u = tB.copy(b).sub(a);
    const len = u.length() || 1;
    u.multiplyScalar(1 / len);
    sim.extForce.copy(u).multiplyScalar(T);
    sim.extPoint.copy(a);
    sim.extActive = T > 0;
    if (this.partner && !this.anchor && this.partnerRole !== 'remote') {
      this.partner.extForce.copy(u).multiplyScalar(-T);
      this.partner.extPoint.copy(b);
      this.partner.extActive = T > 0;
    }
    // a sand anchor drags through the sand above its holding force
    if (this.anchor && T > this.anchorHold) {
      const slip = (T - cfg.anchor.dragN) / rope.k;
      this.anchor.addScaledVector(u, -Math.min(slip, 0.05));
      this.anchor.y = sim.ground.heightAt(this.anchor.x, this.anchor.z) + 0.2;
      this.anchorHold = cfg.anchor.dragN; // once moving it holds less
    }
  }

  /** Partner: drives straight away from the stuck car in 4L until the rope is taut, holds a steady pull. */
  private partnerAI(dt: number): void {
    const p = this.partner!;
    const inp = p.input;
    if (this.partnerRole === 'stranded') {
      inp.throttle = 0;
      inp.brake = 0;
      inp.handbrake = 0;
      inp.steer = 0;
      return;
    }
    if (!this.partnerDrive || !this.player) {
      inp.throttle = 0;
      inp.brake = 1;
      inp.steer = 0;
      return;
    }
    // steer to keep pointing away from the player
    const away = tR.copy(p.pos).sub(this.player.pos);
    away.y = 0;
    away.normalize();
    const cross = p.fwd.x * away.z - p.fwd.z * away.x; // +: target is to the right
    inp.steer = Math.max(-1, Math.min(1, cross * 3));
    const sp = p.speed;
    const want = this.kind === 'strap' ? cfg.partner.pullSpeed : cfg.partner.pullSpeed * 0.4;
    inp.brake = 0;
    p.gear = 1;
    inp.throttle = sp < want ? cfg.partner.throttle : 0.15;
    void dt;
  }

  startDig(): void {
    if (!this.player) return;
    this.digging = true;
    this.digT = 0;
    this.say(t('rec.digging'));
  }

  private digStep(sim: VehicleSim, grid: DeformGrid | null, dt: number): void {
    const d = cfg.dig;
    if (Math.abs(sim.speed) > 0.5) {
      this.digging = false;
      this.say(t('rec.digStopped'));
      return;
    }
    this.digT += dt;
    for (const w of sim.wheels) w.sink.dug = Math.max(0, w.sink.dug - d.wheelDigPerSec * dt);
    if (grid) {
      // clear sand under the belly and ramps in front of / behind each wheel
      const every = 0.25;
      if (Math.floor(this.digT / every) !== Math.floor((this.digT - dt) / every)) {
        const amt = d.bellyLowerPerSec * every;
        grid.dig(sim.pos.x, sim.pos.z, d.radius * 1.4, amt);
        grid.dig(sim.pos.x + sim.fwd.x * 1.2, sim.pos.z + sim.fwd.z * 1.2, d.radius, amt);
        grid.dig(sim.pos.x - sim.fwd.x * 1.2, sim.pos.z - sim.fwd.z * 1.2, d.radius, amt);
        for (const w of sim.wheels) {
          grid.dig(w.point.x + sim.fwd.x * 0.6, w.point.z + sim.fwd.z * 0.6, d.radius * 0.7, amt * 0.6);
          grid.dig(w.point.x - sim.fwd.x * 0.6, w.point.z - sim.fwd.z * 0.6, d.radius * 0.7, amt * 0.6);
        }
      }
    }
    if (this.digT >= d.seconds) {
      this.digging = false;
      this.digs++;
      this.say(t('rec.dug'));
    }
  }

  say(m: string): void {
    this.messages.push(m);
  }
}
