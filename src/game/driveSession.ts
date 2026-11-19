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
import { getSpec, VehicleSim, VehicleSpec } from '../vehicle/vehicleSim';
import { VehicleView, wheelMesh } from '../vehicle/vehicleView';
import { Recovery } from './recovery';
import rcfg from '../config/recovery.json';
import { VehicleCamera } from '../vehicle/cameras';
import { DriveController } from './driveController';
import { tun } from '../core/tunables';
import { t } from '../core/i18n';
import driftCfg from '../config/drift.json';

export const SIM_DT = 1 / 120;
const ROPE_SEGS = 16;
export type BodyFactory = (sim: VehicleSim, kind: string, paint?: string) => THREE.Object3D | null;

export class DriveSession {
  grid!: DeformGrid;
  deformTex!: DeformTexture;
  ground!: SandGround;
  sim: VehicleSim;
  view: VehicleView;
  spray: SandSpray;
  cam: VehicleCamera;
  ctl = new DriveController();
  rec = new Recovery();
  partnerView: VehicleView | null = null;
  private ropeMesh: THREE.InstancedMesh;
  private anchorMesh: THREE.Object3D;
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
  bodyFactory: BodyFactory | null = null;
  kind: string;
  paint: string | undefined;
  /** extra HUD lines (missions) */
  extraHud: (() => string) | null = null;
  /** multiplayer hook for T (returns true when it handled the key) */
  netRope: (() => boolean) | null = null;
  /** input blocked (menu open): physics paused too */
  blocked = false;

