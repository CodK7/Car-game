// Vehicle cameras: chase (orbitable with mouse drag / right stick), bonnet, cockpit. Speed-based FOV, optional shake.
import * as THREE from 'three';
import type { VehicleSim } from './vehicleSim';
import type { Input } from '../core/input';

export type CamMode = 'chase' | 'bonnet' | 'cockpit';
const MODES: CamMode[] = ['chase', 'bonnet', 'cockpit'];

export class VehicleCamera {
  mode: CamMode = 'chase';
  fovBase = 62;
  fovSpeedGain = 14; // extra degrees at 140 km/h
  shake = true;
  distance = 7.5;
  height = 2.4;
  private yawOff = 0;
  private pitchOff = 0.12;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private smoothFwd = new THREE.Vector3(0, 0, -1);
  private shakeAmp = 0;
  private init = false;
  private tv = new THREE.Vector3();
  private lastVel = new THREE.Vector3();

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  cycle(): void {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    this.init = false;
  }

  update(dt: number, v: VehicleSim, input: Input, ground: (x: number, z: number) => number): void {
    const cam = this.camera;
    const sp = Math.abs(v.speed);
    // impact shake from sudden velocity change (landing, hitting a berm)
    const acc = this.tv.copy(v.vel).sub(this.lastVel).length() / Math.max(dt, 1e-3);
    this.lastVel.copy(v.vel);
    if (this.shake) this.shakeAmp = Math.max(this.shakeAmp * Math.exp(-dt * 6), Math.min(0.25, Math.max(0, acc - 14) * 0.006));
    else this.shakeAmp = 0;
    const fov = this.fovBase + this.fovSpeedGain * Math.min(1, sp / 39);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
      cam.updateProjectionMatrix();
    }
    if (this.mode === 'chase') {
      if (input.dragging) {
        this.yawOff -= input.mouseDX * 0.005;
        this.pitchOff = Math.min(1.2, Math.max(-0.1, this.pitchOff + input.mouseDY * 0.004));
      }
      const [lx, ly] = input.padLook();
      this.yawOff -= lx * dt * 2.5;
      this.pitchOff = Math.min(1.2, Math.max(-0.1, this.pitchOff + ly * dt * 1.5));
      if (!input.dragging && Math.abs(lx) < 0.01) this.yawOff *= Math.exp(-dt * 0.8);
      if (input.wheel) this.distance = Math.min(30, Math.max(4, this.distance * (1 + input.wheel * 0.001)));
      // follow the body heading (smoothed)
      const f = this.tv.copy(v.fwd);
      f.y = 0;
      if (f.lengthSq() < 1e-4) f.copy(this.smoothFwd);
      f.normalize();
      this.smoothFwd.lerp(f, this.init ? Math.min(1, dt * 2.5) : 1).normalize();
      const yaw = Math.atan2(this.smoothFwd.x, this.smoothFwd.z) + this.yawOff;
      const d = this.distance;
      const cp = Math.cos(this.pitchOff);
      const target = new THREE.Vector3(v.pos.x - Math.sin(yaw) * d * cp, v.pos.y + this.height + Math.sin(this.pitchOff) * d, v.pos.z - Math.cos(yaw) * d * cp);
      const gy = ground(target.x, target.z) + 1.2;
      if (target.y < gy) target.y = gy;
      if (!this.init) this.pos.copy(target);
      else this.pos.lerp(target, Math.min(1, dt * 6));
      this.look.set(v.pos.x, v.pos.y + 1.0, v.pos.z);
      cam.position.copy(this.pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.look);
    } else {
      // bonnet / cockpit: rigidly attached to the body
      const s = v.spec;
      const zF = -s.wheelbase * (1 - s.frontWeightFrac);
      const local = this.mode === 'bonnet' ? new THREE.Vector3(0, -s.cgHeight + s.body.height - 0.15, zF - 0.2) : new THREE.Vector3(-0.38, -s.cgHeight + s.body.height - 0.55, zF + 1.15);
      local.applyQuaternion(v.quat).add(v.pos);
      cam.position.copy(local);
      cam.quaternion.copy(v.quat);
      if (this.mode === 'cockpit' && input.dragging) this.yawOff -= input.mouseDX * 0.004;
      else this.yawOff *= Math.exp(-dt * 2);
      cam.rotateY(this.yawOff);
      cam.rotateX(-0.04);
    }
    if (this.shakeAmp > 0.001) {
      const t = performance.now() * 0.001;
      cam.position.x += Math.sin(t * 47) * this.shakeAmp * 0.3;
      cam.position.y += Math.sin(t * 59 + 1) * this.shakeAmp * 0.3;
      cam.rotateZ(Math.sin(t * 31) * this.shakeAmp * 0.05);
    }
    this.init = true;
  }
}
