// Language (Arabic / English). Pure TS (no DOM required) so Node tests can import it: the browser bits are guarded.
// Text lives in src/config/strings.json; config files carry their own Arabic as <field>_ar (label_ar, title_ar…).
import strings from '../config/strings.json';

export type Lang = 'ar' | 'en';
export const LANG_KEY = 'wahiba.lang';
const TABLE = strings as unknown as Record<Lang, Record<string, string>>;

function stored(): Lang | null {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(LANG_KEY) : null;
    return v === 'ar' || v === 'en' ? v : null;
  } catch {
    return null;
  }
}

function fromUrl(): Lang | null {
  if (typeof location === 'undefined') return null;
  const v = new URLSearchParams(location.search).get('lang');
  return v === 'ar' || v === 'en' ? v : null;
}

// Browser default is Arabic (the game is set in Oman); Node (tests) defaults to English.
let lang: Lang = fromUrl() ?? stored() ?? (typeof document !== 'undefined' ? 'ar' : 'en');
const listeners: ((l: Lang) => void)[] = [];

export function getLang(): Lang {
  return lang;
}

/** True when a language was chosen before (URL or saved), i.e. the picker can be skipped by automation. */
export function langChosen(): boolean {
  return fromUrl() !== null || stored() !== null;
}

export function setLang(l: Lang): void {
  lang = l;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LANG_KEY, l);
  } catch {
    /* private mode: keep it for this session only */
  }
  applyDocLang();
  for (const f of listeners) f(l);
}

export function onLangChange(f: (l: Lang) => void): void {
  listeners.push(f);
}

/** Translate a key; {0}, {1}… are replaced by args. Missing keys fall back to English, then to the key itself. */
export function t(key: string, ...args: (string | number)[]): string {
  const s = TABLE[lang][key] ?? TABLE.en[key] ?? key;
  return args.length ? s.replace(/\{(\d+)\}/g, (m, i) => (args[+i] !== undefined ? String(args[+i]) : m)) : s;
}

/** Localised field of a config object: obj[field + '_ar'] in Arabic when present, else obj[field]. */
export function tf(obj: unknown, field: string): string {
  const o = obj as Record<string, unknown>;
  if (lang === 'ar' && typeof o[field + '_ar'] === 'string') return o[field + '_ar'] as string;
  return String(o[field] ?? '');
}

export function isRtl(): boolean {
  return lang === 'ar';
}

export function applyDocLang(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  document.documentElement.classList.toggle('rtl', lang === 'ar');
}
