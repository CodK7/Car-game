// W3 vehicle metrics: top speed, 0-100, braking, 4L climb, pressure vs sinkage, side slope, lockers, heat soak, stability.
// Every measured number is also written to tests/tmp/w3_metrics.json (copied into docs/PROGRESS.md).
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { getSpec, VehicleSim, SimGround } from '../src/vehicle/vehicleSim';
import { PlaneGround } from '../src/world/terrainData';
import { DeformGrid } from '../src/sand/deformGrid';
import { SandGround } from '../src/sand/sandGround';

const DT = 1 / 120;
const metrics: Record<string, Record<string, number | string>> = { patrol: {}, lc70: {} };
const rec = (veh: string, k: string, v: number | string) => (metrics[veh][k] = typeof v === 'number' ? +v.toFixed(2) : v);

function sim(veh: string, ground: SimGround, heading = 0): VehicleSim {
  const s = new VehicleSim(getSpec(veh), ground);
  s.reset(0, 0, heading);
  return s;
}
function run(s: VehicleSim, seconds: number, each?: (t: number) => boolean | void): number {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    s.step(DT);
    if (s.deform) {
      s.deform.follow(s.pos.x, s.pos.z);
      s.deform.relax(s.pos.x, s.pos.z, DT);
    }
    if (!Number.isFinite(s.pos.x + s.pos.y + s.pos.z + s.vel.x + s.angVel.x + s.engineOmega)) throw new Error('NaN at step ' + i);
    if (each && each(i * DT) === true) return i * DT;
  }
  return seconds;
}
const flat = () => new PlaneGround(0, 0, 0);

for (const veh of ['patrol', 'lc70']) {
  describe(`${veh} metrics`, () => {
    it('0-100 km/h and top speed on flat hard ground (auto, 2H)', () => {
      const s = sim(veh, flat());
      s.mode = '2H';
      s.input.brake = 1;
      run(s, 1);
      s.input.brake = 0;
      s.input.throttle = 1;
      let t100 = -1;
      let top = 0;
      run(s, 120, (t) => {
        const kmh = s.speed * 3.6;
        if (t100 < 0 && kmh >= 100) t100 = t;
        top = Math.max(top, kmh);
      });
      rec(veh, '0-100 km/h (s)', t100);
      rec(veh, 'top speed (km/h)', top);
      expect(t100).toBeGreaterThan(7);
      expect(t100).toBeLessThan(17);
      expect(top).toBeGreaterThan(140);
      expect(top).toBeLessThan(200);
      expect(s.up.y).toBeGreaterThan(0.99);
    });

    it('braking 100-0 km/h on flat hard ground stops straight in 35-55 m', () => {
      const s = sim(veh, flat());
      s.mode = '2H';
      s.vel.set(0, 0, -100 / 3.6);
      for (const w of s.wheels) w.omega = 100 / 3.6 / w.radius;
      s.gear = 4;
      run(s, 0.6);
      const z0 = s.pos.z, x0 = s.pos.x;
      s.input.brake = 1;
      const t = run(s, 10, () => s.speed < 0.05);
      const dist = Math.hypot(s.pos.z - z0, s.pos.x - x0);
      rec(veh, 'braking 100-0 (m)', dist);
      rec(veh, 'braking 100-0 (s)', t);
      expect(dist).toBeGreaterThan(35);
      expect(dist).toBeLessThan(55);
      expect(Math.abs(s.pos.x - x0)).toBeLessThan(1);
    });

    it('4L climbs a 30 deg compacted slope from standstill; 2H does not', () => {
      const slope = () => new PlaneGround(0, -Math.tan((30 * Math.PI) / 180), 0);
      const climb = (mode: '2H' | '4L') => {
        const s = sim(veh, slope());
        s.input.brake = 1;
        run(s, 1);
        s.mode = mode;
        s.input.brake = 0;
        s.input.throttle = mode === '4L' ? 0.8 : 1;
        run(s, 15);
        return s;
      };
      const lo = climb('4L');
      const hi = climb('2H');
      rec(veh, '4L climb 30° in 15 s (m)', -lo.pos.z);
      rec(veh, '2H climb 30° in 15 s (m)', -hi.pos.z);
      expect(-lo.pos.z).toBeGreaterThan(15); // 4L first gear is a crawl (~5 km/h at the converter stall speed)
      expect(-hi.pos.z).toBeLessThan(-lo.pos.z * 0.5);
    });

    it('airing down reduces sinkage on loose sand and lengthens the contact patch', () => {
      const at = (psi: number) => {
        const g = new DeformGrid(512, 64);
        g.follow(0, 0, true);
        const s = sim(veh, new SandGround(new PlaneGround(0, 0, 1), g));
        s.deform = g;
        s.setPressure(psi);
        s.input.throttle = 0.45;
        let sum = 0, n = 0;
        run(s, 8, (t) => {
          if (t > 4) {
            sum += s.wheels.reduce((a, w) => a + w.sink.depth, 0) / 4;
            n++;
          }
        });
        return { sink: sum / n, patch: s.wheels[2].tyre.patchLen, speed: s.speed };
      };
      const p12 = at(12), p35 = at(35);
      rec(veh, 'sinkage rolling 12 psi (cm)', p12.sink * 100);
      rec(veh, 'sinkage rolling 35 psi (cm)', p35.sink * 100);
      rec(veh, 'patch length 12 / 35 psi (cm)', `${(p12.patch * 100).toFixed(0)} / ${(p35.patch * 100).toFixed(0)}`);
      expect(p12.sink).toBeLessThan(p35.sink * 0.8);
      expect(p12.patch).toBeGreaterThan(p35.patch * 1.3);
    });

    it('parked across a 30 deg slope stays upright and holds; tilt-table rollover angle is plausible', () => {
      const s = sim(veh, new PlaneGround(Math.tan((30 * Math.PI) / 180), 0, 0));
      s.input.brake = 1;
      s.gear = 0;
      run(s, 4);
      expect(s.up.y).toBeGreaterThan(0.8);
      expect(s.vel.length()).toBeLessThan(0.05);
      // tilt table: raise the side slope until the uphill wheels unload
      let tip = 0;
      for (let deg = 30; deg <= 60; deg += 1) {
        const t = sim(veh, new PlaneGround(Math.tan((deg * Math.PI) / 180), 0, 0));
        t.input.brake = 1;
        t.gear = 0;
        run(t, 2.5);
        const uphill = t.wheels[0].load + t.wheels[2].load; // left wheels are uphill (slope rises to +x? check sign)
        const downhill = t.wheels[1].load + t.wheels[3].load;
        if (Math.min(uphill, downhill) < 200 || t.up.y < Math.cos(((deg + 8) * Math.PI) / 180)) {
          tip = deg;
          break;
        }
      }
      const ssf = (s.spec.trackF + s.spec.trackR) / 4 / s.spec.cgHeight;
      rec(veh, 'tilt-table rollover (deg)', tip);
      rec(veh, 'static stability factor → angle (deg)', (Math.atan(ssf) * 180) / Math.PI);
      expect(tip).toBeGreaterThan(35);
      expect(tip).toBeLessThan(55);
    });

    it('drives across a 20 deg side slope at 20 km/h without rolling, sliding gently', () => {
      const s = sim(veh, new PlaneGround(Math.tan((20 * Math.PI) / 180), 0, 0.4));
      s.mode = '4H';
      s.vel.set(0, 0, -20 / 3.6);
      for (const w of s.wheels) w.omega = 20 / 3.6 / w.radius;
      let minUp = 1;
      run(s, 8, () => {
        s.input.throttle = s.speed * 3.6 < 20 ? 0.5 : 0.1;
        minUp = Math.min(minUp, s.up.y);
      });
      rec(veh, 'side slope 20° @20 km/h: drift (m / 8 s)', Math.abs(s.pos.x));
      expect(minUp).toBeGreaterThan(0.85);
      expect(Math.abs(s.pos.x)).toBeLessThan(8);
    });
  });
}

