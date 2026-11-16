// Shared helper for the browser-driven scripts: starts Vite on a free port and launches the installed Edge/Chrome.
import { existsSync } from 'node:fs';
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';

const CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export async function startServer() {
  const server = await createServer({ logLevel: 'error', server: { port: 5199, strictPort: false, host: '127.0.0.1' } });
  await server.listen();
  const url = server.resolvedUrls.local[0];
  return { url, close: () => server.close() };
}

/** headless=false opens a real window on the real GPU (needed for honest FPS numbers). */
export async function launch({ headless = true, width = 1280, height = 720 } = {}) {
  const executablePath = CANDIDATES.find((p) => existsSync(p));
  if (!executablePath) throw new Error('No Edge/Chrome found. Set BROWSER_PATH.');
  return puppeteer.launch({
    executablePath,
    headless,
    defaultViewport: headless ? { width, height } : null,
    args: [
      `--window-size=${width},${height}`, '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11',
      // Without this the browser caps at the display refresh rate; kept on purpose: we want what the player gets.
    ],
  });
}

/** Opens a page, collects console errors / page errors / failed requests. */
export async function openGame(browser, url, { timeout = 90000 } = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.text().startsWith('BURY') || m.text().startsWith('INFO')) console.log(m.text());
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  await page.waitForFunction('window.__ready === true || window.__ready === "error"', { timeout });
  const ready = await page.evaluate('window.__ready');
  if (ready !== true) errors.push('game failed to start: ' + (await page.evaluate('document.querySelector("#loading .msg")?.textContent')));
  return { page, errors };
}
