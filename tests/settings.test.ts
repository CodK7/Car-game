// Player settings: frame limiter pacing, sanitising, save/load round trip, quality manager scale override.
import { describe, expect, it } from 'vitest';
import { FrameLimiter, sanitize, loadSettings, writeSettings, defaultSettings, SETTINGS_KEY, KV } from '../src/core/settings';
import { QualityManager } from '../src/gfx/quality';
import presets from '../src/config/quality.json';

/** count rendered frames over `seconds` of a display refreshing at `hz` (with ±0.3 ms jitter) */
function rendered(cap: number, hz: number, seconds = 10): number {
  const l = new FrameLimiter();
  l.cap = cap;
  let n = 0;
  const frames = Math.round(hz * seconds);
  for (let i = 0; i < frames; i++) if (l.tick((i * 1000) / hz + Math.sin(i * 12.9898) * 0.3)) n++;
  return n / seconds;
}

describe('FrameLimiter', () => {
  it('no cap renders every refresh', () => {
    expect(rendered(0, 60)).toBeCloseTo(60, 0);
    expect(rendered(0, 144)).toBeCloseTo(144, 0);
  });
  it('caps at the requested rate without drift', () => {
    expect(Math.abs(rendered(30, 60) - 30)).toBeLessThan(0.6);
    expect(Math.abs(rendered(45, 60) - 45)).toBeLessThan(0.6);
    expect(Math.abs(rendered(60, 144) - 60)).toBeLessThan(1);
    expect(Math.abs(rendered(30, 120) - 30)).toBeLessThan(0.6);
  });
  it('a cap at or above the refresh rate does not drop frames', () => {
    expect(rendered(60, 60)).toBeGreaterThan(59.4);
    expect(rendered(120, 60)).toBeGreaterThan(59.4);
  });
});

describe('settings', () => {
  it('sanitize clamps bad values and keeps good ones', () => {
    const base = defaultSettings(false);
    const s = sanitize({ quality: 'insane' as any, fpsCap: 5, scale: 9, showFps: 'yes' as any, touch: 'on' }, base);
    expect(s.quality).toBe(base.quality);
    expect(s.fpsCap).toBe(15);
    expect(s.scale).toBe(2);
    expect(s.showFps).toBe(base.showFps);
    expect(s.touch).toBe('on');
    expect(sanitize({ fpsCap: -1, scale: 0 }, base)).toMatchObject({ fpsCap: 0, scale: 0 });
    expect(sanitize({ quality: 'legendary' }, base).quality).toBe('legendary');
  });
  it('mobile defaults are lighter than desktop', () => {
    const m = defaultSettings(true), d = defaultSettings(false);
    expect(m.quality).toBe('low');
    expect(m.fpsCap).toBeGreaterThan(0);
    expect(d.fpsCap).toBe(0);
  });
  it('save/load round trip and corrupt data fallback', () => {
    const mem = new Map<string, string>();
    const kv: KV = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) };
    const base = defaultSettings(false);
    expect(loadSettings(kv, base)).toEqual(base);
    writeSettings({ ...base, fpsCap: 45, scale: 0.7, quality: 'medium' }, kv);
    expect(loadSettings(kv, base)).toMatchObject({ fpsCap: 45, scale: 0.7, quality: 'medium' });
    mem.set(SETTINGS_KEY, '{not json');
    expect(loadSettings(kv, base)).toEqual(base);
  });
});

describe('QualityManager settings hooks', () => {
  it('scale override survives preset changes; 0 returns to the preset value', () => {
    const q = new QualityManager('low', 0.5);
    expect(q.q.renderScale).toBe(0.5);
    q.set('high');
    expect(q.q.renderScale).toBe(0.5);
    q.setScale(0);
    expect(q.q.renderScale).toBe(presets.high.renderScale);
  });
  it('setMode switches between auto and a fixed preset', () => {
    const q = new QualityManager('auto');
    expect(q.auto).toBe(true);
    q.setMode('medium');
    expect(q.auto).toBe(false);
    expect(q.name).toBe('medium');
    q.setMode('auto');
    expect(q.auto).toBe(true);
    expect(q.name).toBe('medium');
  });
});
