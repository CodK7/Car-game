// Application shell: owns the renderer, the world and the frame loop. Game systems plug in here.
import * as THREE from 'three';
import { P } from './core/params';
import { Input } from './core/input';
import { Perf } from './core/perf';
import { FlyCam } from './core/flycam';
import { tun } from './core/tunables';
import { QualityManager, Quality } from './gfx/quality';
import { loadWorld, WorldAssets } from './world/assets';
import { atmo, TimeOfDay } from './world/atmosphere';
import { Terrain } from './world/terrain';
import { Sky } from './world/sky';
import { RoadNet } from './world/roadNet';
import { buildRoads } from './world/roads';
import { Props } from './world/props';
import { TerrainShadowBaker } from './world/shadowBake';
import worldCfg from './config/world.json';
import { DriveSession } from './game/driveSession';
import { buildBody } from './vehicle/vehicleMeshes';
import { AudioSystem } from './audio/audioSystem';
import { ObjShadows } from './gfx/shadows';
import { PostFx } from './gfx/post';

export class App {
  renderer!: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, 1, 0.4, 45000);
  input!: Input;
  perf = new Perf();
  quality = new QualityManager();
  tod = new TimeOfDay();
  assets!: WorldAssets;
  terrain!: Terrain;
  sky!: Sky;
  roads!: RoadNet;
  props!: Props;
  shadowBaker!: TerrainShadowBaker;
  fly!: FlyCam;
  drive: DriveSession | null = null;
  audio = new AudioSystem();
  shadows = new ObjShadows();
  post = new PostFx();
  vehName = 'patrol';
  flyMode = false;
  time = 0;
  frameCount = 0;
  private last = 0;
  manual = false;
  private statsEl = document.getElementById('stats')!;
  private statsT = 0;
  private bench: { t: number; dur: number; started: boolean } | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {}

  async init(status: (m: string) => void): Promise<void> {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.info.autoReset = false;
    const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    white.needsUpdate = true;
    atmo.uTerrShadow.value = white;
    atmo.uObjShadow.value = white;
    this.input = new Input(this.canvas);
    // audio may only start after a user gesture (browser autoplay policy)
    const startAudio = () => void this.audio.start().catch((e) => console.warn('audio start failed', e));
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, startAudio, { passive: true });
    if (P.tod !== undefined) this.tod.hour = P.tod;
    this.tod.update();

    this.assets = await loadWorld(status);
    status('terrain');
    const q = this.quality.q;
    this.terrain = new Terrain(this.assets.data, this.assets.maskTex, this.assets.rippleTex, q);
    this.scene.add(this.terrain.group);
    this.sky = new Sky();
    this.scene.add(this.sky.mesh);
    status('roads and props');
    this.roads = new RoadNet(this.assets.osm.roads);
    const roadInfo = { kind: null as any };
    // tracks and paved roads are compacted ground for the sand model
    this.assets.data.looseOverride = (x, z, l) => {
      const d = this.roads.distance(x, z, roadInfo);
      if (d > 6) return l;
      const k = roadInfo.kind === 'paved' ? 0 : 0.15;
      const w = Math.min(Math.max((d - 2.5) / 3.5, 0), 1);
      return k + (l - k) * w;
    };
    this.scene.add(buildRoads(this.assets.osm, this.assets.data));
    this.props = new Props(this.assets.data, this.roads, this.assets.osm, q);
    this.scene.add(this.props.group);
    this.shadowBaker = new TerrainShadowBaker(this.assets.data, q.terrainShadowRes);

    const sp = worldCfg.spawn;
    const sx = P.x ?? sp.x;
    const sz = P.z ?? sp.z;
    this.camera.position.set(sx, this.assets.data.heightAt(sx, sz) + 25, sz);
    this.fly = new FlyCam(this.camera);
    this.fly.yaw = (-(P.heading ?? sp.heading_deg) * Math.PI) / 180;
    if (P.mode !== 'fly' && !P.bench) {
      status('vehicle');
      const veh = P.veh || 'patrol';
      this.vehName = veh;
      this.drive = new DriveSession(this.assets.data, this.terrain, this.camera, q, veh, { x: sx, z: sz, heading: P.heading ?? sp.heading_deg }, (sim) => (P.box ? null : buildBody(sim.spec, veh)));
      this.scene.add(this.drive.group);
    } else this.flyMode = true;

    this.drive?.spray.mesh && (this.drive.spray.mesh.userData.noShadow = true);
    this.shadows.setRoots(this.drive ? [this.props.group, this.drive.group] : [this.props.group]);
    tun('Effects', this.shadows, 'enabled', undefined, undefined, undefined, undefined, 'object shadows');
    tun('Effects', this.post.fx, 'shimmer');
    tun('Effects', this.post.fx, 'haze');
    tun('Effects', this.post.fx, 'hazeDensity', 0, 0.0005, 0.00001);
    tun('Effects', this.post.fx, 'lensDust');
    tun('Effects', this.post.fx, 'contrast', 0, 0.5, 0.01);
    tun('Effects', this.terrain.uniforms.uFx.value, 'y', 0, 1, 1, undefined, 'sand wisps (crests)');
    this.quality.onChange = (nq) => this.applyQuality(nq);
    this.applyQuality(q);
    window.addEventListener('resize', () => this.resize());
    this.resize();

    tun('Time of day', this.tod, 'hour', 4, 20, 0.05);
    tun('Time of day', this.tod, 'declinationDeg', -23.4, 23.4, 0.1);
    tun('Time of day', this.tod, 'windDirDeg', 0, 360, 1);
    tun('Time of day', this.tod, 'exposureBias', 0.3, 2.5, 0.01);
    tun('Time of day', this.tod, 'hazeScale', 0, 6, 0.05);
    tun('Quality', this.quality, 'name', ['low', 'medium', 'high'], undefined, undefined, (v) => {
      this.quality.auto = false;
      this.quality.name = '' as any;
      this.quality.set(v);
    }, 'preset');
    tun('Quality', this.quality, 'auto');
    tun('Quality', this.quality.q, 'renderScale', 0.3, 1.5, 0.05, () => this.resize());
    tun('Terrain', this.terrain, 'detail', 0.8, 4, 0.05);
    tun('Terrain', this.shadowBaker, 'softnessDeg', 0.3, 5, 0.1, () => (this.shadowBaker.lastVersion = -1), 'shadow softness');
    if (P.debug) this.statsEl.style.display = 'block';
    const cr = document.getElementById('credits');
    if (cr) cr.textContent = 'DEM © DLR / Airbus (Copernicus) · Map data © OpenStreetMap contributors';
    if (P.bench) this.bench = { t: 0, dur: P.bench, started: false };
    (window as any).__app = this;
    (window as any).__THREE = THREE; // for measurement scripts (tests/measure_*.mjs)
  }

  applyQuality(q: Quality): void {
    this.shadows.configure({ size: P.noshadow ? 0 : q.shadowMap, splits: q.shadowSplits });
    this.terrain.setQuality(q);
    this.props?.setQuality(q);
    this.drive?.setQuality(q);
    this.resize();
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25) * this.quality.q.renderScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  start(): void {
    this.last = performance.now();
    let lastRaf = performance.now();
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      lastRaf = now;
      if (!this.manual) this.frame(now);
    };
    requestAnimationFrame(loop);
    // Hidden panes/tabs stop requestAnimationFrame; keep the simulation alive at a low rate so tools can still inspect it.
    setInterval(() => {
      const now = performance.now();
      if (!this.manual && now - lastRaf > 400) this.frame(now);
    }, 100);
  }

  /** Debug/automation: advance n frames with a fixed dt, independent of requestAnimationFrame. */
  step(n = 1, dtMs = 1000 / 60): void {
    this.manual = true;
    for (let i = 0; i < n; i++) this.frame(this.last + dtMs);
  }

  /** Debug/automation: time n synchronous frames (readPixels forces the GPU to finish). Returns ms per frame. */
  measure(n = 30, dtMs = 1000 / 60): { avgMs: number; maxMs: number; fpsBound: number } {
    this.manual = true;
    const gl = this.renderer.getContext();
    const px = new Uint8Array(4);
    const times: number[] = [];
    for (let i = 0; i < n + 3; i++) {
      const t0 = performance.now();
      this.frame(this.last + dtMs);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (i >= 3) times.push(performance.now() - t0);
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    return { avgMs: Math.round(avg * 100) / 100, maxMs: Math.round(Math.max(...times) * 100) / 100, fpsBound: Math.round(1000 / avg) };
  }

  frame(now: number): void {
    const dtMs = now - this.last;
    this.last = now;
    const dt = Math.min(dtMs / 1000, 0.1);
    this.time += dt;
    this.frameCount++;
    this.perf.frame(dtMs);
    this.quality.frame(dt);
    this.input.poll();

    if (this.drive && P.debug && this.input.hit('KeyF')) {
      this.flyMode = !this.flyMode;
      if (this.flyMode) this.fly.yaw = this.camera.rotation.y;
    }
    if (this.bench) this.runBench(dt);
    else if (this.drive && !this.flyMode) this.drive.update(dt, this.input, this.renderer);
    else this.fly.update(dt, this.input, (x, z) => this.assets.data.heightAt(x, z));
    this.audio.update(dt, this.drive && !this.flyMode ? this.drive.sim : null, this.vehName, this.camera, this.drive && !this.flyMode ? this.drive.cam.mode : 'fly');

    this.tod.update();
    atmo.uTime.value = this.time;
    this.renderer.toneMappingExposure = this.tod.exposure;
    this.camera.updateMatrixWorld();
    this.sky.mesh.position.copy(this.camera.position);
    this.terrain.update(this.camera);
    this.props.update(this.camera.position);
    this.shadowBaker.update(this.renderer, this.tod.version);
    this.renderer.info.reset();
    this.shadows.update(this.renderer, this.scene, this.camera);
    if (this.quality.q.post && !P.nopost) this.post.render(this.renderer, this.scene, this.camera, this.quality.q, this.time, this.tod.elevationDeg);
    else this.renderer.render(this.scene, this.camera);
    this.input.endFrame();

    this.statsT += dt;
    if (P.debug && this.statsT > 0.5) {
      this.statsT = 0;
      const s = this.perf.recent();
      const r = this.renderer.info.render;
      const c = this.camera.position;
      this.statsEl.textContent =
        `${s.fps.toFixed(1)} fps  ${s.avgMs.toFixed(1)} ms  1%low ${s.low1Fps.toFixed(0)}\n` +
        `quality ${this.quality.name}${this.quality.auto ? ' (auto)' : ''}  scale ${this.quality.q.renderScale}\n` +
        `calls ${r.calls}  tris ${(r.triangles / 1000).toFixed(0)}k  nodes ${this.terrain.stats.nodes}\n` +
        `trees ${this.props.stats.ghaf}  shrubs ${this.props.stats.shrub}  tufts ${this.props.stats.tuft}  shadow bake ${this.shadowBaker.bakeMs.toFixed(1)} ms\n` +
        `pos ${c.x.toFixed(0)}, ${c.y.toFixed(0)}, ${c.z.toFixed(0)}  sun ${this.tod.elevationDeg.toFixed(1)}°` +
        (this.drive ? `\nphysics ${this.drive.physMs.toFixed(2)} ms (${this.drive.steps} steps)  deform upload ${this.drive.deformTex.uploadMs.toFixed(2)} ms ${this.drive.deformTex.uploadedTexels} tx  spray ${this.drive.spray.spawned}` : '') +
        `
shadows ${this.shadows.renders} maps ${this.shadows.ms.toFixed(2)} ms  post ${this.quality.q.post ? this.post.ms.toFixed(2) + ' ms' : 'off'}` +
        `
audio ${this.audio.ctx ? this.audio.ctx.state : 'waiting for a click/key'}  update ${this.audio.updateMs.toFixed(2)} ms`;
    }
  }

  /** Smoke-test info: vehicle state if driving. */
  smokeInfo(): Record<string, unknown> {
    const d = this.drive;
    if (!d) return { mode: 'fly' };
    const s = d.sim;
    return { speed: s.speed, rpm: s.rpm, gear: s.gear, y: s.pos.y, ground: d.ground.heightAt(s.pos.x, s.pos.z), up: s.up.y, finite: Number.isFinite(s.pos.x + s.pos.y + s.pos.z + s.vel.length()) };
  }

  /** Scripted fly-through used by ?bench=<seconds>; publishes window.__bench when done. */
  private runBench(dt: number): void {
    const b = this.bench!;
    b.t += dt;
    const warm = 2;
    const sp = worldCfg.spawn;
    const t = Math.max(b.t - warm, 0);
    const x = sp.x + Math.sin(t * 0.21) * 300 + t * 12;
    const z = sp.z - t * 35;
    this.camera.position.set(x, this.assets.data.heightAt(x, z) + 12 + 10 * Math.sin(t * 0.5), z);
    this.camera.rotation.set(-0.12, 0.25 * Math.sin(t * 0.3), 0, 'YXZ');
    if (!b.started && b.t >= warm) {
      b.started = true;
      this.perf.startBench();
    }
    if (b.started && b.t >= warm + b.dur) {
      const r = { ...this.perf.endBench(), quality: this.quality.name, scale: this.quality.q.renderScale, width: this.renderer.domElement.width, height: this.renderer.domElement.height, tris: this.renderer.info.render.triangles, calls: this.renderer.info.render.calls };
      (window as any).__bench = r;
      console.log('BENCH ' + JSON.stringify(r));
      this.bench = null;
    }
  }
}
