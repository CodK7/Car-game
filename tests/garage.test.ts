// Garage parts: every option's declared effects really change the simulation spec (parts x effects table, written to
// tests/tmp/parts_table.md), presets stay untouched, and key parts change driving behaviour in the sim.
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildSpec, buildCost, peakPowerKW, SLOTS, SLOT_NAMES, Build } from '../src/game/garage';
import { getSpec, VehicleSim, VehicleSpec } from '../src/vehicle/vehicleSim';
import { PlaneGround } from '../src/world/terrainData';
import { SandGround } from '../src/sand/sandGround';

const DT = 1 / 120;
const get = (o: unknown, path: string): unknown => path.split('.').reduce((a: any, k) => a?.[k], o);

describe('garage parts', () => {
  it('each option changes exactly what it declares (parts x effects table)', () => {
    const rows: string[] = ['| Slot | Option | Price | Effect | patrol stock → fitted |', '|---|---|---|---|---|'];
    for (const slot of SLOT_NAMES) {
      for (const [id, opt] of Object.entries(SLOTS[slot].options)) {
        const base = buildSpec('patrol');
        const fit = buildSpec('patrol', { [slot]: id } as Build);
        if (!opt.effects.length) rows.push(`| ${SLOTS[slot].label} | ${opt.label} | ${opt.price} | — | — |`);
        for (const e of opt.effects) {
          const path = e.path.replace('*', 'rear');
          const a = get(base, path), b = get(fit, path);
          let shown: string;
          if (e.op === 'mul' || e.op === 'add') {
            const want = e.op === 'mul' ? (a as number) * (e.value as number) : (a as number) + (e.value as number);
            // several options of one slot never stack, but two effects may hit the same path (mul then add)
            const same = opt.effects.filter((x) => x.path === e.path).length === 1;
            if (same) expect(b as number).toBeCloseTo(want, 6);
            shown = `${+(a as number).toFixed(3)} → ${+(b as number).toFixed(3)}`;
          } else if (e.op === 'mulCurve') {
            const pa = peakPowerKW(base), pb = peakPowerKW(fit);
            expect(pb).toBeGreaterThan(pa);
            shown = `peak ${pa.toFixed(0)} kW → ${pb.toFixed(0)} kW`;
          } else {
            expect(b).toEqual(e.op === 'setIfNull' && a != null ? a : e.value);
            shown = `${JSON.stringify(a)} → ${JSON.stringify(b)}`;
          }
          rows.push(`| ${SLOTS[slot].label} | ${opt.label} | ${opt.price} | ${e.op} ${e.path} ${e.op === 'mulCurve' || e.op.startsWith('set') ? '' : e.value} | ${shown} |`);
        }
      }
    }
    mkdirSync('tests/tmp', { recursive: true });
    writeFileSync('tests/tmp/parts_table.md', rows.join('\n') + '\n');
  });

  it('presets stay untouched and cost adds up', () => {
    const before = JSON.stringify(getSpec('patrol'));
    buildSpec('patrol', { tyres: 'balloon', engine: 'turbo', load: 'full', suspension: 'longtravel' });
    expect(JSON.stringify(getSpec('patrol'))).toBe(before);
    expect(buildCost({ tyres: 'balloon', engine: 'turbo' })).toBe(900 + 5500);
  });

  it('turbo kit: patrol gains a turbo (lag + audio flutter) and > 20 % peak power', () => {
    const s = buildSpec('patrol', { engine: 'turbo' });
    expect(s.engine.turbo).not.toBeNull();
    expect(peakPowerKW(s) / peakPowerKW(getSpec('patrol'))).toBeGreaterThan(1.2);
    // LC70 already has a turbo: kept as is
    expect(buildSpec('lc70', { engine: 'turbo' }).engine.turbo).toEqual(getSpec('lc70').engine.turbo);
  });

  const climb = (spec: VehicleSpec, deg: number, psi: number, seconds: number, mode: '2H' | '4H' = '4H') => {
    const sim = new VehicleSim(spec, new SandGround(new PlaneGround(0, -Math.tan((deg * Math.PI) / 180), 1), null));
    sim.reset(0, 0, 0);
    sim.input.brake = 1;
    for (let i = 0; i < 120; i++) sim.step(DT);
    sim.mode = mode;
    sim.setPressure(psi);
    sim.input.brake = 0;
    sim.input.throttle = 1;
    for (let i = 0; i < seconds / DT; i++) sim.step(DT);
    return sim;
  };

  it('paddle tyres climb a loose slope further than highway tyres', () => {
    const hw = climb(buildSpec('patrol', { tyres: 'highway' }), 14, 22, 8, '2H');
    const pd = climb(buildSpec('patrol', { tyres: 'paddle' }), 14, 22, 8, '2H');
    const dh = -hw.pos.z, dp = -pd.pos.z;
    writeFileSync('tests/tmp/garage_climb.json', JSON.stringify({ highway_m: +dh.toFixed(1), paddle_m: +dp.toFixed(1) }));
    expect(dp).toBeGreaterThan(10); // paddles climb a loose 14 deg slope in 2H
    expect(dh).toBeLessThan(3); // highway tyres stall and slide back
  });

  it('full load climbs less far, the turbo kit further (loose 16-18 deg, 4H, 22 psi)', () => {
    const d = (b: Build, deg: number) => -climb(buildSpec('patrol', b), deg, 22, 8).pos.z;
    const empty = d({}, 18), full = d({ load: 'full' }, 18), stock16 = d({}, 16), turbo16 = d({ engine: 'turbo' }, 16);
    writeFileSync('tests/tmp/garage_load.json', JSON.stringify({ empty18_m: +empty.toFixed(1), full18_m: +full.toFixed(1), stock16_m: +stock16.toFixed(1), turbo16_m: +turbo16.toFixed(1) }));
    expect(full).toBeLessThan(empty * 0.85);
    expect(turbo16).toBeGreaterThan(stock16 * 1.15);
  });
});
