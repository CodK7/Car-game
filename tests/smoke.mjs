// Headless smoke test: loads the game in each mode, advances frames, fails on any console error.
// Usage: npm run smoke
import { startServer, launch, openGame } from './browser.mjs';

const runs = [
  ['fly', 'mode=fly&quality=low&debug'],
  ['drive', 'mode=drive&quality=low&debug&nosave'],
  ['drive-medium', 'mode=drive&quality=medium&nosave&veh=lc70'],
  ['drive-camry', 'mode=drive&quality=low&nosave&veh=camry&lang=ar'],
  ['drive-lc300', 'mode=drive&quality=high&nosave&veh=lc300&lang=en'],
];
const server = await startServer();
const browser = await launch({ headless: true, width: 960, height: 540 });
let failed = 0;
try {
  for (const [name, query] of runs) {
    const { page, errors } = await openGame(browser, `${server.url}?${query}&mute`);
    // advance the simulation deterministically, independent of headless frame pacing
    const info = await page.evaluate(`(() => { const a = window.__app; a.step(180); const r = a.renderer.info.render; const p = a.camera.position; return { frames: a.frameCount, calls: r.calls, tris: r.triangles, finite: [p.x, p.y, p.z].every(Number.isFinite), smoke: a.smokeInfo ? a.smokeInfo() : null }; })()`);
    if (!info.finite) errors.push('camera position is not finite');
    if (info.tris < 1000) errors.push(`suspiciously few triangles: ${info.tris}`);
    const ok = errors.length === 0;
    if (!ok) failed++;
    console.log(`SMOKE ${name}: ${ok ? 'OK' : 'FAIL'} frames=${info.frames} calls=${info.calls} tris=${info.tris}${info.smoke ? ' ' + JSON.stringify(info.smoke) : ''}`);
    for (const e of errors.slice(0, 8)) console.log('   ' + e);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(failed ? `SMOKE FAILED (${failed})` : 'SMOKE PASSED');
process.exit(failed ? 1 : 0);
