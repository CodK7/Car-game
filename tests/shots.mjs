// Evidence screenshots in a real browser window. Usage: node tests/shots.mjs <prefix> <query> <views.json | builtin set name>
// Each view: { name, x, z, h (m above ground), yaw (deg), pitch (deg), tod, wait (s), js (optional extra code) }
import { mkdirSync, readFileSync } from 'node:fs';
import { startServer, launch, openGame } from './browser.mjs';

const prefix = process.argv[2] ?? 'w1';
const query = process.argv[3] ?? 'mode=fly&quality=medium';
const set = process.argv[4] ?? 'w1';
const SETS = {
  w1: [
    { name: 'aerial_golden', x: -3000, z: 3000, h: 600, yaw: -35, pitch: -20, tod: 16.6 },
    { name: 'aerial_noon', x: -3000, z: 3000, h: 600, yaw: -35, pitch: -20, tod: 12.3 },
    { name: 'ground_golden', x: 1200, z: -2600, h: 2, yaw: 180, pitch: 1, tod: 16.8 },
    { name: 'corridor_trees', x: 1650, z: -2350, h: 6, yaw: 160, pitch: -4, tod: 16.2 },
    { name: 'mintarib_town', x: 2046, z: -5600, h: 120, yaw: 0, pitch: -12, tod: 16.0 },
  ],
};
const views = SETS[set] ?? JSON.parse(readFileSync(set, 'utf8'));
mkdirSync('docs/evidence', { recursive: true });
const server = await startServer();
const browser = await launch({ headless: false, width: 1600, height: 900 });
try {
  const { page, errors } = await openGame(browser, `${server.url}?${query}&mute`);
  await page.bringToFront();
  for (const v of views) {
    await page.evaluate((v) => {
      const a = window.__app;
      a.manual = false;
      if (v.tod !== undefined) a.tod.hour = v.tod;
      if (a.fly && v.x !== undefined) {
        a.camera.position.set(v.x, a.assets.data.heightAt(v.x, v.z) + v.h, v.z);
        a.fly.yaw = (v.yaw * Math.PI) / 180;
        a.fly.pitch = (v.pitch * Math.PI) / 180;
      }
      if (v.js) new Function('a', v.js)(a);
    }, v);
    await new Promise((r) => setTimeout(r, (v.wait ?? 3) * 1000));
    await page.screenshot({ path: `docs/evidence/${prefix}_${v.name}.png` });
    const fps = await page.evaluate(() => window.__app.perf.recent().fps);
    console.log(`SHOT ${prefix}_${v.name}.png fps=${fps}`);
  }
  if (errors.length) console.log('ERRORS\n' + errors.join('\n'));
} finally {
  await browser.close();
  await server.close();
}
