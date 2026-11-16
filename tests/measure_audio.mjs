// W4 audio check in a real Edge window: audio starts after a click, binds to the vehicle, drive-by runs, no console
// errors; then the offline CPU benchmark of the full graph. Writes tests/tmp/audio_cost.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { startServer, launch, openGame } from './browser.mjs';

function writeWav(path, pcm, sr) {
  const b = Buffer.alloc(44 + pcm.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + pcm.length * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i++) b.writeInt16LE(pcm[i], 44 + i * 2);
  writeFileSync(path, b);
}
const server = await startServer();
const browser = await launch({ headless: false, width: 1280, height: 720 });
const out = {};
try {
  for (const veh of ['patrol', 'lc70']) {
    const { page, errors } = await openGame(browser, `${server.url}?veh=${veh}&autodrive&debug&quality=low`);
    await page.bringToFront();
    await page.mouse.click(640, 360);
    await new Promise((r) => setTimeout(r, 4000));
    const live = await page.evaluate(async () => {
      const au = window.__app.audio;
      const s = window.__app.drive.sim;
      const r = { state: au.ctx?.state, sampleRate: au.ctx?.sampleRate, baseLatency: au.ctx?.baseLatency, rpm: Math.round((s.engineOmega * 30) / Math.PI), kmh: +(s.speed * 3.6).toFixed(1), updateMs: +au.updateMs.toFixed(3) };
      au.driveBy = { t: 6 };
      await new Promise((res) => setTimeout(res, 2500));
      r.remotes = au.remotes.size;
      r.updateMsWithRemote = +au.updateMs.toFixed(3);
      return r;
    });
    out[veh] = live;
    if (veh === 'patrol') out.bench = await page.evaluate(() => window.__app.audio.benchmark(10));
    // 8 s listening demos (mono, 48 kHz): rev sweeps, lift-offs, limiter bounce, a remote V8 off to the side, tyre/wind beds
    const kind = veh === 'patrol' ? 'I6' : 'V8';
    const demo = await page.evaluate((k) => window.__app.audio.benchmark(8, k, true), kind);
    writeWav(`docs/evidence/w4_demo_${kind}.wav`, demo.pcm, 48000);
    out[veh].demo = { peak: demo.peak, clickRatio: demo.clickRatio };
    out[veh].errors = errors.slice();
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
mkdirSync('tests/tmp', { recursive: true });
writeFileSync('tests/tmp/audio_cost.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
