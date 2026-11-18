import { describe, expect, it } from 'vitest';
import { getSpec, VehicleSim } from '../src/vehicle/vehicleSim';
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

  it('camry is front-wheel drive with 2H only; lc300 is full-time 4WD', () => {
    const cam = new VehicleSim(getSpec('camry'), new PlaneGround(0, 0, 0, 0));
    cam.reset(0, 0, 0);
    expect(cam.mode).toBe('2H');
    cam.mode = '4L';
    expect(cam.mode).toBe('2H'); // not available on this car
    run(cam, 1);
    cam.input.throttle = 1;
    run(cam, 3);
    const fr = cam.wheels.filter((w) => w.front), rr = cam.wheels.filter((w) => !w.front);
    const omega = (ws: typeof fr) => ws.reduce((a, w) => a + Math.abs(w.omega), 0) / ws.length;
    expect(cam.speed).toBeGreaterThan(10);
    // driven front wheels spin a little faster than the free-rolling rear ones under full throttle
    expect(omega(fr)).toBeGreaterThanOrEqual(omega(rr) * 0.999);
    const lc = new VehicleSim(getSpec('lc300'), new PlaneGround(0, 0, 0, 0));
    expect(lc.mode).toBe('4H');
    lc.mode = '2H';
    expect(lc.mode).toBe('4H');
    lc.mode = '4L';
    expect(lc.mode).toBe('4L');
  });

  it('new presets accelerate to plausible 0-100 km/h times', () => {
    for (const [k, lo, hi] of [['camry', 5.0, 8.5], ['lc300', 6.5, 12.5]] as [string, number, number][]) {
      const sim = new VehicleSim(getSpec(k), new PlaneGround(0, 0, 0, 0));
      sim.reset(0, 0, 0);
      run(sim, 1);
      sim.input.throttle = 1;
      let t = 0;
      while (sim.speed < 100 / 3.6 && t < 20) { run(sim, 0.05); t += 0.05; }
      expect(t, k).toBeGreaterThan(lo);
      expect(t, k).toBeLessThan(hi);
    }
  });
});
