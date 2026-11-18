// Language table: every key exists in both languages with the same placeholders; config files carry Arabic labels.
import { afterAll, describe, expect, it } from 'vitest';
import strings from '../src/config/strings.json';
import vehicles from '../src/config/vehicles.json';
import missions from '../src/config/missions.json';
import parts from '../src/config/parts.json';
import recovery from '../src/config/recovery.json';
import { getLang, setLang, t, tf } from '../src/core/i18n';

const S = strings as unknown as Record<'en' | 'ar', Record<string, string>>;
const holes = (s: string) => (s.match(/\{\d+\}/g) ?? []).sort().join(',');

describe('i18n', () => {
  afterAll(() => setLang('en'));

  it('en and ar have the same keys and placeholders', () => {
    const en = Object.keys(S.en).sort(), ar = Object.keys(S.ar).sort();
    expect(ar).toEqual(en);
    for (const k of en) expect(holes(S.ar[k]), k).toBe(holes(S.en[k]));
  });

  it('t() fills placeholders and switches language', () => {
    expect(getLang()).toBe('en'); // Node default
    expect(t('ctl.noMode', '2H')).toContain('2H');
    setLang('ar');
    expect(t('start.go')).toBe(S.ar['start.go']);
    expect(t('no.such.key')).toBe('no.such.key');
    setLang('en');
  });

  it('every player-facing config entry has an Arabic label', () => {
    for (const [k, v] of Object.entries(vehicles as Record<string, any>)) if (!k.startsWith('_')) expect(v.name_ar, k).toBeTruthy();
    for (const m of (missions as any).missions ?? missions) expect(m.title_ar, m.id).toBeTruthy();
    for (const r of Object.values((recovery as any).ropes)) expect((r as any).label_ar).toBeTruthy();
    for (const slot of Object.values((parts as any).slots)) {
      expect((slot as any).label_ar).toBeTruthy();
      for (const o of Object.values((slot as any).options)) expect((o as any).label_ar).toBeTruthy();
    }
    setLang('ar');
    expect(tf({ name: 'A', name_ar: 'ب' }, 'name')).toBe('ب');
    expect(tf({ name: 'A' }, 'name')).toBe('A');
    setLang('en');
  });
});
