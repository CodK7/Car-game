// Free-fly camera: WASD + mouse drag, Q/E down/up, Shift fast, wheel changes speed. Never goes below the ground.
import * as THREE from 'three';
import { Input } from './input';
import { clamp } from './rng';

export class FlyCam {
  yaw = 0;
  pitch = -0.15;
  speed = 60;
  constructor(readonly camera: THREE.PerspectiveCamera) {}

  update(dt: number, input: Input, groundAt: (x: number, z: number) => number): void {
    this.yaw -= input.mouseDX * 0.0035;
    this.pitch = clamp(this.pitch - input.mouseDY * 0.0035, -1.5, 1.5);
    if (input.wheel) this.speed = clamp(this.speed * Math.pow(1.25, -input.wheel), 2, 2000);
    const fwd = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    const side = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
    const up = (input.down('KeyE') ? 1 : 0) - (input.down('KeyQ') ? 1 : 0);
    const v = this.speed * (input.down('ShiftLeft') ? 5 : 1) * dt;
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch);
    const p = this.camera.position;
    p.x += (-sy * cp * fwd + cy * side) * v;
    p.z += (-cy * cp * fwd - sy * side) * v;
    p.y += (Math.sin(this.pitch) * fwd + up) * v;
    p.y = Math.max(p.y, groundAt(p.x, p.z) + 1.2);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
