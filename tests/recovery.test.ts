// Recovery: rope physics (strap energy, breaking, winch stall, mass-aware damping) and full extraction of a beached
// vehicle by winch, snatch strap and digging. Measured numbers go to tests/tmp/recovery.json.
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { Rope } from '../src/game/rope';
import { Recovery } from '../src/game/recovery';
import { getSpec, VehicleSim } from '../src/vehicle/vehicleSim';
import { PlaneGround } from '../src/world/terrainData';
import { DeformGrid } from '../src/sand/deformGrid';
import { SandGround } from '../src/sand/sandGround';
import rc from '../src/config/recovery.json';

const DT = 1 / 120;
const out: Record<string, number | string | boolean> = {};

/** point mass `m` leaving a fixed anchor at v0 on a strap, returns peak energy/tension and whether it broke */
function snatch(v0: number, m = 2500, damping?: number) {
  const spec = { ...rc.ropes.strap, dampingRatio: damping ?? rc.ropes.strap.dampingRatio };
  const r = new Rope(spec);
  const a = { x: 0, y: 0, z: 0 }, va = { x: 0, y: 0, z: 0 };
  const b = { x: 0, y: 0, z: spec.length }, vb = { x: 0, y: 0, z: v0 };
  let peakE = 0;
  for (let i = 0; i < 4000; i++) {
    const T = r.update(1 / 2000, a, va, b, vb, Infinity, m);
    vb.z -= (T / m) / 2000;
    b.z += vb.z / 2000;
    peakE = Math.max(peakE, r.energy);
    if (r.broken) break;
  }
  return { peakE, peakT: r.peakTension, broken: r.broken, vEnd: vb.z };
}

describe('rope physics', () => {
  it('kinetic strap stores the recovery car energy (undamped: peak ½kx² ≈ ½mv²)', () => {
    const s = snatch(3, 2500, 0);
    const ke = 0.5 * 2500 * 9;
    out['strap 3 m/s peak energy J'] = Math.round(s.peakE);
    expect(s.peakE).toBeGreaterThan(ke * 0.95);
    expect(s.peakE).toBeLessThan(ke * 1.02);
    expect(s.broken).toBe(false);
  });

  it('a snatch at 3 m/s holds, a run-up at 9 m/s breaks the strap', () => {
    const slow = snatch(3), fast = snatch(9);
    out['strap 3 m/s peak tension kN'] = +(slow.peakT / 1000).toFixed(1);
    out['strap 9 m/s broke'] = fast.broken;
    expect(slow.broken).toBe(false);
    expect(slow.peakT).toBeLessThan(rc.ropes.strap.mbsN * 0.6);
    expect(fast.broken).toBe(true);
  });

  it('only pulls, never pushes', () => {
    const r = Rope.of('tow');
    const T = r.update(DT, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 3 }, { x: 0, y: 0, z: -5 }, 2500, 2500);
    expect(T).toBe(0);
  });

  it('winch reels in at no-load speed and stalls at its rated pull without breaking the line', () => {
    const r = Rope.of('winch', 20);
    r.winchCmd = 1;
    const a = { x: 0, y: 0, z: 0 }, b = { x: 0, y: 0, z: 25 }, z0 = { x: 0, y: 0, z: 0 };
    // slack: full speed
    r.update(DT, a, z0, b, z0, 2500, Infinity);
    expect(r.winchSpeed).toBeCloseTo(rc.winch.lineSpeedNoLoad, 5);
    // immovable load: tension climbs to stall
    const r2 = Rope.of('winch', 20);
    r2.winchCmd = 1;
    const b2 = { x: 0, y: 0, z: 20 };
    for (let i = 0; i < 120 * 30; i++) r2.update(DT, a, z0, b2, z0, 2500, Infinity);
    out['winch stall tension kN'] = +(r2.tension / 1000).toFixed(1);
    expect(r2.tension).toBeGreaterThan(rc.winch.stallPullN * 0.95);
    expect(r2.tension).toBeLessThanOrEqual(rc.winch.stallPullN * 1.01);
    expect(r2.winchSpeed).toBeLessThan(0.01);
    expect(r2.broken).toBe(false);
  });

  it('damping is mass-aware: car-to-anchor damps sqrt(2) more than car-to-equal-car', () => {
    const z0 = { x: 0, y: 0, z: 0 };
    const t = (mB: number) => {
      const r = Rope.of('tow');
      const k = r.k;
      const T = r.update(DT, z0, z0, { x: 0, y: 0, z: 6.1 }, { x: 0, y: 0, z: 1 }, 2500, mB);
      return T - k * 0.1;
    };
    expect(t(Infinity) / t(2500)).toBeCloseTo(Math.SQRT2, 3);
  });
});

