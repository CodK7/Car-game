// FPS benchmark in a real browser window on the real GPU. Prints one line per run.
// Usage: node tests/bench.mjs [quality=low,medium,high] [seconds=10] [extra query, e.g. mode=drive&autodrive]
import { startServer, launch, openGame } from './browser.mjs';

const qualities = (process.argv[2] ?? 'low').split(',');
const seconds = Number(process.argv[3] ?? 10);
const extra = process.argv[4] ? '&' + process.argv[4] : '&mode=fly';
const width = Number(process.env.BENCH_W ?? 1920);
const height = Number(process.env.BENCH_H ?? 1080);

const server = await startServer();
const browser = await launch({ headless: false, width, height });
let failed = false;
try {
  for (const q of qualities) {
    const { page, errors } = await openGame(browser, `${server.url}?quality=${q}&bench=${seconds}&mute${extra}`);
    await page.bringToFront();
    await page.waitForFunction('window.__bench', { timeout: (seconds + 60) * 1000 });
    const r = await page.evaluate('window.__bench');
    const gpu = await page.evaluate(`(() => { const g = window.__app.renderer.getContext(); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; })()`);
    console.log(`BENCH quality=${q} ${r.width}x${r.height} fps=${r.fps} avg=${r.avgMs}ms p50=${r.p50Ms}ms p99=${r.p99Ms}ms 1%low=${r.low1Fps}fps frames=${r.frames} tris=${r.tris} calls=${r.calls} errors=${errors.length} gpu="${gpu}"`);
    if (errors.length) {
      failed = true;
      console.log(errors.slice(0, 5).join('\n'));
    }
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
