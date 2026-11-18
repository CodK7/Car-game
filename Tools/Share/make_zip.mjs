// `npm run share`: production build -> release/WahibaSands.zip that friends can play without installing anything.
// Layout: game/ (the static site), Play.bat + serve.ps1 (Windows), play.sh (macOS/Linux), README.txt.
// public/local/ (the user's own third-party models, see public/local/README.md) is never shipped.
import { build } from 'vite';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const release = path.join(root, 'release');
const stage = path.join(release, 'WahibaSands');
const game = path.join(stage, 'game');
const zip = path.join(release, 'WahibaSands.zip');

rmSync(stage, { recursive: true, force: true });
rmSync(zip, { force: true });
mkdirSync(stage, { recursive: true });

execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit'], { cwd: root, stdio: 'inherit' });
await build({ root, mode: 'share', logLevel: 'warn', build: { outDir: game, emptyOutDir: true } });

// never ship local-only models
rmSync(path.join(game, 'local'), { recursive: true, force: true });
for (const f of walk(game)) {
  if (/\.glb$/i.test(f)) throw new Error(`refusing to ship a model file: ${f}`);
}
for (const f of ['Play.bat', 'serve.ps1', 'play.sh', 'README.txt']) cpSync(path.join(here, f), path.join(stage, f));

if (process.platform === 'win32' && existsSync('C:/Windows/System32/tar.exe')) {
  // bsdtar writes a standard zip (forward-slash paths) when the name ends in .zip
  execFileSync('C:/Windows/System32/tar.exe', ['-a', '-c', '-f', zip, '-C', release, 'WahibaSands'], { stdio: 'inherit' });
} else {
  execFileSync('zip', ['-qr', zip, 'WahibaSands'], { cwd: release, stdio: 'inherit' });
}
const mb = (n) => (n / 1e6).toFixed(1) + ' MB';
console.log(`SHARE ${path.relative(root, zip)}  ${mb(statSync(zip).size)} (unpacked ${mb(walk(stage).reduce((s, f) => s + statSync(f).size, 0))})`);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
