// Vehicle + sand integration: digging in, airing down, and the CPU cost of the deformation grid.
import { describe, expect, it } from 'vitest';
import { DataUtils } from 'three';
import { getSpec, VehicleSim } from '../src/vehicle/vehicleSim';
import { PlaneGround } from '../src/world/terrainData';
import { DeformGrid } from '../src/sand/deformGrid';
import { SandGround } from '../src/sand/sandGround';
import { writeFileSync, mkdirSync } from 'node:fs';

const DT = 1 / 120;

function makeSim(slopeDeg: number, loose: number, deform = true): VehicleSim {
  // slope rises towards -z (north) so heading 0 drives uphill
  const base = new PlaneGround(0, -Math.tan((slopeDeg * Math.PI) / 180), loose);
  const grid = deform ? new DeformGrid(512, 64) : null;
  grid?.follow(0, 0, true);
  const sim = new VehicleSim(getSpec('patrol'), new SandGround(base, grid));
  sim.deform = grid;
  sim.reset(0, 0, 0);
  return sim;
}

function run(sim: VehicleSim, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) {
    sim.step(DT);
    sim.deform?.follow(sim.pos.x, sim.pos.z);
    sim.deform?.relax(sim.pos.x, sim.pos.z, DT);
    if (!Number.isFinite(sim.pos.x + sim.pos.y + sim.vel.x)) throw new Error('NaN at ' + i);
  }
}

describe('vehicle on sand', () => {
  const launch = (deg: number, loose: number, mode: '2H' | '4H', psi: number, seconds: number) => {
    const sim = makeSim(deg, loose);
    sim.input.brake = 1;
    run(sim, 1);
    sim.mode = mode;
    sim.gear = 1;
    sim.setPressure(psi);
    sim.input.brake = 0;
    sim.input.throttle = 1;
    run(sim, seconds);
    return sim;
  };

  it('full throttle in 2H at 40 psi up a loose 8 deg slope digs itself in (beached)', () => {
    const sim = launch(8, 1, '2H', 40, 12);
    expect(Math.max(...sim.wheels.map((w) => w.sink.depth))).toBeGreaterThan(0.28);
    expect(sim.beached).toBe(true);
    expect(Math.abs(sim.speed)).toBeLessThan(1);
  });

  it('aired down to 15 psi in 4H the same car climbs the same slope', () => {
    const sim = launch(8, 1, '4H', 15, 12);
    expect(sim.beached).toBe(false);
    expect(sim.pos.z).toBeLessThan(-15);
  });

  it('on compacted sand a 20 deg slope is climbable in 4H', () => {
    const sim = launch(20, 0, '4H', 32, 8);
    expect(sim.beached).toBe(false);
    expect(sim.pos.z).toBeLessThan(-20);
  });

  it('leaves ruts in the deformation grid', () => {
    const sim = makeSim(0, 1);
    run(sim, 1);
    sim.input.throttle = 0.5;
    run(sim, 4);
    const g = sim.deform!;
    const rl = sim.wheels[2];
    // a point behind the rear-left wheel along its path
    const h = g.heightAt(rl.point.x, rl.point.z + 3);
    expect(h).toBeLessThan(-0.01);
  });
});

describe('deformation grid cost (CPU, per 60 Hz frame)', () => {
  it('stays well inside the frame budget at 512/1024/2048', () => {
    const lines: string[] = [];
    for (const n of [512, 1024, 2048]) {
      const size = n * 0.0625 + 48;
      const g = new DeformGrid(n, size);
      g.follow(0, 0, true);
      g.takeDirty();
      const frames = 240;
      let x = 0;
      const half = new Uint16Array(64 * 64 * 2);
      const t0 = performance.now();
      for (let f = 0; f < frames; f++) {
        // 4 wheels, 2 physics steps per frame, 10 m/s
        for (let s = 0; s < 2; s++) {
          for (let w = 0; w < 4; w++) {
            const wx = x + (w % 2 ? 0.8 : -0.8), wz = w < 2 ? -1.5 : 1.5;
            g.stampGroove(wx, wz - 0.1, wx, wz + 0.1, 0.28, 0.08, 1);
          }
          x += 10 * DT;
        }
        g.follow(x, 0);
        g.relax(x, 0, 1 / 60);
        // pack dirty rects to half floats (what DeformTexture.upload does before texSubImage2D)
        for (const r of g.takeDirty()) {
          const cnt = Math.min((r.x1 - r.x0) * (r.z1 - r.z0), 64 * 64);
          for (let i = 0; i < cnt; i++) {
            half[i * 2] = DataUtils.toHalfFloat(g.h[i]);
            half[i * 2 + 1] = DataUtils.toHalfFloat(g.d[i]);
          }
        }
      }
      const ms = (performance.now() - t0) / frames;
      lines.push(`n=${n} size=${size}m cell=${((size / n) * 100).toFixed(1)}cm cpu=${ms.toFixed(3)}ms/frame mem=${((n * n * 8) / 1048576).toFixed(1)}MB(cpu)+${((n * n * 4) / 1048576).toFixed(1)}MB(gpu)`);
      expect(ms).toBeLessThan(4);
    }
    mkdirSync('tests/tmp', { recursive: true });
    writeFileSync('tests/tmp/deform_cost.txt', lines.join('\n') + '\n');
  });
});
