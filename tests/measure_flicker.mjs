// Temporal stability check (W5): static parked vehicle, static chase camera, shadows + post on, shimmer off.
// Takes consecutive frames and reports how many pixels change by more than a threshold (flicker / popping).
// Wind streaks on dune crests animate by design, so a small changed fraction is expected; shadow flicker would show
// up as large blocks along shadow edges. Usage: node tests/measure_flicker.mjs [quality]
import { mkdirSync, writeFileSync } from 'node:fs';
import { startServer, launch, openGame } from './browser.mjs';

const quality = process.argv[2] ?? 'medium';
const extra = process.argv[3] ?? '';
const server = await startServer();
const browser = await launch({ headless: false, width: 1280, height: 720 });
const result = { quality, frames: [] };
try {
  const { page, errors } = await openGame(browser, `${server.url}?quality=${quality}&veh=patrol&mute${extra}`);
  await page.bringToFront();
  await page.evaluate(() => {
    const a = window.__app;
    a.manual = false;
    a.tod.hour = 16.6;
    a.tod.speed = 0;
    a.drive.cam.orbitHold = true;
    a.drive.sim.input.brake = 1;
    a.drive.cam.yawOff = 2.2;
    a.drive.cam.pitchOff = 0.18;
    a.drive.cam.distance = 9;
    if (a.post) a.post.fx.shimmer = false;
  });
  await new Promise((r) => setTimeout(r, 6000));
  await page.evaluate(() => { window.__app.drive.frozen = true; });
  await new Promise((r) => setTimeout(r, 1500));
  const shots = [];
  for (let i = 0; i < 6; i++) {
    shots.push((await page.screenshot({ encoding: 'base64', clip: { x: 0, y: 140, width: 1280, height: 520 } })));
    await new Promise((r) => setTimeout(r, 250));
  }
  const stats = await page.evaluate(async (shots, thr) => {
    const load = async (b64) => {
      const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d');
      g.drawImage(bmp, 0, 0);
      return g.getImageData(0, 0, bmp.width, bmp.height).data;
    };
    const imgs = [];
    for (const s of shots) imgs.push(await load(s));
    const out = [];
    { const a = imgs[0], b = imgs[1]; const W = 1280, H = 520; const c = new OffscreenCanvas(W, H); const g = c.getContext('2d'); const im = g.createImageData(W, H); for (let i = 0; i < a.length; i += 4) { const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])); im.data[i] = d > thr ? 255 : a[i] * 0.3; im.data[i + 1] = a[i + 1] * 0.3; im.data[i + 2] = a[i + 2] * 0.3; im.data[i + 3] = 255; } g.putImageData(im, 0, 0); const bl = await c.convertToBlob(); const fr = new FileReader(); window.__diff = await new Promise((r) => { fr.onload = () => r(fr.result); fr.readAsDataURL(bl); }); }
    for (let k = 1; k < imgs.length; k++) {
      const a = imgs[k - 1], b = imgs[k];
      let changed = 0, sum = 0;
      const n = a.length / 4;
      for (let i = 0; i < a.length; i += 4) {
        const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
        sum += d;
        if (d > thr) changed++;
      }
      out.push({ meanAbsDiff: +(sum / n).toFixed(3), changedPct: +((100 * changed) / n).toFixed(4) });
    }
    return out;
  }, shots, 24);
  result.frames = stats;
  const durl = await page.evaluate(() => window.__diff);
  mkdirSync('tests/tmp', { recursive: true });
  writeFileSync(`tests/tmp/flicker_diff_${quality}.png`, Buffer.from(durl.split(',')[1], 'base64'));
  result.maxChangedPct = Math.max(...stats.map((s) => s.changedPct));
  result.errors = errors;
  console.log(JSON.stringify(result, null, 1));
  mkdirSync('tests/tmp', { recursive: true });
  writeFileSync(`tests/tmp/flicker_${quality}.json`, JSON.stringify(result, null, 1));
  if (result.maxChangedPct > 0.5) process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
