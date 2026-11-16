// W6 full gameplay loop in a real browser window (Edge, UHD 630): drive → get stuck → reset refused → winch out →
// garage upgrade → recovery mission (strap + snatch) → photo mode → reload: save kept. Screenshots docs/evidence/w6_*.png,
// results tests/tmp/loop.json. Usage: node tests/measure_loop.mjs [quality]
import { mkdirSync, writeFileSync } from 'node:fs';
import { startServer, launch, openGame } from './browser.mjs';

const quality = process.argv[2] ?? 'medium';
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const server = await startServer();
const browser = await launch({ headless: false, width: 1600, height: 900 });
const res = { quality, steps: {} };
const shot = (page, n) => page.screenshot({ path: `docs/evidence/w6_${n}.png` });
mkdirSync('docs/evidence', { recursive: true });
try {
  const url = `${server.url}?quality=${quality}&veh=patrol&mute&tod=16.4`;
  const { page, errors } = await openGame(browser, url);
  await page.bringToFront();
  await page.evaluate(() => localStorage.removeItem('wahiba.save.v1'));
  const ev = (f, ...a) => page.evaluate(f, ...a);
  const st = () => ev(() => { const a = window.__app, s = a.drive.sim; return { x: s.pos.x, z: s.pos.z, speed: s.speed, beached: s.beached, psi: s.wheels[0].pressurePsi, mass: s.mass, credits: a.game.save.credits, tension: a.drive.rec.rope ? a.drive.rec.rope.tension : 0, rope: a.drive.rec.kind, fps: a.perf.recent().fps }; });

  // 1. get stuck: east dune face, 2H, 40 psi, full throttle
  await ev(() => {
    const a = window.__app, s = a.drive.sim;
    s.reset(1921, -2282, 104);
    a.drive.grid.follow(s.pos.x, s.pos.z, true);
    s.mode = '2H';
    s.setPressure(40);
    a.drive.ctl.autoDrive = true;
  });
  let t = 0, s0;
  for (; t < 40; t += 1) {
    await sleep(1);
    s0 = await st();
    if (s0.beached && t > 4) break;
  }
  res.steps.stuck = { seconds: t, ...s0 };
  // 2. reset is refused while beached (pressed while still stuck)
  await page.keyboard.press('KeyR');
  await sleep(0.3);
  const after = await st();
  res.steps.resetRefused = { beachedWhenPressed: s0.beached, moved: +Math.hypot(after.x - s0.x, after.z - s0.z).toFixed(2), msg: await ev(() => document.getElementById('msg').textContent) };
  await ev(() => { window.__app.drive.ctl.autoDrive = false; });
  await ev(() => { const c = window.__app.drive.cam; c.orbitHold = true; c.yawOff = 2.4; c.pitchOff = 0.2; c.distance = 10; });
  await sleep(1);
  s0 = await st();
  await shot(page, 'stuck');

  // 3. winch to a sand anchor ahead, hold J to reel in
  await page.keyboard.press('KeyH');
  await page.keyboard.down('KeyJ');
  let peak = 0, w;
  for (t = 0; t < 45; t += 1) {
    await sleep(1);
    w = await st();
    peak = Math.max(peak, w.tension);
    if (t === 6) await shot(page, 'winch');
    if (Math.hypot(w.x - s0.x, w.z - s0.z) > 4 && !w.beached) break;
  }
  await page.keyboard.up('KeyJ');
  res.steps.winch = { seconds: t, moved: +Math.hypot(w.x - s0.x, w.z - s0.z).toFixed(2), beached: w.beached, peakKN: +(peak / 1000).toFixed(1), fps: w.fps };
  await page.keyboard.press('KeyH'); // release
  await ev(() => { window.__app.drive.cam.orbitHold = false; });

  // 4. garage: buy balloon tyres (menu opens with B; click the part button)
  await page.keyboard.press('KeyB');
  await sleep(0.5);
  const m0 = await st();
  await ev(() => document.querySelector('#panel button[data-a="part:tyres:balloon"]').click());
  await sleep(0.5);
  await shot(page, 'garage');
  const m1 = await st();
  const tyreW = await ev(() => window.__app.drive.sim.spec.tyre.width);
  res.steps.garage = { creditsBefore: m0.credits, creditsAfter: m1.credits, massBefore: m0.mass, massAfter: m1.mass, tyreWidth: tyreW };

  // 5. recovery mission: start from the menu, drive up to the stranded car (placed next to it), strap (T), pull
  await ev(() => document.querySelector('#panel button[data-a="start:rescue"]').click());
  await sleep(1);
  await ev(() => {
    const a = window.__app, s = a.drive.sim, p = a.drive.rec.partner;
    const f = p.fwd;
    s.reset(p.pos.x + f.x * 9, p.pos.z + f.z * 9, (Math.atan2(f.x, -f.z) * 180) / Math.PI);
    a.drive.grid.follow(s.pos.x, s.pos.z, true);
    s.mode = '4H';
    s.setPressure(20);
  });
  await sleep(1.5);
  const strandedBeached = await ev(() => window.__app.drive.rec.partner.beached);
  await page.keyboard.press('KeyT');
  await sleep(0.3);
  await ev(() => { const c = window.__app.drive.cam; c.orbitHold = true; c.yawOff = 1.9; c.pitchOff = 0.25; c.distance = 16; });
  await page.keyboard.down('KeyW');
  let status = 'running', m;
  for (t = 0; t < 30; t += 0.5) {
    await sleep(0.5);
    if (t === 2) await shot(page, 'snatch');
    m = await ev(() => ({ status: window.__app.game.missions.status, credits: window.__app.game.save.credits, rope: window.__app.drive.rec.kind, tension: window.__app.drive.rec.rope?.tension ?? 0 }));
    status = m.status;
    if (status !== 'running') break;
  }
  await page.keyboard.up('KeyW');
  res.steps.rescue = { strandedBeachedAtStart: strandedBeached, seconds: t, ...m };
  await sleep(1);
  await shot(page, 'rescued');

  // 6. photo mode
  await ev(() => { window.__app.drive.cam.orbitHold = false; });
  await page.keyboard.press('KeyP');
  await ev(() => { const c = window.__app.drive.cam; c.yawOff = 2.6; c.pitchOff = 0.12; c.distance = 9; });
  await sleep(1.5);
  await shot(page, 'photo');
  res.steps.photo = await ev(() => ({ frozen: window.__app.drive.frozen, hudHidden: document.getElementById('hud').style.visibility === 'hidden' }));
  await page.keyboard.press('KeyP');

  // 7. reload: the save keeps credits, parts and missions
  const before = await ev(() => JSON.parse(JSON.stringify(window.__app.game.save)));
  await ev(() => window.dispatchEvent(new Event('beforeunload')));
  const p2 = await openGame(browser, url);
  const loaded = await p2.page.evaluate(() => ({ credits: window.__app.game.save.credits, done: window.__app.game.save.done, tyres: window.__app.game.save.builds.patrol?.tyres, width: window.__app.drive.sim.spec.tyre.width }));
  res.steps.reload = { before: { credits: before.credits, done: before.done }, loaded };
  errors.push(...p2.errors);
  res.errors = errors;
  console.log(JSON.stringify(res, null, 1));
  mkdirSync('tests/tmp', { recursive: true });
  writeFileSync('tests/tmp/loop.json', JSON.stringify(res, null, 1));
} finally {
  await browser.close();
  await server.close();
}
