// Driving session: owns the player vehicle, sand deformation (grid + texture), spray, cameras, HUD.
// The App calls update() once per rendered frame; physics runs on a fixed 120 Hz step inside.
import * as THREE from 'three';
import { P } from '../core/params';
import type { Input } from '../core/input';
import type { Quality } from '../gfx/quality';
import type { Terrain } from '../world/terrain';
import type { TerrainData } from '../world/terrainData';
import { DeformGrid } from '../sand/deformGrid';
import { DeformTexture } from '../sand/deformTexture';
import { SandGround } from '../sand/sandGround';
import { SandSpray } from '../sand/particles';
import { getSpec, VehicleSim } from '../vehicle/vehicleSim';
import { VehicleView } from '../vehicle/vehicleView';
import { VehicleCamera } from '../vehicle/cameras';
import { DriveController } from './driveController';
import { tun } from '../core/tunables';

export const SIM_DT = 1 / 120;

export class DriveSession {
  grid!: DeformGrid;
  deformTex!: DeformTexture;
  ground!: SandGround;
  sim: VehicleSim;
  view: VehicleView;
  spray: SandSpray;
  cam: VehicleCamera;
  ctl = new DriveController();
  readonly group = new THREE.Group();
  private acc = 0;
  physMs = 0;
  steps = 0;
  private hud = document.getElementById('hud') as HTMLElement | null;
  private msgEl = document.getElementById('msg') as HTMLElement | null;
  private helpEl = document.getElementById('help') as HTMLElement | null;
  private msgT = 0;
  private hudT = 0;
  private stuckT = 0;
  private time = 0;
  private deformRes = 0;
  bodyFactory: ((sim: VehicleSim) => THREE.Object3D | null) | null = null;

  constructor(
    readonly terrainData: TerrainData,
    readonly terrain: Terrain,
    readonly camera: THREE.PerspectiveCamera,
    q: Quality,
    vehicleName: string,
    spawn: { x: number; z: number; heading: number },
    bodyFactory: ((sim: VehicleSim) => THREE.Object3D | null) | null = null,
  ) {
    this.buildDeform(q);
    this.sim = new VehicleSim(getSpec(vehicleName), this.ground);
    this.sim.deform = this.grid;
    this.sim.reset(spawn.x, spawn.z, spawn.heading);
    this.bodyFactory = bodyFactory;
    this.view = new VehicleView(this.sim, bodyFactory ? bodyFactory(this.sim) : null);
    this.spray = new SandSpray(2500);
    this.spray.setBudget(q.particles);
    this.group.add(this.view.group, this.spray.mesh);
    this.cam = new VehicleCamera(camera);
    this.ctl.autoDrive = P.auto;
    if (this.hud) this.hud.style.display = 'block';
    if (this.helpEl)
      this.helpEl.textContent =
        'W/S drive/brake · A/D steer · Space handbrake · 1/2/3 = 2H/4H/4L · L/K lockers · [ ] tyre psi · C camera · M auto/manual · R reset';
    tun('Vehicle', this.sim, 'mass', 1200, 4000, 10);
    tun('Vehicle', this.sim.spec.tyre, 'mu_sand', 0.3, 1.2, 0.01);
    tun('Vehicle', this.sim.spec.tyre, 'mu_hard', 0.5, 1.4, 0.01);
    tun('Camera', this.cam, 'fovBase', 40, 90, 1);
    tun('Camera', this.cam, 'shake');
    tun('Sand', this.grid.p, 'slumpRate', 0, 20, 0.1);
    tun('Sand', this.grid.p, 'reposeDeg', 20, 45, 0.5);
    tun('Sand', this.grid.p, 'bermRatio', 0, 1.5, 0.01);
  }

  private buildDeform(q: Quality): void {
    const res = P.deform ? Number(P.deform) : q.deformRes;
    if (res === this.deformRes) return;
    this.deformRes = res;
    const size = P.deform ? Math.min(160, res * 0.0625 * 1.0 + 48) : q.deformSize;
    const old = this.grid;
    this.grid = new DeformGrid(res, size);
    const at = old ? { x: old.centreX, z: old.centreZ } : { x: 0, z: 0 };
    this.grid.follow(at.x, at.z, true);
    this.deformTex?.tex.dispose();
    this.deformTex = new DeformTexture(this.grid);
    this.ground = new SandGround(this.terrainData, this.grid);
    if (this.sim) {
      (this.sim as any).ground = this.ground;
      this.sim.deform = this.grid;
      this.grid.follow(this.sim.pos.x, this.sim.pos.z, true);
    }
    const u = this.terrain.uniforms;
    u.uDeform.value = this.deformTex.tex;
    (u.uDeformTexel.value as THREE.Vector2).set(1 / res, size / res);
  }

