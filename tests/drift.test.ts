// Drift / hajwala setup: scripted handbrake-entry drift on flat asphalt and on loose sand.
// Metrics are written to tests/tmp/drift_metrics.json (stock-style setup vs the drift setup, assist on/off).
import { describe, expect, it, afterAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { getSpec, VehicleSim, VehicleSpec } from '../src/vehicle/vehicleSim';
import { PlaneGround } from '../src/world/terrainData';
import { DriveController } from '../src/game/driveController';

const DT = 1 / 120;
const metrics: Record<string, Record<string, number | boolean>> = {};

/** the pre-drift (W3) chassis numbers, for comparison */
function stockSetup(): VehicleSpec {
  const s = structuredClone(getSpec('patrol'));
  s.steer = { maxDeg: 33, speedReduce: 0.55 };
  s.susp.front.antiRoll = 26000;
  s.susp.rear.antiRoll = 12000;
  s.susp.rear.spring = 50000;
  s.brakes.handbrake = 2600;
  s.tyre.rearGrip = 1;
  return s;
}

interface Run { driftTime: number; maxAngle: number; spun: boolean; avgKmh: number; finite: boolean }

/**
 * 60 km/h straight, flick: full left lock + handbrake for 0.4 s, then full throttle holding light left steer for 5 s
 * (with assist: the controller adds counter-steer and eases the throttle past the target angle).
 * Drift = body slip angle > 15° while moving forward faster than 5 m/s. Spin = slip angle > 100°.
 */
function handbrakeDrift(spec: VehicleSpec, loose: number, assist: boolean, mode: '2H' | '4H' = '2H'): Run {
  const sim = new VehicleSim(spec, new PlaneGround(0, 0, loose, 0));
  sim.reset(0, 0, 0);
  sim.mode = mode;
  sim.rearLock = spec.driveline.rearLocker;
  const ctl = new DriveController();
  const r: Run = { driftTime: 0, maxAngle: 0, spun: false, avgKmh: 0, finite: true };
  let n = 0, sumV = 0;
  const target = loose > 0.5 ? 12 : 16.7;
  for (let i = 0; i < 20 / DT; i++) {
    const t = i * DT;
    const inp = sim.input;
    if (t < 9) {
      inp.throttle = sim.speed < target ? 1 : 0.2;
      inp.steer = 0;
      inp.handbrake = 0;
    } else if (t < 9.4) {
      inp.throttle = 0;
      inp.steer = -1;
      inp.handbrake = 1;
    } else if (t < 14.4) {
      inp.handbrake = 0;
      const c = { steer: -0.25, throttle: 1 };
      if (assist) ctl.assist(sim, c, DT);
      inp.steer = c.steer;
      inp.throttle = c.throttle;
    } else break;
    sim.step(DT);
    if (!Number.isFinite(sim.pos.x + sim.vel.x + sim.angVel.y)) {
      r.finite = false;
      break;
    }
    if (t >= 9) {
      const vLong = sim.vel.dot(sim.fwd), vLat = sim.vel.dot(sim.right);
      const ang = (Math.abs(Math.atan2(vLat, Math.abs(vLong))) * 180) / Math.PI;
      if (ang > 100 || vLong < -1) r.spun = true;
      if (!r.spun) {
        r.maxAngle = Math.max(r.maxAngle, ang);
        if (ang > 15 && vLong > 5) r.driftTime += DT;
      }
      sumV += Math.hypot(vLong, vLat);
      n++;
    }
  }
  r.avgKmh = n ? (sumV / n) * 3.6 : 0;
  r.driftTime = Math.round(r.driftTime * 100) / 100;
  r.maxAngle = Math.round(r.maxAngle * 10) / 10;
  r.avgKmh = Math.round(r.avgKmh * 10) / 10;
  return r;
}

describe('drift setup (Patrol VTC, hajwala)', () => {
  afterAll(() => {
    mkdirSync('tests/tmp', { recursive: true });
    writeFileSync('tests/tmp/drift_metrics.json', JSON.stringify(metrics, null, 2));
  });

  it('player car starts in 4H with the rear locker in (welded-diff style; 2H digs in at the dune spawn)', () => {
    const d = getSpec('patrol').driveline;
    expect(d.start?.mode).toBe('4H');
    expect(d.start?.rearLock).toBe(true);
  });

  it('asphalt: drift setup + assist holds a long drift without spinning; stock setup drifts less (with or without assist)', () => {
    const drift = handbrakeDrift(getSpec('patrol'), 0, true);
    const raw = handbrakeDrift(getSpec('patrol'), 0, false);
    const stock = handbrakeDrift(stockSetup(), 0, false);
    metrics['asphalt drift setup + assist'] = { ...drift };
    metrics['asphalt drift setup, no assist'] = { ...raw };
    metrics['asphalt stock setup, no assist'] = { ...stock };
    const stockAssist = handbrakeDrift(stockSetup(), 0, true);
    metrics['asphalt stock setup + assist'] = { ...stockAssist };
    expect(drift.finite && raw.finite && stock.finite).toBe(true);
    expect(drift.spun).toBe(false);
    expect(drift.driftTime).toBeGreaterThan(2.5);
    expect(drift.maxAngle).toBeGreaterThan(20);
    expect(drift.driftTime).toBeGreaterThan(stock.driftTime);
    expect(drift.driftTime).toBeGreaterThan(stockAssist.driftTime); // the chassis tune itself helps, not only the assist
  });

  it('loose sand: drift setup + assist slides without spinning or NaN (2H and the 4H start mode)', () => {
    const drift = handbrakeDrift(getSpec('patrol'), 1, true);
    const drift4 = handbrakeDrift(getSpec('patrol'), 1, true, '4H');
    metrics['sand drift setup + assist'] = { ...drift };
    metrics['sand 4H drift setup + assist'] = { ...drift4 };
    // 4H: the part-time transfer case ties the axles together, so a handbrake entry barely rotates the car;
    // it must stay stable (drifting is done in 2H, the start hint says so)
    expect(drift4.finite).toBe(true);
    expect(drift4.spun).toBe(false);
    expect(drift.finite).toBe(true);
    expect(drift.spun).toBe(false);
    expect(drift.driftTime).toBeGreaterThan(1);
  });
});
