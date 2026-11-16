// Multiplayer: interpolation under simulated latency/jitter/loss, server room limit (8), server-authoritative rope
// creation and breaking with a lossy, laggy network. Numbers go to tests/tmp/net.json.
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import WebSocket from 'ws';
import { Interp, ServerClock } from '../src/game/netInterp';
// @ts-expect-error plain JS module
import { startServer } from '../server/server.mjs';

const out: Record<string, unknown> = {};
afterAll(() => {
  mkdirSync('tests/tmp', { recursive: true });
  writeFileSync('tests/tmp/net.json', JSON.stringify(out, null, 1));
});

describe('interpolation', () => {
  it('tracks a vehicle circling at 10 m/s through 120 ms ± 40 ms lag and 10 % loss', () => {
    const R = 30, w = 10 / R;
    const truth = (t: number) => [R * Math.cos(w * t), 0, R * Math.sin(w * t)];
    const vel = (t: number) => [-R * w * Math.sin(w * t), 0, R * w * Math.cos(w * t)];
    // packets: sent every 50 ms (server time stamp = send time), arrive after lag + jitter, 10 % lost
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const arrivals: { at: number; s: { t: number; p: number[]; q: number[]; v: number[] } }[] = [];
    for (let t = 0; t < 20; t += 0.05) {
      if (rnd() < 0.1) continue;
      arrivals.push({ at: t + 0.12 + rnd() * 0.04, s: { t, p: truth(t), q: [0, 0, 0, 1], v: vel(t) } });
    }
    arrivals.sort((a, b) => a.at - b.at);
    const ip = new Interp(0.18);
    const o = { p: [0, 0, 0], q: [0, 0, 0, 1], v: [0, 0, 0] };
    let k = 0, sum = 0, n = 0, max = 0;
    for (let now = 1; now < 20; now += 1 / 60) {
      while (k < arrivals.length && arrivals[k].at <= now) ip.push(arrivals[k++].s);
      ip.sample(now, o);
      const tr = truth(now - ip.delay);
      const e = Math.hypot(o.p[0] - tr[0], o.p[2] - tr[2]);
      sum += e;
      n++;
      max = Math.max(max, e);
    }
    out['interp mean error m'] = +(sum / n).toFixed(3);
    out['interp max error m'] = +max.toFixed(3);
    expect(sum / n).toBeLessThan(0.1);
    expect(max).toBeLessThan(0.8);
  });

  it('dead-reckons through a 400 ms outage, then holds', () => {
    const ip = new Interp(0.1, 0.5);
    for (let i = 0; i <= 20; i++) {
      const t = i * 0.05;
      ip.push({ t, p: [10 * t, 0, 0], q: [0, 0, 0, 1], v: [10, 0, 0] });
    }
    const o = { p: [0, 0, 0], q: [0, 0, 0, 1], v: [0, 0, 0] };
    ip.sample(1.5, o); // 0.4 s past the newest
    expect(ip.extrapolated).toBe(true);
    expect(o.p[0]).toBeCloseTo(14, 1);
    ip.sample(3, o); // capped at 0.5 s
    expect(o.p[0]).toBeCloseTo(15, 1);
  });

  it('server clock estimate converges to the fastest path', () => {
    const c = new ServerClock();
    for (let i = 0; i < 200; i++) c.observe(100 + i * 0.05, i * 0.05 + 0.1 + (i % 7) * 0.01); // server is 99.9 s ahead minus delay
    expect(c.offset).toBeGreaterThan(99.85);
    expect(c.offset).toBeLessThan(99.91);
  });
});

const open = (port: number) =>
  new Promise<{ ws: WebSocket; msgs: any[]; first: any }>((res) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    const msgs: any[] = [];
    ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      msgs.push(m);
      if (msgs.length === 1) res({ ws, msgs, first: m });
    });
  });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const state = (x: number, vx = 0) => ({ t: 's', p: [x, 0, 0], q: [0, 0, 0, 1], v: [vx, 0, 0], w: [0, 0, 0], h: [[x - 2.4, 0.5, 0], [x + 2.4, 0.5, 0]], mass: 2500, rpm: 900, thr: 0 });

describe('server', () => {
  it('admits 8 players, refuses the 9th; rope is created, tensioned and broken by the server under lag + loss', async () => {
    const srv = startServer({ port: 18787, lag: 60, jitter: 30, loss: 0.1, tick: 20 });
    try {
      const clients = [];
      for (let i = 0; i < 8; i++) clients.push(await open(18787));
      expect(clients.every((c) => c.first.t === 'welcome')).toBe(true);
      const ninth = await open(18787);
      expect(ninth.first.t).toBe('full');
      const [A, B] = clients;
      // A at x=0 facing -x (front hook at -2.4), B 7 m away; nearest hooks: A front-ish/rear, B rear/front
      const sendBoth = () => {
        A.ws.send(JSON.stringify(state(0)));
        B.ws.send(JSON.stringify(state(-11)));
      };
      for (let i = 0; i < 10; i++) {
        sendBoth();
        await sleep(50);
      }
      // the rope request may be lost (10 %): retry like the client would on the next key press
      for (let i = 0; i < 5 && !srv.ropes.length; i++) {
        A.ws.send(JSON.stringify({ t: 'rope', to: B.first.id, kind: 'strap' }));
        await sleep(200);
      }
      expect(srv.ropes.length).toBe(1);
      const rest = srv.ropes[0].rest;
      // B drives away slowly: tension builds; then yanks at 12 m/s: the strap breaks
      let x = -11, maxTension = 0;
      for (let i = 0; i < 30; i++) {
        x -= 0.1;
        A.ws.send(JSON.stringify(state(0)));
        B.ws.send(JSON.stringify(state(x, -2)));
        await sleep(50);
        maxTension = Math.max(maxTension, srv.ropes[0]?.tension ?? 0);
      }
      for (let i = 0; i < 30 && !srv.ropes[0]?.broken; i++) {
        x -= 0.6;
        A.ws.send(JSON.stringify(state(0)));
        B.ws.send(JSON.stringify(state(x, -12)));
        await sleep(50);
      }
      await sleep(300);
      const snaps = A.msgs.filter((m) => m.t === 'snap');
      const brokenSeen = snaps.some((s) => s.ropes.some((r: any) => r.broken));
      out['server'] = { ropeRest: +rest.toFixed(2), slowPullPeakKN: +(maxTension / 1000).toFixed(1), brokenSeenByClient: brokenSeen, snapsReceivedByA: snaps.length, stats: srv.stats };
      expect(maxTension).toBeGreaterThan(1000);
      expect(srv.stats.ropeBreaks).toBe(1);
      expect(brokenSeen).toBe(true);
      for (const c of clients) c.ws.close();
    } finally {
      await srv.close();
    }
  }, 30000);
});
