// Save game + mission framework: localStorage round trip, buying/fitting parts, time attack / checkpoints / free roam
// payouts, and a full recovery mission (player snatches the stranded car out) in the real physics.
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { defaultSave, fitPart, loadSave, writeSave, buildOf, SAVE_KEY, KV } from '../src/game/save';
import { MissionRunner, MISSIONS } from '../src/game/missions';
import { Recovery } from '../src/game/recovery';
import { buildSpec } from '../src/game/garage';
import { getSpec, VehicleSim } from '../src/vehicle/vehicleSim';
import { PlaneGround } from '../src/world/terrainData';
import { SandGround } from '../src/sand/sandGround';
import { DeformGrid } from '../src/sand/deformGrid';
import { loadTerrain } from './helpers';

const DT = 1 / 120;
const memKV = (): KV & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

describe('save game', () => {
  it('round-trips through storage and survives corrupt data', () => {
    const kv = memKV();
    const d = defaultSave();
    d.credits = 1234;
    d.best.ta_west = 41.2;
    expect(writeSave(d, kv)).toBe(true);
    expect(loadSave(kv)).toEqual(d);
    kv.setItem(SAVE_KEY, '{oops');
    expect(loadSave(kv)).toEqual(defaultSave());
    expect(loadSave(null)).toEqual(defaultSave());
  });

  it('buying deducts credits once, refitting an owned part is free, too expensive is refused', () => {
    const d = defaultSave();
    d.credits = 2000;
    expect(fitPart(d, 'patrol', 'tyres', 'balloon')).toBeNull();
    expect(d.credits).toBe(1100);
    fitPart(d, 'patrol', 'tyres', 'allterrain');
    expect(fitPart(d, 'patrol', 'tyres', 'balloon')).toBeNull();
    expect(d.credits).toBe(1100);
    expect(fitPart(d, 'patrol', 'engine', 'turbo')).toMatch(/Not enough/);
    expect(buildOf(d, 'patrol').tyres).toBe('balloon');
    expect(buildOf(d, 'patrol').engine).toBe('stock');
  });
});

const flat = () => {
  const grid = new DeformGrid(512, 64);
  return { grid, ground: new SandGround(new PlaneGround(0, 0, 1, 330), grid) };
};

describe('missions', () => {
  it('mission gates sit on the real terrain; time attacks really climb', () => {
    const { data } = loadTerrain(false);
    for (const m of MISSIONS) {
      if (m.type !== 'timeAttack') continue;
      const climb = data.heightAt(m.gates![0].x, m.gates![0].z) - data.heightAt(m.start!.x, m.start!.z);
      expect(climb).toBeGreaterThan(15);
    }
  });

  it('time attack: reaching the gate pays the reward and records the best time; timeout fails', () => {
    const save = defaultSave();
    const { ground } = flat();
    const sim = new VehicleSim(getSpec('patrol'), ground);
    const r = new MissionRunner(save);
    const def = r.start('ta_west', sim, ground);
    for (let i = 0; i < 60; i++) r.update(0.5, sim);
    sim.pos.set(def.gates![0].x, 330, def.gates![0].z);
    r.update(0.1, sim);
    expect(r.status).toBe('won');
    expect(save.credits).toBe(defaultSave().credits + def.reward!);
    expect(save.best.ta_west).toBeCloseTo(30.1, 1);
    r.start('ta_west', sim, ground);
    r.update(def.timeLimit! + 1, sim);
    expect(r.status).toBe('failed');
  });

  it('checkpoints must be taken in order; free roam pays per km', () => {
    const save = defaultSave();
    const { ground } = flat();
    const sim = new VehicleSim(getSpec('patrol'), ground);
    const r = new MissionRunner(save);
    const def = r.start('convoy', sim, ground);
    const g = def.gates!;
    sim.pos.set(g[2].x, 330, g[2].z); // skipping ahead does nothing
    r.update(0.1, sim);
    expect(r.gate).toBe(0);
    for (const gt of g) {
      sim.pos.set(gt.x, 330, gt.z);
      r.update(0.1, sim);
    }
    expect(r.status).toBe('won');
    const c0 = save.credits;
    r.start('free', sim, ground);
    sim.odo += 2500;
    r.update(0.1, sim);
    expect(save.credits - c0).toBe(2 * MISSIONS[0].creditsPerKm!);
  });

  it('recovery mission: strap the stranded car and snatch it out', () => {
    const save = defaultSave();
    const { grid, ground } = flat();
    const def = MISSIONS.find((m) => m.type === 'recovery')!;
    const sim = new VehicleSim(buildSpec('patrol'), ground);
    sim.deform = grid;
    const r = new MissionRunner(save);
    r.start('rescue', sim, ground);
    const st = r.stranded!;
    // settle the stranded car, check it is stuck on its own
    const rec = new Recovery();
    rec.player = sim;
    const step = (s: number) => {
      for (let i = 0; i < s / DT; i++) {
        rec.step(DT, grid);
        if (!rec.partner) st.step(DT);
        sim.step(DT);
        grid.follow(sim.pos.x, sim.pos.z);
        r.update(DT, sim);
      }
    };
    // park the player 8 m in front of the stranded car, facing away from it
    const h = (def.stranded!.heading * Math.PI) / 180;
    const fx = Math.sin(h), fz = -Math.cos(h);
    sim.reset(st.pos.x + fx * 9, st.pos.z + fz * 9, def.stranded!.heading);
    grid.follow(sim.pos.x, sim.pos.z, true);
    step(1);
    expect(st.beached).toBe(true);
    rec.attachVehicle(sim, st, 'strap');
    sim.mode = '4H';
    sim.setPressure(20);
    sim.gear = 1;
    sim.input.throttle = 0.8;
    let t = 0;
    for (; t < 30 && r.status === 'running'; t += 0.5) step(0.5);
    const out = { status: r.status, seconds: t, strandedMoved: +Math.hypot(st.pos.x - def.stranded!.x, st.pos.z - def.stranded!.z).toFixed(1), peakKN: +((rec.rope?.peakTension ?? rec.lastBroken?.peakTension ?? 0) / 1000).toFixed(1), credits: save.credits };
    mkdirSync('tests/tmp', { recursive: true });
    writeFileSync('tests/tmp/mission_rescue.json', JSON.stringify(out, null, 1));
    expect(r.status).toBe('won');
    expect(save.credits).toBe(defaultSave().credits + def.reward!);
  });
});
