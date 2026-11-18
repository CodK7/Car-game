// Visual representation of a VehicleSim: body + 4 wheels (spin, steer, suspension travel, sidewall bulge).
// 'box' is the W2 placeholder; detailed procedural bodies come from vehicleMeshes.ts.
import * as THREE from 'three';
import type { VehicleSim } from './vehicleSim';
import { objMaterial } from '../gfx/objMaterial';
import { detailedWheel, type WheelStyle } from './wheelMesh';

export function wheelMesh(radius: number, width: number): THREE.Group {
  const g = new THREE.Group();
  const tyreGeo = new THREE.CylinderGeometry(radius, radius, width, 28, 1);
  tyreGeo.rotateZ(Math.PI / 2);
  const tyre = new THREE.Mesh(tyreGeo, objMaterial({ color: 0x1d1b1a }));
  // tread blocks so the spin is visible
  const blocks: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 18; i++) {
    const b = new THREE.BoxGeometry(width * 0.92, 0.035, 0.07);
    b.translate(0, radius + 0.008, 0);
    b.rotateX((i / 18) * Math.PI * 2);
    blocks.push(b);
  }
  const tread = new THREE.Mesh(mergeGeos(blocks), objMaterial({ color: 0x262321 }));
  const rimGeo = new THREE.CylinderGeometry(radius * 0.52, radius * 0.52, width * 1.02, 14, 1);
  rimGeo.rotateZ(Math.PI / 2);
  const rim = new THREE.Mesh(rimGeo, objMaterial({ color: 0xb9b6ae, gloss: 0.5 }));
  g.add(tyre, tread, rim);
  return g;
}

export function mergeGeos(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let nPos = 0, nIdx = 0;
  for (const g of list) {
    nPos += g.getAttribute('position').count;
    nIdx += g.index ? g.index.count : g.getAttribute('position').count;
  }
  const pos = new Float32Array(nPos * 3), nor = new Float32Array(nPos * 3);
  const idx = new Uint32Array(nIdx);
  let po = 0, io = 0;
  for (const g of list) {
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    pos.set(p.array as Float32Array, po * 3);
    nor.set(n.array as Float32Array, po * 3);
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + po;
    else for (let i = 0; i < p.count; i++) idx[io++] = i + po;
    po += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

export class VehicleView {
  readonly group = new THREE.Group();
  readonly body = new THREE.Group();
  readonly wheels: THREE.Group[] = [];
  private q = new THREE.Quaternion();
  private qs = new THREE.Quaternion();
  private ax = new THREE.Vector3();

  constructor(readonly sim: VehicleSim, bodyMesh: THREE.Object3D | null = null) {
    const s = sim.spec;
    if (bodyMesh) this.body.add(bodyMesh);
    else {
      // placeholder box body
      const b = s.body;
      const zF = -s.wheelbase * (1 - s.frontWeightFrac) - b.overhangF;
      const y0 = -s.cgHeight + b.groundClearance + 0.15;
      const h = b.height - b.groundClearance - 0.15;
      const bw = Math.min(b.width, Math.min(s.trackF, s.trackR) - s.tyre.width - 0.06);
      const box = new THREE.Mesh(new THREE.BoxGeometry(bw, h, b.length), objMaterial({ color: 0xd8d2c4, gloss: 0.3 }));
      box.position.set(0, y0 + h / 2, zF + b.length / 2);
      const nose = new THREE.Mesh(new THREE.BoxGeometry(b.width * 0.6, 0.2, 0.05), objMaterial({ color: 0x223355 }));
      nose.position.set(0, y0 + h * 0.6, zF - 0.02);
      this.body.add(box, nose);
    }
    this.group.add(this.body);
    const style = bodyMesh?.userData.wheelStyle as WheelStyle | undefined;
    for (const w of sim.wheels) {
      let m: THREE.Group;
      if (style) {
        // detailed wheel: show face looks to +x, so left wheels are turned around inside the spinning group
        m = new THREE.Group();
        const inner = detailedWheel(w.radius, w.width, style, s.tyre.sidewall_m);
        if (w.left) inner.rotation.y = Math.PI;
        m.add(inner);
      } else m = wheelMesh(w.radius, w.width);
      this.wheels.push(m);
      this.group.add(m);
    }
  }

  update(): void {
    const sim = this.sim;
    this.body.position.copy(sim.pos);
    this.body.quaternion.copy(sim.quat);
    sim.wheels.forEach((w, i) => {
      const m = this.wheels[i];
      m.position.copy(w.center);
      this.q.copy(sim.quat);
      this.qs.setFromAxisAngle(this.ax.set(0, 1, 0), -w.steer);
      this.q.multiply(this.qs);
      this.qs.setFromAxisAngle(this.ax.set(1, 0, 0), -w.spin);
      this.q.multiply(this.qs);
      m.quaternion.copy(this.q);
      // aired-down sidewall bulge: widen + slightly flatten
      const bulge = Math.min(1, w.tyre.deflection / (w.radius * 0.2));
      m.scale.set(1 + 0.16 * bulge, 1 - 0.04 * bulge, 1 - 0.04 * bulge);
    });
  }
}
