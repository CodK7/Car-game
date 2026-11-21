// `npm run apk`: production build -> Android app (Capacitor WebView) -> release/WahibaSands.apk.
// The game and all terrain data are packed inside the APK, so it plays offline. Debug-signed: install it by
// copying the file to the phone and allowing "install unknown apps". Needs a JDK (17+) and the Android SDK
// (platform + build-tools); found via JAVA_HOME / ANDROID_HOME or the default Windows/macOS/Linux locations.
// public/local/ (the user's own third-party models) is never shipped, same rule as `npm run share`.
import { build } from 'vite';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const release = path.join(root, 'release');
const web = path.join(release, 'apk-web'); // = webDir in capacitor.config.json
const android = path.join(root, 'android');
const out = path.join(release, 'WahibaSands.apk');
const win = process.platform === 'win32';

const sdk = findSdk();
const env = { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk };
if (!env.JAVA_HOME) {
  const java = findJavaHome();
  if (java) env.JAVA_HOME = java;
}

// 1. web build (mode "share": modelBody skips the public/local probe, see src/vehicle/modelBody.ts)
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit'], { cwd: root, stdio: 'inherit' });
mkdirSync(release, { recursive: true });
await build({ root, mode: 'share', logLevel: 'warn', build: { outDir: web, emptyOutDir: true } });
rmSync(path.join(web, 'local'), { recursive: true, force: true });
for (const f of walk(web)) {
  if (/\.glb$/i.test(f)) throw new Error(`refusing to ship a model file: ${f}`);
}

// 2. copy it into the Android project (android/ is committed; `cap add` only on a fresh checkout without it)
const cap = path.join(root, 'node_modules/@capacitor/cli/bin/capacitor');
if (!existsSync(android)) execFileSync(process.execPath, [cap, 'add', 'android'], { cwd: root, stdio: 'inherit', env });
execFileSync(process.execPath, [cap, 'sync', 'android'], { cwd: root, stdio: 'inherit', env });
writeFileSync(path.join(android, 'local.properties'), `sdk.dir=${sdk.split(path.sep).join('/')}\n`);

// 3. gradle
// relative name + cwd: the project path may contain spaces, which cmd.exe would split
const args = ['assembleDebug', '--console=plain'];
if (win) execFileSync('cmd.exe', ['/d', '/c', '.\\gradlew.bat', ...args], { cwd: android, stdio: 'inherit', env });
else execFileSync('./gradlew', args, { cwd: android, stdio: 'inherit', env });
const apk = path.join(android, 'app/build/outputs/apk/debug/app-debug.apk');
copyFileSync(apk, out);
console.log(`APK ${path.relative(root, out)}  ${(statSync(out).size / 1e6).toFixed(1)} MB`);

function findSdk() {
  const c = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    win && path.join(process.env.LOCALAPPDATA ?? '', 'Android/Sdk'),
    path.join(os.homedir(), 'Library/Android/sdk'),
    path.join(os.homedir(), 'Android/Sdk'),
  ].filter(Boolean);
  const s = c.find((d) => existsSync(path.join(d, 'platforms')));
  if (!s) throw new Error(`Android SDK not found (set ANDROID_HOME). Looked in:\n  ${c.join('\n  ')}`);
  return s;
}

function findJavaHome() {
  try {
    const bin = execFileSync(win ? 'where' : 'which', ['java'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
    return bin ? path.dirname(path.dirname(bin)) : null;
  } catch {
    return null;
  }
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