describe('driveline and stability', () => {
  // ground with a pit under the rear-right wheel (cross-axle situation)
  const pit: SimGround = {
    heightAt: (x, z) => (x > 0.35 && z > 0.6 && z < 5 ? -1.2 : 0),
    looseAt: () => 0,
  };
  it('open rear diff spins the unloaded wheel; the rear locker drives out (2H)', () => {
    const go = (lock: boolean) => {
      const s = sim('lc70', pit);
      s.mode = '2H';
      s.rearLock = lock;
      run(s, 1.5);
      s.input.throttle = 0.5;
      run(s, 5);
      return { dist: -s.pos.z, spinRR: Math.abs(s.wheels[3].omega) };
    };
    const open = go(false), locked = go(true);
    metrics.lc70['cross-axle 2H open diff (m)'] = +open.dist.toFixed(2);
    metrics.lc70['cross-axle 2H rear locker (m)'] = +locked.dist.toFixed(2);
    expect(open.dist).toBeLessThan(0.6);
    expect(locked.dist).toBeGreaterThan(1.5);
  });

  it('heat soak: a long full-load climb raises coolant temperature and reduces power', () => {
    const s = sim('patrol', new PlaneGround(0, -Math.tan((12 * Math.PI) / 180), 0.6));
    s.mode = '4H';
    s.input.throttle = 1;
    run(s, 150);
    metrics.patrol['coolant after 150 s full-load 12° climb (°C)'] = +s.engineTempC.toFixed(0);
    metrics.patrol['power factor after the climb'] = +s.powerFactor.toFixed(2);
    expect(s.engineTempC).toBeGreaterThan(105);
    expect(s.powerFactor).toBeLessThan(0.95);
    const c = sim('patrol', flat());
    c.input.throttle = 0.3;
    run(c, 150);
    expect(c.powerFactor).toBeGreaterThan(0.99);
  });

  it('survives 60 s of random inputs on rolling dunes without NaN or flips at low speed', () => {
    const dunes: SimGround = {
      heightAt: (x, z) => 4 * Math.sin(x * 0.05) * Math.cos(z * 0.04) + 0.6 * Math.sin(x * 0.31 + z * 0.17),
      looseAt: () => 0.7,
    };
    const s = sim('patrol', dunes);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let minUp = 1;
    run(s, 60, (t) => {
      if (Math.round(t * 120) % 120 === 0) {
        s.input.throttle = rnd();
        s.input.steer = rnd() * 2 - 1;
        s.input.brake = rnd() < 0.15 ? 1 : 0;
      }
      if (s.speed * 3.6 > 40) s.input.throttle = 0;
      minUp = Math.min(minUp, s.up.y);
    });
    metrics.patrol['random-drive 60 s min up.y'] = +minUp.toFixed(2);
    expect(minUp).toBeGreaterThan(0.5);
  });
});

afterAll(() => {
  mkdirSync('tests/tmp', { recursive: true });
  writeFileSync('tests/tmp/w3_metrics.json', JSON.stringify(metrics, null, 1));
});
