// Measures the settings FPS limit in a real browser window: frames rendered per second for each cap.
// Usage: node tests/measure_fpscap.mjs   (writes tests/tmp/fpscap.json)
import { writeFileSync, mkdirSync } from 'node:fs';
import { startServer, launch, openGame } from './browser.mjs';

const server = await startServer();
const browser = await launch({ headless: false, width: 1280, height: 720 });
try {
  const { page, errors } = await openGame(browser, `${server.url}?quality=low&nosave&mute`);
  const r = await page.evaluate(`(async () => {
    const a = window.__app;
    const rate = async (cap) => {
      a.applySettings({ ...a.settings, fpsCap: cap });
      await new Promise((r) => setTimeout(r, 800));
      const f0 = a.frameCount, t0 = performance.now();
      await new Promise((r) => setTimeout(r, 3000));
      return Math.round(((a.frameCount - f0) * 10000) / (performance.now() - t0)) / 10;
    };
    const out = {};
    for (const c of [0, 30, 45, 60]) out['cap' + c] = await rate(c);
    a.applySettings({ ...a.settings, fpsCap: 0 });
    return out;
  })()`);
  r.errors = errors;
  console.log('FPSCAP ' + JSON.stringify(r));
  mkdirSync('tests/tmp', { recursive: true });
  writeFileSync('tests/tmp/fpscap.json', JSON.stringify(r, null, 2));
} finally {
  await browser.close();
  await server.close();
}