  constructor(
    readonly terrainData: TerrainData,
    readonly terrain: Terrain,
    readonly camera: THREE.PerspectiveCamera,
    q: Quality,
    vehicleName: string,
    spawn: { x: number; z: number; heading: number },
    bodyFactory: BodyFactory | null = null,
    spec?: VehicleSpec,
    paint?: string,
  ) {
    this.kind = vehicleName;
    this.paint = paint;
    this.buildDeform(q);
    this.sim = new VehicleSim(spec ?? getSpec(vehicleName), this.ground);
    this.sim.deform = this.grid;
    this.sim.reset(spawn.x, spawn.z, spawn.heading);
    const st = this.sim.spec.driveline.start;
    if (st?.mode) this.sim.mode = st.mode;
    if (st?.rearLock) this.sim.rearLock = this.sim.spec.driveline.rearLocker;
    // the drift setup starts in 4H (2H digs in at the soft dune spawn): tell the player where the drift mode is
    if (st?.mode === '4H' && st.rearLock) this.ctl.say(t('ctl.driftHint'));
    this.bodyFactory = bodyFactory;
    this.view = new VehicleView(this.sim, bodyFactory ? bodyFactory(this.sim, vehicleName, paint) : null);
    this.spray = new SandSpray(2500);
    this.spray.setBudget(q.particles);
    this.group.add(this.view.group, this.spray.mesh);
    const ropeGeo = new THREE.CylinderGeometry(0.018, 0.018, 1, 5, 1, true);
    this.ropeMesh = new THREE.InstancedMesh(ropeGeo, new THREE.MeshBasicMaterial({ color: 0x3a3a3a }), ROPE_SEGS);
    this.ropeMesh.frustumCulled = false;
    this.ropeMesh.visible = false;
    this.ropeMesh.userData.noShadow = true;
    this.anchorMesh = wheelMesh(0.4, 0.27);
    this.anchorMesh.rotation.z = Math.PI / 2;
    this.anchorMesh.visible = false;
    this.group.add(this.ropeMesh, this.anchorMesh);
    this.cam = new VehicleCamera(camera);
    this.ctl.autoDrive = P.auto;
    if (this.hud) this.hud.style.display = 'block';
    if (this.helpEl)
      this.helpEl.textContent = t('help.drive');
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

  /** pause physics (photo mode, temporal stability measurements) */
  frozen = false;

  update(dt: number, input: Input, renderer: THREE.WebGLRenderer): void {
    const sim = this.sim;
    this.time += dt;
    if (!this.blocked) this.ctl.update(dt, input, sim);
    if (input.hit('KeyC') || input.padHit(9)) this.cam.cycle();
    if (input.hit('KeyV')) this.cam.shake = !this.cam.shake;
    if (input.hit('KeyR') || input.padHit(8)) this.recover();
    if (!this.blocked) this.recoveryInput(input);
    // fixed-step physics
    const t0 = performance.now();
    this.acc += dt;
    let n = 0;
    if (this.frozen || this.blocked) this.acc = 0; // photo mode / stability tests: physics paused
    while (this.acc >= SIM_DT && n < 12) {
      this.rec.step(SIM_DT, this.grid);
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
    this.updateRecoveryVisuals();
    this.cam.update(dt, sim, input, (x, z) => this.ground.heightAt(x, z));
    this.updateDrift(dt);
    this.updateHud(dt);
  }

  /** Swap the player's vehicle (garage): new spec/body, same place, heading, tyre pressure and drive mode. */
  replaceVehicle(spec: VehicleSpec, kind: string, paint?: string): void {
    const old = this.sim;
    const sim = new VehicleSim(spec, this.ground);
    sim.deform = this.grid;
    const f = old.fwd;
    sim.reset(old.pos.x, old.pos.z, (Math.atan2(f.x, -f.z) * 180) / Math.PI);
    sim.setPressure(old.wheels[0].pressurePsi);
    sim.mode = old.mode;
    sim.rearLock = old.rearLock && spec.driveline.rearLocker;
    sim.autoGearbox = old.autoGearbox;
    this.sim = sim;
    this.kind = kind;
    this.paint = paint;
    this.group.remove(this.view.group);
    this.view = new VehicleView(sim, this.bodyFactory ? this.bodyFactory(sim, kind, paint) : null);
    this.group.add(this.view.group);
    if (this.rec.rope) this.rec.release(false);
    this.rec.player = sim;
  }

  // ---------------- recovery ----------------
  /** H winch to anchor / release · J hold = reel in · U hold = pay out · T recovery car (attach → pull → release) · G dig */
  private recoveryInput(input: Input): void {
    const rec = this.rec, sim = this.sim;
    rec.player = sim;
    if (input.hit('KeyH')) {
      if (rec.rope && rec.anchor) rec.release();
      else rec.attachAnchor(sim, 'winch');
    }
    if (rec.rope && rec.rope.winch) rec.rope.winchCmd = input.down('KeyJ') ? 1 : input.down('KeyU') ? -1 : 0;
    if (input.hit('KeyT') && this.netRope && this.netRope()) {
      // handled by the multiplayer client (strap to another player)
    } else if (input.hit('KeyT') && rec.partner && rec.partnerRole === 'stranded') {
      if (rec.rope) rec.release();
      else if (rec.partner.pos.distanceTo(sim.pos) < 16) rec.attachVehicle(sim, rec.partner, 'strap');
      else rec.say(t('ds.within', rec.partner.pos.distanceTo(sim.pos).toFixed(0)));
    } else if (input.hit('KeyT')) {
      if (!rec.rope || rec.anchor) {
        const kind = Math.abs(sim.speed) < 0.5 && sim.beached ? 'strap' : 'tow';
        rec.attachPartner(sim, kind, 'rear', kind === 'strap' ? 2 : 0.5);
        rec.partnerKind = rcfg.partner.vehicle;
        rec.partnerPaint = undefined;
      } else if (!rec.partnerDrive) {
        rec.partnerDrive = true;
        rec.say(rec.kind === 'strap' ? t('ds.snatch') : t('ds.towing'));
      } else {
        rec.release();
        rec.dismissPartner();
      }
    }
    if (input.hit('KeyG')) {
      if (Math.abs(sim.speed) > 0.5) rec.say(t('ds.stopDig'));
      else rec.startDig();
    }
    if (rec.digging) {
      sim.input.throttle = 0;
      sim.input.brake = 1;
    }
  }

  private ensurePartnerView(p: VehicleSim): void {
    if (this.partnerView?.sim === p) return;
    if (this.partnerView) this.group.remove(this.partnerView.group);
    this.partnerView = new VehicleView(p, this.bodyFactory ? this.bodyFactory(p, this.rec.partnerKind, this.rec.partnerPaint) : null);
    this.group.add(this.partnerView.group);
  }

  private updateRecoveryVisuals(): void {
    const rec = this.rec;
    if (this.partnerView && rec.partner !== this.partnerView.sim) {
      this.group.remove(this.partnerView.group);
      this.partnerView = null;
    }
    if (rec.partner) this.ensurePartnerView(rec.partner);
    this.partnerView?.update();
    // anchor marker: half-buried spare wheel
    this.anchorMesh.visible = !!rec.anchor;
    if (rec.anchor) this.anchorMesh.position.copy(rec.anchor).setY(rec.anchor.y - 0.25);
    // rope: segments along a sagging curve (sag from slack, none when taut)
    const r = rec.rope;
    this.ropeMesh.visible = !!r;
    if (!r) return;
    const a = rec.endA, b = rec.endB;
    if (rec.anchor && !rec.active) b.copy(rec.anchor);
    const dist = a.distanceTo(b);
    const slack = Math.max(0, r.restLength - dist);
    const sag = Math.sqrt(Math.max(0, (3 * dist * slack) / 8)) + 0.02; // parabola with the same arc length
    const n = ROPE_SEGS;
    const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    const Y = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3();
    const at = (t: number, o: THREE.Vector3) => {
      o.lerpVectors(a, b, t);
      o.y -= sag * 4 * t * (1 - t);
      const gy = this.ground.heightAt(o.x, o.z) + 0.03;
      if (o.y < gy) o.y = gy;
      return o;
    };
    for (let i = 0; i < n; i++) {
      at(i / n, p0);
      at((i + 1) / n, p1);
      d.subVectors(p1, p0);
      const len = d.length() || 1e-3;
      q.setFromUnitVectors(Y, d.multiplyScalar(1 / len));
      s.set(1, len, 1);
      m.compose(p0.add(p1).multiplyScalar(0.5), q, s);
      this.ropeMesh.setMatrixAt(i, m);
    }
    this.ropeMesh.instanceMatrix.needsUpdate = true;
    const col = rec.kind === 'strap' ? 0xc8481f : rec.kind === 'winch' ? 0x3a3a3a : 0xd8b23a;
    (this.ropeMesh.material as THREE.MeshBasicMaterial).color.setHex(r.load > 0.7 ? 0xff2a10 : col);
  }

  /** Put the vehicle back upright on its wheels nearby (keeps position). Not allowed while beached. */
  recover(): void {
    const s = this.sim;
    if (s.beached && s.up.y > 0.5 && !P.debug) {
      this.ctl.say(t('ds.beached'));
      return;
    }
    const f = s.fwd;
    const heading = (Math.atan2(f.x, -f.z) * 180) / Math.PI;
    s.reset(s.pos.x, s.pos.z, heading);
    this.ctl.say(t('ds.reset'));
  }

  private updateHud(dt: number): void {
    const s = this.sim;
    for (const m of this.ctl.messages.splice(0)) this.flash(m);
    for (const m of this.rec.messages.splice(0)) this.flash(m);
    if (this.msgEl && this.msgT > 0) {
      this.msgT -= dt;
      if (this.msgT <= 0) this.msgEl.style.opacity = '0';
    }
    if (s.beached && s.input.throttle > 0.3) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    if (this.stuckT > 2.5) {
      this.flash(t('ds.stuck'));
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
      `<span class="big">${kmh.toFixed(0)}</span> ${t('hud.kmh')}\n` +
      `${s.rpm.toFixed(0).padStart(4)} ${t('hud.rpm')}  ${t('hud.gear')} ${g}${s.autoGearbox ? ' A' : ' M'}\n` +
      `${s.mode}  ${t('hud.lockers')} ${lock}  ${s.wheels[0].pressurePsi.toFixed(0)} psi\n` +
      `${t('hud.sink')} ${sink.toFixed(0)} ${t('hud.cm')}${s.beached ? '  ' + t('hud.beached') : ''}` +
      this.driftHud() +
      this.ropeHud() +
      (this.extraHud ? this.extraHud() : '');
  }

  /** drift angle + combo score (src/config/drift.json → hud) */
  private driftHud(): string {
    const d = this.drift;
    if (d.angle > 0) return `\n<b style="color:var(--sand)">${t('hud.drift', d.angle.toFixed(0), d.mult)}</b>  ${Math.round(d.combo)}`;
    return d.last > 0 ? '\n' + t('hud.driftBest', Math.round(d.last), Math.round(d.best)) : '';
  }

  /** drift scoring state, updated every frame */
  drift = { angle: 0, combo: 0, mult: 1, idle: 0, last: 0, best: 0 };
  private updateDrift(dt: number): void {
    const s = this.sim, H = driftCfg.hud, d = this.drift;
    const vLong = s.vel.dot(s.fwd), vLat = s.vel.dot(s.right);
    const sp = Math.hypot(vLong, vLat);
    const ang = (Math.abs(Math.atan2(vLat, Math.abs(vLong))) * 180) / Math.PI;
    const onGround = s.wheels.some((w) => w.contact);
    if (onGround && vLong > 0 && sp > H.minSpeed && ang > H.minAngleDeg && ang < 110) {
      d.angle = ang;
      d.idle = 0;
      d.combo += ang * sp * H.pointsPerDegMps * d.mult * dt;
      d.mult = Math.min(H.maxMult, 1 + Math.floor(d.combo / H.multStepPoints));
    } else {
      d.angle = 0;
      if (d.combo > 0 && (d.idle += dt) > H.comboTimeout) {
        d.last = d.combo;
        d.best = Math.max(d.best, d.combo);
        d.combo = 0;
        d.mult = 1;
      }
    }
  }

  private ropeHud(): string {
    const rec = this.rec, r = rec.rope;
    if (rec.digging) return `\n${t('hud.digging')} ${'█'.repeat(Math.round((rec.digT / rcfg.dig.seconds) * 10)).padEnd(10, '░')}`;
    if (!r) return '';
    const frac = Math.min(1, r.load);
    const bar = '█'.repeat(Math.round(frac * 10)).padEnd(10, '░');
    const warn = frac > rcfg.hud.warnFrac ? ' <span style="color:#ff6a4a">!</span>' : '';
    const w = r.winch ? `  ${t(r.winchCmd > 0 ? 'hud.reel' : r.winchCmd < 0 ? 'hud.out' : 'hud.hold')} ${r.restLength.toFixed(1)} m` : '';
    return `\n${t('rope.' + rec.kind)} ${(r.tension / 1000).toFixed(1).padStart(4)} kN ${bar}${warn}${w}`;
  }

  flash(m: string): void {
    if (!this.msgEl) return;
    this.msgEl.textContent = m;
    this.msgEl.style.opacity = '1';
    this.msgT = 2.5;
  }
}
