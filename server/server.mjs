// Multiplayer server (Node + ws). Usage: npm run server  [-- --port 8787 --lag 0 --jitter 0 --loss 0 --tick 20]
// Authority model (see docs/DECISIONS W6.7):
//  - Server-authoritative: who is in the room (max 8), player ids, rope connections (who is tied to whom, kind,
//    rest length), rope tension and breaking (computed here at every tick from the latest states), the shared clock.
//  - Client-authoritative: each player's own vehicle physics (the client simulates it at 120 Hz = prediction) and
//    sends its state 20 times per second. Clients apply the rope force locally with the same rope maths (ropeCore.ts)
//    using the server's rest length, and obey the server's "broken" flag.
// --lag/--jitter/--loss simulate a bad network on every packet in both directions (lost packets are dropped; all
// important facts are re-sent in every snapshot, so loss only delays them).
import { WebSocketServer } from 'ws';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ropeTension, effectiveMass } from '../src/game/ropeCore.ts';

const recovery = JSON.parse(readFileSync(new URL('../src/config/recovery.json', import.meta.url), 'utf8'));
export const MAX_PLAYERS = 8;

export function startServer(opts = {}) {
  const o = { port: 8787, lag: 0, jitter: 0, loss: 0, tick: 20, maxRopeAttach: 16, log: false, ...opts };
  const wss = new WebSocketServer({ port: o.port });
  const players = new Map(); // id -> { ws, kind, paint, s, ts }
  let ropes = []; // { a, b, kind, rest, tension, broken, peak }
  let nextId = 1;
  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;
  const stats = { in: 0, out: 0, dropped: 0, snaps: 0, ropeBreaks: 0 };

  const lossy = (fn) => {
    if (o.loss > 0 && Math.random() < o.loss) {
      stats.dropped++;
      return;
    }
    const d = o.lag + Math.random() * o.jitter;
    if (d > 0) setTimeout(fn, d);
    else fn();
  };
  const send = (ws, msg, reliable = false) => {
    const data = JSON.stringify(msg);
    const go = () => ws.readyState === 1 && (ws.send(data), stats.out++);
    if (reliable) setTimeout(go, o.lag);
    else lossy(go);
  };

  wss.on('connection', (ws) => {
    if (players.size >= MAX_PLAYERS) {
      ws.send(JSON.stringify({ t: 'full', max: MAX_PLAYERS }));
      ws.close();
      return;
    }
    const id = nextId++;
    players.set(id, { ws, kind: 'patrol', paint: null, s: null, ts: 0 });
    send(ws, { t: 'welcome', id, tick: o.tick, time: now(), max: MAX_PLAYERS }, true);
    ws.on('message', (raw) => {
      lossy(() => {
        stats.in++;
        let m;
        try {
          m = JSON.parse(raw.toString());
        } catch {
          return;
        }
        const pl = players.get(id);
        if (!pl) return;
        if (m.t === 'hello') {
          pl.kind = String(m.kind ?? 'patrol').slice(0, 16);
          pl.paint = m.paint ? String(m.paint).slice(0, 9) : null;
        } else if (m.t === 's' && Array.isArray(m.p) && m.p.length === 3) {
          pl.s = { p: m.p.map(Number), q: m.q.map(Number), v: m.v.map(Number), w: (m.w ?? [0, 0, 0]).map(Number), h: m.h ?? [m.p, m.p], mass: Number(m.mass) || 2500, rpm: Number(m.rpm) || 0, thr: Number(m.thr) || 0 };
          pl.ts = now();
        } else if (m.t === 'rope') {
          const other = players.get(Number(m.to));
          const kind = recovery.ropes[m.kind] ? m.kind : 'strap';
          if (!other?.s || !pl.s || ropes.some((r) => [r.a, r.b].includes(id) || [r.a, r.b].includes(Number(m.to)))) return;
          // nearest pair of recovery points (0 = front, 1 = rear)
          let best = { d: Infinity, sa: 0, sb: 1 };
          for (const sa of [0, 1]) for (const sb of [0, 1]) {
            const d = Math.hypot(...[0, 1, 2].map((k) => other.s.h[sb][k] - pl.s.h[sa][k]));
            if (d < best.d) best = { d, sa, sb };
          }
          if (best.d > o.maxRopeAttach) return;
          ropes.push({ a: id, b: Number(m.to), sa: best.sa, sb: best.sb, kind, rest: Math.max(recovery.ropes[kind].length, best.d + 0.5), tension: 0, broken: false, peak: 0 });
        } else if (m.t === 'unrope') {
          ropes = ropes.filter((r) => r.a !== id && r.b !== id);
        }
      });
    });
    ws.on('close', () => {
      players.delete(id);
      ropes = ropes.filter((r) => r.a !== id && r.b !== id);
    });
  });

  // authoritative rope tension from the latest states, extrapolated to the tick time
  const hookAt = (s, side, t) => {
    const h = s.h[side];
    return [0, 1, 2].map((k) => h[k] + s.v[k] * t);
  };
  const tick = setInterval(() => {
    const tn = now();
    for (const r of ropes) {
      const A = players.get(r.a), B = players.get(r.b);
      if (!A?.s || !B?.s || r.broken) continue;
      const pa = hookAt(A.s, r.sa, Math.min(0.3, tn - A.ts)), pb = hookAt(B.s, r.sb, Math.min(0.3, tn - B.ts));
      const d = [0, 1, 2].map((k) => pb[k] - pa[k]);
      const dist = Math.hypot(...d) || 1e-6;
      const rate = [0, 1, 2].reduce((acc, k) => acc + (B.s.v[k] - A.s.v[k]) * (d[k] / dist), 0);
      const spec = recovery.ropes[r.kind];
      r.tension = ropeTension(dist, rate, r.rest, spec.mbsN / spec.elongAtMbs, spec.dampingRatio, effectiveMass(A.s.mass, B.s.mass));
      r.peak = Math.max(r.peak, r.tension);
      if (r.tension > spec.mbsN) {
        r.broken = true;
        r.tension = 0;
        stats.ropeBreaks++;
      }
    }
    const snap = {
      t: 'snap',
      time: tn,
      players: [...players.entries()].filter(([, p]) => p.s).map(([pid, p]) => ({ id: pid, kind: p.kind, paint: p.paint, ts: p.ts, s: p.s })),
      ropes: ropes.map((r) => ({ a: r.a, b: r.b, sa: r.sa, sb: r.sb, kind: r.kind, rest: r.rest, tension: Math.round(r.tension), broken: r.broken })),
    };
    for (const [, p] of players) send(p.ws, snap);
    stats.snaps++;
    // forget broken ropes after a few seconds so the players can retry
    ropes = ropes.filter((r) => !r.broken || (r.brokenAt ??= tn) > tn - 3);
  }, 1000 / o.tick);

  return {
    port: o.port,
    stats,
    players,
    get ropes() {
      return ropes;
    },
    close: () => new Promise((res) => {
      clearInterval(tick);
      for (const c of wss.clients) c.terminate();
      wss.close(() => res());
    }),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (n, d) => {
    const i = process.argv.indexOf('--' + n);
    return i > 0 ? Number(process.argv[i + 1]) : d;
  };
  const s = startServer({ port: arg('port', 8787), lag: arg('lag', 0), jitter: arg('jitter', 0), loss: arg('loss', 0), tick: arg('tick', 20) });
  console.log(`Wahiba multiplayer server on ws://localhost:${s.port} (max ${MAX_PLAYERS} players)`);
}
