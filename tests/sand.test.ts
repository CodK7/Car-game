import { describe, expect, it } from 'vitest';
import { contactArea, newWheelSink, staticSinkage, stepSink, crrHard } from '../src/sand/sink';
import { DeformGrid } from '../src/sand/deformGrid';

const LOAD = 6000; // N, one corner of a ~2.4 t vehicle

describe('sink model', () => {
  it('airing down enlarges the contact patch and lowers static sinkage on loose sand', () => {
    expect(contactArea(LOAD, 12)).toBeGreaterThan(contactArea(LOAD, 30) * 1.3);
    const z12 = staticSinkage(LOAD, 12, 1);
    const z30 = staticSinkage(LOAD, 30, 1);
    expect(z12).toBeLessThan(z30 * 0.8);
    expect(z30).toBeGreaterThan(0.01);
    expect(z30).toBeLessThan(0.25);
  });

  it('compacted sand barely sinks; loose sand sinks', () => {
    expect(staticSinkage(LOAD, 30, 0)).toBeLessThan(0.01);
    expect(staticSinkage(LOAD, 30, 1)).toBeGreaterThan(staticSinkage(LOAD, 30, 0) * 4);
  });

  it('sinkage grows with load', () => {
    expect(staticSinkage(9000, 20, 1)).toBeGreaterThan(staticSinkage(4000, 20, 1));
  });

  it('wheel spin at low speed on loose sand digs in until stuck; free rolling does not', () => {
    const spin = newWheelSink();
    for (let i = 0; i < 120 * 4; i++) stepSink(spin, { load: LOAD, slipSpeed: 6, groundSpeed: 0.1, pressurePsi: 30, loose: 1, width: 0.27, radius: 0.39 }, 1 / 120);
    expect(spin.dug).toBeGreaterThan(0.28);
    expect(spin.stuck).toBe(true);
    const roll = newWheelSink();
    for (let i = 0; i < 120 * 4; i++) stepSink(roll, { load: LOAD, slipSpeed: 0.1, groundSpeed: 8, pressurePsi: 30, loose: 1, width: 0.27, radius: 0.39 }, 1 / 120);
    expect(roll.dug).toBeLessThan(0.01);
    expect(roll.stuck).toBe(false);
  });

  it('spinning digs slower on compacted sand and with low pressure', () => {
    const run = (loose: number, psi: number) => {
      const s = newWheelSink();
      for (let i = 0; i < 120; i++) stepSink(s, { load: LOAD, slipSpeed: 4, groundSpeed: 0.2, pressurePsi: psi, loose, width: 0.27, radius: 0.39 }, 1 / 120);
      return s.dug;
    };
    expect(run(0.1, 30)).toBeLessThan(run(1, 30) * 0.1);
    expect(run(1, 12)).toBeLessThan(run(1, 30));
  });

  it('rolling resistance rises with sinkage and aired-down tyres roll harder on hard ground', () => {
    const shallow = newWheelSink();
    const deep = newWheelSink();
    stepSink(shallow, { load: LOAD, slipSpeed: 0, groundSpeed: 5, pressurePsi: 30, loose: 0, width: 0.27, radius: 0.39 }, 1);
    stepSink(deep, { load: LOAD, slipSpeed: 0, groundSpeed: 5, pressurePsi: 30, loose: 1, width: 0.27, radius: 0.39 }, 1);
    expect(deep.crr).toBeGreaterThan(shallow.crr * 3);
    expect(crrHard(12)).toBeGreaterThan(crrHard(32));
  });
});

describe('deformation grid', () => {
  it('stamps a groove with berms and roughly conserves volume', () => {
    const g = new DeformGrid(256, 32);
    g.follow(0, 0, true);
    g.stampGroove(-5, 0, 5, 0, 0.3, 0.08, 1);
    expect(g.heightAt(0, 0)).toBeCloseTo(-0.08, 2);
    const side = Math.max(g.heightAt(0, 0.22), g.heightAt(0, 0.25), g.heightAt(0, 0.28));
    expect(side).toBeGreaterThan(0.01);
    expect(g.heightAt(0, 2)).toBe(0);
    const v = g.volume();
    expect(v).toBeLessThan(0); // groove deeper than berms (sand is also compacted)
    expect(v).toBeGreaterThan(-0.08 * 0.3 * 10);
  });

  it('stamping twice at the same place does not deepen the groove (frame-rate independent)', () => {
    const g = new DeformGrid(128, 16);
    g.follow(0, 0, true);
    g.stampGroove(0, 0, 1, 0, 0.3, 0.05);
    const a = g.heightAt(0.5, 0);
    g.stampGroove(0, 0, 1, 0, 0.3, 0.05);
    expect(g.heightAt(0.5, 0)).toBeCloseTo(a, 6);
  });

  it('slumping softens walls steeper than the angle of repose', () => {
    const g = new DeformGrid(128, 8);
    g.follow(0, 0, true);
    g.dig(0, 0, 0.4, 0.3);
    const grad = () => {
      let m = 0;
      for (let x = -0.6; x <= 0.6; x += 0.0625) m = Math.max(m, Math.abs(g.heightAt(x + 0.03, 0.01) - g.heightAt(x - 0.03, 0.01)) / 0.06);
      return m;
    };
    const before = grad();
    for (let i = 0; i < 120; i++) g.relax(0, 0, 1 / 30);
    const after = grad();
    expect(after).toBeLessThan(before);
    expect(after).toBeLessThan(Math.tan((40 * Math.PI) / 180));
  });

  it('window follows the vehicle: old area is cleared, data near the vehicle is kept', () => {
    const g = new DeformGrid(128, 32);
    g.follow(0, 0, true);
    g.setAt(5, 5, -0.1);
    g.setAt(-14, 0, -0.2);
    g.follow(12, 0); // moves right by ~12 m
    expect(g.heightAt(5.125, 5.125)).not.toBe(0);
    expect(g.heightAt(-14, 0)).toBe(0); // left the window
    expect(g.centreX).toBeGreaterThan(8);
    expect(g.takeDirty().length).toBeGreaterThan(0);
  });
});