  setQuality(q: Quality): void {
    this.buildDeform(q);
    this.spray.setBudget(q.particles);
  }

  update(dt: number, input: Input, renderer: THREE.WebGLRenderer): void {
    const sim = this.sim;
    this.time += dt;
    this.ctl.update(dt, input, sim);
    if (input.hit('KeyC') || input.padHit(9)) this.cam.cycle();
    if (input.hit('KeyR') || input.padHit(8)) this.recover();
    // fixed-step physics
    const t0 = performance.now();
    this.acc += dt;
    let n = 0;
    while (this.acc >= SIM_DT && n < 12) {
      sim.step(SIM_DT);
      this.acc -= SIM_DT;
      n++;
    }
    if (n === 12) this.acc = 0;
    this.steps = n;
    // sand deformation window + relaxation + upload
    this.grid.follow(sim.pos.x, sim.pos.z);
    this.grid.relax(sim.pos.x, sim.pos.z, dt);
    this.physMs = performance.now() - t0;
    this.deformTex.upload(renderer);
    (this.terrain.uniforms.uDeformRect.value as THREE.Vector4).set(this.grid.centreX, this.grid.centreZ, this.grid.size, 1);
    // spray
    const cp = this.camera.position;
    for (let i = 0; i < 4; i++) {
      const w = sim.wheels[i];
      if (!w.contact) continue;
      this.spray.emit(i, {
        x: w.point.x, y: w.point.y, z: w.point.z, fx: w.fwd.x, fz: w.fwd.z,
        slipSpeed: w.slipSpeed, speed: Math.abs(w.vLong), loose: w.loose, steer: sim.input.steer, radius: w.radius,
      }, dt, cp.distanceTo(w.point));
    }
    this.spray.update(this.time);
    this.view.update();
    this.cam.update(dt, sim, input, (x, z) => this.ground.heightAt(x, z));
    this.updateHud(dt);
  }

  /** Put the vehicle back upright on its wheels nearby (keeps position). */
  recover(): void {
    const s = this.sim;
    const f = s.fwd;
    const heading = (Math.atan2(f.x, -f.z) * 180) / Math.PI;
    s.reset(s.pos.x, s.pos.z, heading);
    this.ctl.say('Vehicle reset');
  }

  private updateHud(dt: number): void {
    const s = this.sim;
    for (const m of this.ctl.messages.splice(0)) this.flash(m);
    if (this.msgEl && this.msgT > 0) {
      this.msgT -= dt;
      if (this.msgT <= 0) this.msgEl.style.opacity = '0';
    }
    if (s.beached && s.input.throttle > 0.3) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    if (this.stuckT > 2.5) {
      this.flash('Stuck! Stop spinning: air down ( [ ), reverse and rock, or use 4L');
      this.stuckT = -6;
    }
    this.hudT += dt;
    if (!this.hud || this.hudT < 0.1) return;
    this.hudT = 0;
    const kmh = Math.abs(s.speed) * 3.6;
    const g = s.gear < 0 ? 'R' : s.gear === 0 ? 'N' : String(s.gear);
    const lock = `${s.rearLock ? 'R' : '-'}${s.frontLock ? 'F' : '-'}`;
    const sink = Math.max(...s.wheels.map((w) => w.sink.depth)) * 100;
    this.hud.innerHTML =
      `<span class="big">${kmh.toFixed(0)}</span> km/h\n` +
      `${s.rpm.toFixed(0).padStart(4)} rpm  gear ${g}${s.autoGearbox ? ' A' : ' M'}\n` +
      `${s.mode}  lockers ${lock}  ${s.wheels[0].pressurePsi.toFixed(0)} psi\n` +
      `sink ${sink.toFixed(0)} cm${s.beached ? '  BEACHED' : ''}`;
  }

  flash(m: string): void {
    if (!this.msgEl) return;
    this.msgEl.textContent = m;
    this.msgEl.style.opacity = '1';
    this.msgT = 2.5;
  }
}
