// URL parameters: every runtime switch is reachable from the address bar.
// Example: /?debug&quality=low&tod=17.2&mode=fly&veh=lc70&x=0&z=0
const q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const num = (k: string): number | undefined => {
  const v = q.get(k);
  if (v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export type QualityName = 'low' | 'medium' | 'high' | 'auto';

export const P = {
  debug: q.has('debug'),
  quality: (q.get('quality') ?? 'auto') as QualityName,
  tod: num('tod'),
  mode: q.get('mode') ?? 'drive', // drive | fly | sandtest
  veh: q.get('veh') ?? '',
  seed: num('seed'),
  x: num('x'),
  z: num('z'),
  heading: num('heading'),
  bench: num('bench'), // seconds: run an automatic benchmark and publish window.__bench
  scale: num('scale'), // render-scale override
  mute: q.has('mute'),
  mp: q.get('mp') ?? '', // multiplayer server url, e.g. ws://localhost:8787
  name: q.get('name') ?? '',
  lag: num('lag') ?? 0, // simulated latency (ms), multiplayer testing
  loss: num('loss') ?? 0, // simulated packet loss 0..1
  deform: q.get('deform') ?? '', // deformation resolution override for benchmarking
  auto: q.has('autodrive'), // hold throttle automatically (for automated checks)
  nosave: q.has('nosave'),
  raw: q,
};
