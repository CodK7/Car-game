// Procedural engine DSP: firing rate follows rpm and cylinder count, V8 banks fire unevenly (I6 banks evenly),
// no clicks on abrupt control changes, limiter cut silences combustion, output stays finite and bounded.
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import audio from '../src/config/audio.json';
import { EngineDsp, EngineCfg } from '../src/audio/engineDsp';

const SR = 48000;
const mk = (kind: 'I6' | 'V8') => new EngineDsp(audio.engines[kind] as unknown as EngineCfg, audio.turbo, SR, 99);
function render(d: EngineDsp, seconds: number, each?: (t: number) => void) {
  const n = Math.round(seconds * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const blk = 128;
  const bl = new Float32Array(blk), br = new Float32Array(blk);
  for (let o = 0; o < n; o += blk) {
    each?.(o / SR);
    d.process(bl, br, blk);
    L.set(bl.subarray(0, Math.min(blk, n - o)), o);
    R.set(br.subarray(0, Math.min(blk, n - o)), o);
  }
  return { L, R };
}
const rms = (a: Float32Array, i0 = 0, i1 = a.length) => {
  let s = 0;
  for (let i = i0; i < i1; i++) s += a[i] * a[i];
  return Math.sqrt(s / (i1 - i0));
};
/** largest sample-to-sample jump relative to the signal's own typical jump (a click shows up as an outlier) */
function clickRatio(a: Float32Array): number {
  let mx = 0, sum = 0;
  for (let i = 1; i < a.length; i++) {
    const d = Math.abs(a[i] - a[i - 1]);
    mx = Math.max(mx, d);
    sum += d;
  }
  return mx / (sum / (a.length - 1));
}
const out: Record<string, number | string> = {};

describe('engine DSP', () => {
  for (const kind of ['I6', 'V8'] as const) {
    it(`${kind}: firings per second = rpm/120 * cylinders`, () => {
      const d = mk(kind);
      d.set({ rpm: 3000, load: 0.5, throttle: 0.5, redline: 5500 });
      render(d, 0.5);
      const f0 = d.firings;
      render(d, 2);
      const rate = (d.firings - f0) / 2;
      const cyl = audio.engines[kind].cylinders;
      expect(rate).toBeGreaterThan((3000 / 120) * cyl * 0.97);
      expect(rate).toBeLessThan((3000 / 120) * cyl * 1.03);
    });
  }

  it('V8 cross-plane banks fire unevenly; I6 banks fire evenly', () => {
    const spread = (kind: 'I6' | 'V8') => {
      const d = mk(kind);
      d.set({ rpm: 2400, load: 0.5, throttle: 0.5 });
      render(d, 0.3);
      d.log = [];
      render(d, 0.5);
      const t0 = d.log.filter((e) => e[1] === 0).map((e) => e[0]);
      const gaps = t0.slice(1).map((t, i) => t - t0[i]);
      const mn = Math.min(...gaps), mx = Math.max(...gaps);
      return mx / mn;
    };
    const v8 = spread('V8'), i6 = spread('I6');
    out['bank-A gap max/min V8'] = +v8.toFixed(2);
    out['bank-A gap max/min I6'] = +i6.toFixed(2);
    expect(v8).toBeGreaterThan(2.5); // 90 / 180 / 270 deg pattern
    expect(i6).toBeLessThan(1.1); // even 240 deg per bank
  });

  it('abrupt control changes do not click, output finite and bounded', () => {
    for (const kind of ['I6', 'V8'] as const) {
      const d = mk(kind);
      d.set({ turbo: true, flutter: 1, redline: kind === 'I6' ? 5400 : 3800 });
      const { L } = render(d, 4, (t) => {
        // step changes every 0.25 s: idle <-> redline, throttle on/off, limiter cut on/off
        const k = Math.floor(t * 4);
        d.set({ rpm: k % 2 ? 5200 : 800, throttle: k % 3 ? 1 : 0, load: k % 3 ? 1 : 0, boost: k % 2, cut: k % 5 === 3 });
      });
      let peak = 0, finite = true;
      for (const x of L) {
        if (!Number.isFinite(x)) finite = false;
        peak = Math.max(peak, Math.abs(x));
      }
      const cr = clickRatio(L);
      out[`${kind} peak`] = +peak.toFixed(3);
      out[`${kind} click ratio (max jump / mean jump)`] = +cr.toFixed(1);
      expect(finite).toBe(true);
      expect(peak).toBeLessThan(1);
      expect(cr).toBeLessThan(40);
    }
  });

  it('limiter cut removes combustion pulses (much quieter) and louder under load', () => {
    const d = mk('I6');
    d.set({ rpm: 5500, throttle: 1, load: 1, layers: { intake: 0, mech: 0, pops: 0 } });
    const on = render(d, 0.6).L;
    d.set({ cut: true });
    render(d, 0.1);
    const cut = render(d, 0.4).L;
    const a = rms(on, SR * 0.2), b = rms(cut);
    out['limiter cut rms ratio'] = +(b / a).toFixed(3);
    expect(b).toBeLessThan(a * 0.25);
    const e = mk('I6');
    e.set({ rpm: 2500, throttle: 0.05, load: 0.05 });
    const lo = rms(render(e, 0.8).L, SR * 0.3);
    e.set({ throttle: 1, load: 1 });
    const hi = rms(render(e, 0.8).L, SR * 0.3);
    expect(hi).toBeGreaterThan(lo * 1.8);
  });

  it('blow-off flutter fires on a sharp lift with boost, not without a turbo', () => {
    const lift = (turbo: boolean) => {
      const d = mk('V8');
      d.set({ rpm: 3200, throttle: 1, load: 1, boost: 1, turbo, flutter: 1, layers: { pulses: 0, intake: 0, mech: 0, pops: 0 } });
      render(d, 1);
      d.set({ throttle: 0, load: 0, boost: 0.9 });
      return rms(render(d, 0.4).L);
    };
    const withT = lift(true), without = lift(false);
    expect(withT).toBeGreaterThan(without * 5 + 1e-4);
  });

  it('DSP cost: real-time factor in Node', () => {
    const d = mk('V8');
    d.set({ rpm: 3000, throttle: 0.7, load: 0.7, boost: 0.8, turbo: true });
    const t0 = performance.now();
    render(d, 5);
    const ms = performance.now() - t0;
    out['Node DSP: ms per second of V8 audio'] = +(ms / 5).toFixed(2);
    expect(ms / 5).toBeLessThan(150); // < 15 % of one core
    mkdirSync('tests/tmp', { recursive: true });
    writeFileSync('tests/tmp/audio_dsp.json', JSON.stringify(out, null, 1));
  });
});
