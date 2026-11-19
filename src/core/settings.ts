// Player settings (gear button): quality preset, FPS limit, resolution, FPS counter, touch controls.
// Pure TS with an injectable storage (like save.ts) so Vitest can run it in Node; browser bits are guarded.
import cfg from '../config/settings.json';
import type { QualityName } from './params';

export type TouchMode = 'auto' | 'on' | 'off';
export interface Settings {
  quality: QualityName;
  /** frames per second limit, 0 = no limit (display refresh rate) */
  fpsCap: number;
  /** render scale override, 0 = the quality preset's own renderScale */
  scale: number;
  showFps: boolean;
  touch: TouchMode;
}

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }
export const SETTINGS_KEY = 'wahiba.settings.v1';
export const FPS_OPTIONS: number[] = cfg.fpsOptions;
export const SCALE = cfg.scale;
export const TOUCH_CFG = cfg.touch;

/** Phones and tablets: a coarse primary pointer, or an iPad that reports itself as a Mac. */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const iPadOS = /Macintosh/.test(navigator.userAgent) && (navigator.maxTouchPoints ?? 0) > 1;
  return coarse || iPadOS || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export function defaultSettings(mobile = isMobileDevice()): Settings {
  return { ...(mobile ? cfg.defaults.mobile : cfg.defaults.desktop) } as Settings;
}

export function maxDpr(mobile = isMobileDevice()): number {
  return mobile ? cfg.maxDpr.mobile : cfg.maxDpr.desktop;
}

/** Clamp/repair any stored or edited settings object. */
export function sanitize(s: Partial<Settings>, base: Settings = defaultSettings()): Settings {
  const out = { ...base };
  if (s.quality && ['auto', 'low', 'medium', 'high'].includes(s.quality)) out.quality = s.quality;
  if (typeof s.fpsCap === 'number' && Number.isFinite(s.fpsCap)) out.fpsCap = s.fpsCap <= 0 ? 0 : Math.min(Math.max(Math.round(s.fpsCap), 15), 240);
  if (typeof s.scale === 'number' && Number.isFinite(s.scale)) out.scale = s.scale <= 0 ? 0 : Math.min(Math.max(s.scale, SCALE.min), SCALE.max);
  if (typeof s.showFps === 'boolean') out.showFps = s.showFps;
  if (s.touch && ['auto', 'on', 'off'].includes(s.touch)) out.touch = s.touch;
  return out;
}

function storage(): KV | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadSettings(kv: KV | null = storage(), base: Settings = defaultSettings()): Settings {
  try {
    const raw = kv?.getItem(SETTINGS_KEY);
    return raw ? sanitize(JSON.parse(raw), base) : { ...base };
  } catch {
    return { ...base };
  }
}

export function writeSettings(s: Settings, kv: KV | null = storage()): boolean {
  try {
    kv?.setItem(SETTINGS_KEY, JSON.stringify(s));
    return !!kv;
  } catch {
    return false;
  }
}

/**
 * Frame limiter for a requestAnimationFrame loop: tick(now) says whether this callback should render.
 * Keeps the phase (no drift), so e.g. 45 FPS on a 60 Hz display renders 3 of every 4 callbacks.
 */
export class FrameLimiter {
  cap = 0;
  private then = -1;

  tick(now: number): boolean {
    if (this.cap <= 0) {
      this.then = now;
      return true;
    }
    const interval = 1000 / this.cap;
    if (this.then < 0) {
      this.then = now;
      return true;
    }
    const elapsed = now - this.then;
    // 1 ms tolerance so a 60 Hz display (16.67 ms) is not skipped by a 60 FPS cap because of timer jitter
    if (elapsed < interval - 1) return false;
    let rem = elapsed % interval;
    if (rem > interval - 1) rem -= interval; // landed just early (inside the tolerance): carry a tiny negative remainder
    this.then = elapsed > interval * 3 ? now : now - rem;
    return true;
  }
}
