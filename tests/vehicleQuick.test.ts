import { describe, expect, it } from 'vitest';
import { getSpec, VehicleSim, PRESETS } from '../src/vehicle/vehicleSim';
import { PlaneGround } from '../src/world/terrainData';

const DT = 1 / 120;

function run(sim: VehicleSim, seconds: number, f?: (t: number) => void): void {
  for (let i = 0; i < seconds / DT; i++) {
    f?.(i * DT);
    sim.step(DT);
    if (!Number.isFinite(sim.pos.x + sim.pos.y + sim.vel.x + sim.angVel.y)) throw new Error('NaN at ' + i);
  }
}

describe('vehicle sim basics', () => {
  it('settles at rest on flat hard ground without jitter', () => {
    const sim = new VehicleSim(getSpec('patrol'), new PlaneGround(0, 0, 0, 0));
    sim.reset(0, 0, 0);
    sim.gear = 0;
    run(sim, 3);
    expect(sim.vel.length()).toBeLessThan(0.05);
    expect(sim.angVel.length()).toBeLessThan(0.05);
    const loads = sim.wheels.map((w) => w.load);
    const sum = loads.reduce((a, b) => a + b, 0);
    expect(sum / (sim.mass * 9.81)).toBeGreaterThan(0.95);
    expect(sum / (sim.mass * 9.81)).toBeLessThan(1.05);
    expect(sim.up.y).toBeGreaterThan(0.999);
  });

  it('accelerates forward on hard ground with throttle', () => {
    const sim = new VehicleSim(getSpec('patrol'), new PlaneGround(0, 0, 0, 0));
    sim.reset(0, 0, 0);
    run(sim, 1);
    sim.input.throttle = 1;
    run(sim, 8);
    expect(sim.speed).toBeGreaterThan(15);
    expect(sim.pos.z).toBeLessThan(-30); // heading 0 = north = -z
    expect(Math.abs(sim.pos.x)).toBeLessThan(3);
  });

  it('only the Nissan Patrol remains (U5) and it starts in 4H with the rear locker in', () => {
    expect(Object.keys(PRESETS).filter((k) => !k.startsWith('_'))).toEqual(['patrol']);
    const s = getSpec('patrol');
    expect(s.driveline.start).toEqual({ mode: '4H', rearLock: true });
    expect(s.steer.maxDeg).toBeGreaterThanOrEqual(45);
  });
});