function makeBeached(): VehicleSim {
  const base = new PlaneGround(0, -Math.tan((8 * Math.PI) / 180), 1);
  const grid = new DeformGrid(512, 64);
  grid.follow(0, 0, true);
  const sim = new VehicleSim(getSpec('patrol'), new SandGround(base, grid));
  sim.deform = grid;
  sim.reset(0, 0, 0);
  sim.input.brake = 1;
  run(sim, null, 1);
  sim.mode = '2H';
  sim.setPressure(40);
  sim.input.brake = 0;
  sim.input.throttle = 1;
  run(sim, null, 12);
  sim.input.throttle = 0;
  run(sim, null, 1);
  return sim;
}
function run(sim: VehicleSim, rec: Recovery | null, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) {
    rec?.step(DT, sim.deform);
    sim.step(DT);
    sim.deform?.follow(sim.pos.x, sim.pos.z);
    sim.deform?.relax(sim.pos.x, sim.pos.z, DT);
    if (!Number.isFinite(sim.pos.x + sim.pos.y + sim.vel.x)) throw new Error('NaN at ' + i);
  }
}

describe('recovering a beached vehicle', () => {
  it('stays beached on its own in 2H at 40 psi (needs a recovery method)', () => {
    const sim = makeBeached();
    expect(sim.beached).toBe(true);
    const z0 = sim.pos.z;
    sim.input.throttle = 1;
    run(sim, null, 5);
    out['self-recovery attempt moved m'] = +Math.abs(sim.pos.z - z0).toFixed(2);
    expect(sim.beached).toBe(true);
  });

  it('winch to a sand anchor ahead pulls it out', () => {
    const sim = makeBeached();
    const rec = new Recovery();
    rec.attachAnchor(sim, 'winch');
    rec.rope!.winchCmd = 1;
    const p0 = sim.pos.clone();
    // winch alone: no throttle, still in 2H at 40 psi
    sim.input.throttle = 0;
    let peak = 0;
    for (let t = 0; t < 40 && p0.distanceTo(sim.pos) < 4; t += 0.5) {
      run(sim, rec, 0.5);
      peak = Math.max(peak, rec.rope?.tension ?? 0);
    }
    const moved = p0.distanceTo(sim.pos);
    out['winch moved m'] = +moved.toFixed(2);
    out['winch peak tension kN'] = +(peak / 1000).toFixed(1);
    expect(moved).toBeGreaterThan(3);
    expect(rec.rope?.broken ?? false).toBe(false);
  });

  it('snatch strap from the AI partner pulls it out backwards', () => {
    const sim = makeBeached();
    const rec = new Recovery();
    const partner = rec.attachPartner(sim, 'strap', 'rear', 2);
    run(sim, rec, 1);
    rec.partnerDrive = true;
    const p0 = sim.pos.clone();
    let peak = 0;
    for (let t = 0; t < 20 && p0.distanceTo(sim.pos) < 5; t += 0.5) {
      run(sim, rec, 0.5);
      peak = Math.max(peak, rec.rope?.tension ?? rec.lastBroken?.peakTension ?? 0);
    }
    const moved = p0.distanceTo(sim.pos);
    out['snatch moved m'] = +moved.toFixed(2);
    out['snatch peak tension kN'] = +(peak / 1000).toFixed(1);
    out['partner finite'] = Number.isFinite(partner.pos.x);
    expect(moved).toBeGreaterThan(3);
    expect(Number.isFinite(partner.pos.x)).toBe(true);
  });

  it('digging lowers the dug-in depth and the belly load', () => {
    const sim = makeBeached();
    const dug0 = Math.max(...sim.wheels.map((w) => w.sink.dug));
    const belly0 = sim.bodyContactLoad;
    const rec = new Recovery();
    rec.player = sim;
    rec.startDig();
    sim.input.brake = 1;
    run(sim, rec, rc.dig.seconds + 0.5);
    const dug1 = Math.max(...sim.wheels.map((w) => w.sink.dug));
    out['dig: max dug before/after m'] = `${dug0.toFixed(2)} / ${dug1.toFixed(2)}`;
    out['dig: belly load before/after kN'] = `${(belly0 / 1000).toFixed(1)} / ${(sim.bodyContactLoad / 1000).toFixed(1)}`;
    expect(rec.digs).toBe(1);
    expect(dug1).toBeLessThan(dug0 * 0.7 + 1e-3);
    expect(sim.bodyContactLoad).toBeLessThanOrEqual(belly0 + 1);
    // dig + air down + 4H then drives out
    sim.setPressure(15);
    sim.mode = '4H';
    sim.input.brake = 0;
    sim.gear = -1;
    sim.input.throttle = 0.6;
    const p0 = sim.pos.clone();
    run(sim, null, 6);
    out['dig + 15 psi + reverse moved m'] = +p0.distanceTo(sim.pos).toFixed(2);
    mkdirSync('tests/tmp', { recursive: true });
    writeFileSync('tests/tmp/recovery.json', JSON.stringify(out, null, 1));
    expect(p0.distanceTo(sim.pos)).toBeGreaterThan(2);
  });
});

void Vector3;
