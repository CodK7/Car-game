// W6 multiplayer in a real browser: MP server (with --lag 80 --jitter 30 --loss 0.05) + two game windows (Edge).
// Player 2 parks behind player 1, player 1 asks for a strap (T), player 2 drives off: the server-owned rope tensions
// player 1 forward. Screenshot docs/evidence/w6_mp.png, numbers tests/tmp/net_browser.json. Usage: node tests/measure_net.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { startServer, launch, openGame } from './browser.mjs';
import { startServer as startMp } from '../server/server.mjs';

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const web = await startServer();
const mp = startMp({ port: 8788, lag: 80, jitter: 30, loss: 0.05 });
const browser = await launch({ headless: false, width: 960, height: 600 });
const browser2 = await launch({ headless: false, width: 960, height: 600 }); // own window: a background tab would stop rendering
const res = {};
try {
  const url = `${web.url}?quality=low&mute&nosave&tod=16.4&server=ws://localhost:8788`;
  const one = await openGame(browser, url + '&veh=patrol');
  const two = await openGame(browser2, url + '&veh=lc70');
  const ev = (p, f, ...a) => p.page.evaluate(f, ...a);
  await ev(one, () => { const s = window.__app.drive.sim; s.reset(1600, -2340, 270); });
  await ev(two, () => { const s = window.__app.drive.sim; s.reset(1609, -2340, 90); }); // 9 m east, facing east (rear hooks face each other)
  await sleep(3);
  res.joined = await ev(one, () => ({ status: window.__app.net.status, remotes: window.__app.net.remotes.size, hud: window.__app.net.hudLine() }));
  await one.page.bringToFront();
  for (let i = 0; i < 5 && !mp.ropes.length; i++) {
    await ev(one, () => window.__app.net.ropeKey());
    await sleep(1);
  }
  res.ropeOnServer = mp.ropes.map((r) => ({ a: r.a, b: r.b, kind: r.kind, rest: +r.rest.toFixed(2) }));
  const x0 = await ev(one, () => window.__app.drive.sim.pos.x);
  // player 2 pulls east in 4L-ish: drive with throttle
  await ev(two, () => { const a = window.__app; a.drive.sim.mode = '4L'; a.drive.sim.setPressure(18); a.drive.ctl.autoDrive = true; });
  let peak = 0, localPeak = 0;
  for (let i = 0; i < 16; i++) {
    await sleep(0.5);
    peak = Math.max(peak, mp.ropes[0]?.tension ?? 0);
    localPeak = Math.max(localPeak, await ev(one, () => window.__app.drive.rec.rope?.tension ?? 0));
  }
  res.serverPeakKN = +(peak / 1000).toFixed(1);
  res.clientPeakKN = +(localPeak / 1000).toFixed(1);
  res.player1Moved = +((await ev(one, () => window.__app.drive.sim.pos.x)) - x0).toFixed(2);
  res.hud = await ev(one, () => window.__app.net.hudLine());
  res.stats = mp.stats;
  mkdirSync('docs/evidence', { recursive: true });
  await one.page.screenshot({ path: 'docs/evidence/w6_mp.png' });
  res.errors = [...one.errors, ...two.errors];
} finally {
  mkdirSync('tests/tmp', { recursive: true });
  writeFileSync('tests/tmp/net_browser.json', JSON.stringify(res, null, 1));
  console.log(JSON.stringify(res, null, 1));
  await browser.close();
  await browser2.close();
  await mp.close();
  await web.close?.();
  process.exit(0);
}
