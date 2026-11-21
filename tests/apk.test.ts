// `npm run apk` packaging contract (the Gradle build itself is checked by running the script, see PROGRESS U6).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('android apk', () => {
  it('capacitor webDir is the folder make_apk.mjs builds into', () => {
    const cfg = JSON.parse(read('capacitor.config.json'));
    expect(cfg.webDir).toBe('release/apk-web');
    expect(read('Tools/Apk/make_apk.mjs')).toContain("path.join(release, 'apk-web')");
  });

  it('never ships public/local and uses the share build mode', () => {
    const s = read('Tools/Apk/make_apk.mjs');
    expect(s).toContain("mode: 'share'");
    expect(s).toContain("rmSync(path.join(web, 'local')");
  });

  it('activity is landscape, fullscreen and keeps the screen on', () => {
    expect(read('android/app/src/main/AndroidManifest.xml')).toContain('android:screenOrientation="sensorLandscape"');
    const act = read('android/app/src/main/java/com/wahibasands/offroad/MainActivity.java');
    expect(act).toContain('FLAG_KEEP_SCREEN_ON');
    expect(act).toContain('Type.systemBars()');
  });
});
