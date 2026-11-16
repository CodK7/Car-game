// Procedural vehicle bodies (original designs, no real logos or model shapes): a long-roof desert wagon and a
// single-cab pickup with a tray. Built from extruded side profiles with wheel-arch cut-outs plus simple parts.
// Body frame: +x right, +y up, -z forward, origin at the centre of mass (ground at y = -cgHeight).
import * as THREE from 'three';
import type { VehicleSpec } from './vehicleSim';
import { objMaterial } from '../gfx/objMaterial';
import { mergeGeos } from './vehicleView';

export interface BodyLayout {
  ground: number;
  zFront: number; // front-most point (bumper)
  zRear: number;
  zAxleF: number;
  zAxleR: number;
  hoodY: number;
  roofY: number;
  beltY: number;
  sillY: number;
  zCowl: number; // windscreen base
  zScreenTop: number;
  eyeCockpit: THREE.Vector3;
  eyeBonnet: THREE.Vector3;
}

export function bodyLayout(s: VehicleSpec): BodyLayout {
  const b = s.body;
  const ground = -s.cgHeight;
  const zAxleF = -s.wheelbase * (1 - s.frontWeightFrac);
  const zAxleR = zAxleF + s.wheelbase;
  const zFront = zAxleF - b.overhangF;
  const zRear = zFront + b.length;
  const hoodY = ground + Math.min(1.12, b.height * 0.58);
  const roofY = ground + b.height - 0.06; // minus roof rack / rails
  const beltY = hoodY + 0.08;
  const sillY = ground + b.groundClearance + 0.12;
  const zCowl = zFront + Math.min(1.45, b.length * 0.28);
  const zScreenTop = zCowl + 0.72;
  return {
    ground, zFront, zRear, zAxleF, zAxleR, hoodY, roofY, beltY, sillY, zCowl, zScreenTop,
    // left-hand drive (Oman drives on the right)
    eyeCockpit: new THREE.Vector3(-0.37, roofY - 0.42, zScreenTop + 0.55),
    eyeBonnet: new THREE.Vector3(0, hoodY + 0.2, zFront + 0.75),
  };
}

const PAINT: Record<string, number> = { patrol: 0xe8e4da, lc70: 0xc9c2ad };

/** Side profile (u = forward distance, v = height) with arch cut-outs, extruded across the body width. */
function profileBody(pts: [number, number][], archesU: number[], archR: number, bottom: number, width: number, bevel = 0.035): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  // pts run along the top from front to rear (u descending); then the bottom with arches from rear to front
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  const uRear = pts[pts.length - 1][0];
  const uFront = pts[0][0];
  shape.lineTo(uRear, bottom);
  const arches = [...archesU].sort((a, b) => a - b); // rear (smallest u) first
  for (const ua of arches) {
    const a0 = ua - archR, a1 = ua + archR;
    if (a0 <= uRear || a1 >= uFront) continue;
    shape.lineTo(a0, bottom);
    const n = 12;
    for (let k = 1; k < n; k++) {
      const t = Math.PI - (k / n) * Math.PI;
      shape.lineTo(ua + Math.cos(t) * archR, bottom + Math.sin(t) * archR * 0.95);
    }
    shape.lineTo(a1, bottom);
  }
  shape.lineTo(uFront, bottom);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  // shape x = u (forward), y = v, extrude along z → body: x across, z = -u
  g.rotateY(Math.PI / 2);
  g.translate(-(width - 2 * bevel) / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

const box = (w: number, h: number, l: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, l).translate(x, y, z);

export function buildBody(spec: VehicleSpec, kind: string, paintHex?: string): THREE.Group {
  const L = bodyLayout(spec);
  const W = spec.body.width;
  const r = spec.tyre.radius;
  const archR = r + 0.07;
  const g = new THREE.Group();
  const u = (z: number) => -z; // body z -> profile u
  const archY = L.ground + r - 0.02; // arch centre height (wheel centre at rest is about here)
  const bottom = archY;
  const paint = objMaterial({ color: paintHex ? new THREE.Color(paintHex).getHex() : PAINT[kind] ?? 0xdddddd, gloss: 0.45, receiveShadow: true });
  const dark = objMaterial({ color: 0x23211f, gloss: 0.1, receiveShadow: true });
  const trim = objMaterial({ color: 0x55524d, gloss: 0.2 });
  const glass = objMaterial({ color: 0x1b2730, gloss: 0.9 });
  const chrome = objMaterial({ color: 0xbfbcb4, gloss: 0.7 });
  const lamp = objMaterial({ color: 0xfff6e0, emissive: 0.6, gloss: 0.8 });
  const tail = objMaterial({ color: 0xa3150f, emissive: 0.25, gloss: 0.6 });
  const amber = objMaterial({ color: 0xe08a1c, emissive: 0.3, gloss: 0.6 });
  const arches = [u(L.zAxleF), u(L.zAxleR)];

  const paintGeos: THREE.BufferGeometry[] = [];
  const darkGeos: THREE.BufferGeometry[] = [];
  const trimGeos: THREE.BufferGeometry[] = [];
  const glassGeos: THREE.BufferGeometry[] = [];

  const uF = u(L.zFront), uR = u(L.zRear), uCowl = u(L.zCowl), uTop = u(L.zScreenTop);
  if (kind === 'lc70') {
    // single cab + tray
    const uCabRear = uTop - 1.0;
    const cab: [number, number][] = [
      [uF, L.hoodY - 0.18], [uF - 0.08, L.hoodY], [uCowl, L.hoodY + 0.06], [uTop, L.roofY], [uCabRear + 0.05, L.roofY], [uCabRear, L.roofY - 0.06], [uCabRear, bottom + 0.05],
    ];
    paintGeos.push(profileBody(cab, [arches[0]], archR, bottom - 0.06, W));
    // tray: open box behind the cab
    const trayY0 = L.ground + r + 0.18, trayY1 = L.hoodY + 0.05;
    const zt0 = -uCabRear + 0.08, zt1 = L.zRear;
    const tl = zt1 - zt0, tz = (zt0 + zt1) / 2;
    darkGeos.push(box(W - 0.1, 0.06, tl, 0, trayY0, tz)); // floor
    paintGeos.push(box(0.05, trayY1 - trayY0, tl, -W / 2 + 0.025, (trayY0 + trayY1) / 2, tz));
    paintGeos.push(box(0.05, trayY1 - trayY0, tl, W / 2 - 0.025, (trayY0 + trayY1) / 2, tz));
    paintGeos.push(box(W, trayY1 - trayY0, 0.05, 0, (trayY0 + trayY1) / 2, zt1 - 0.025)); // tailgate
    paintGeos.push(box(W, trayY1 - trayY0, 0.05, 0, (trayY0 + trayY1) / 2, zt0 + 0.025)); // headboard
    trimGeos.push(box(W * 0.8, 0.5, 0.04, 0, trayY1 + 0.25, zt0 + 0.02)); // headboard guard
    // rear arch flares on the tray
    for (const sx of [-1, 1]) darkGeos.push(box(0.08, 0.1, archR * 2.1, sx * (W / 2 + 0.01), trayY0 + 0.02, L.zAxleR));
    // cab windows
    glassGeos.push(box(W + 0.05, (L.roofY - L.beltY) * 0.78, 0.9, 0, L.beltY + (L.roofY - L.beltY) * 0.45, -uCabRear - 0.55)); // side windows
    glassGeos.push(box(W * 0.82, (L.roofY - L.beltY) * 0.6, 0.02, 0, L.beltY + (L.roofY - L.beltY) * 0.45, -uCabRear + 0.005)); // rear window
    // bull bar
    for (const sx of [-0.55, 0.55]) trimGeos.push(new THREE.CylinderGeometry(0.035, 0.035, L.hoodY - L.sillY + 0.15, 8).translate(sx, (L.hoodY + L.sillY) / 2, L.zFront - 0.12));
    trimGeos.push(new THREE.CylinderGeometry(0.035, 0.035, 1.25, 8).rotateZ(Math.PI / 2).translate(0, L.hoodY - 0.05, L.zFront - 0.12));
    // snorkel
    trimGeos.push(box(0.09, L.roofY - L.hoodY + 0.15, 0.09, W / 2 + 0.02, (L.roofY + L.hoodY) / 2 + 0.05, L.zCowl + 0.05));
  } else {
    // long-roof wagon
    const body: [number, number][] = [
      [uF, L.hoodY - 0.2], [uF - 0.1, L.hoodY], [uCowl, L.hoodY + 0.07], [uTop, L.roofY], [uR + 0.12, L.roofY], [uR, L.roofY - 0.1], [uR, bottom + 0.02],
    ];
    paintGeos.push(profileBody(body, arches, archR, bottom - 0.06, W));
    // greenhouse glass band (pillars painted over it below)
    const gl = -uR - 0.25 - (-uTop + 0.1);
    glassGeos.push(box(W + 0.05, (L.roofY - L.beltY) * 0.74, gl, 0, L.beltY + (L.roofY - L.beltY) * 0.45, (-uTop + 0.1 + (-uR - 0.25)) / 2));
    glassGeos.push(box(W * 0.84, (L.roofY - L.beltY) * 0.62, 0.02, 0, L.beltY + (L.roofY - L.beltY) * 0.45, L.zRear + 0.006)); // tailgate glass
    // B / C pillars
    const zb = (-uTop + -uR) / 2 - 0.35, zc = zb + 1.05;
    for (const z of [zb, zc]) paintGeos.push(box(W + 0.07, (L.roofY - L.beltY) * 0.8, 0.09, 0, L.beltY + (L.roofY - L.beltY) * 0.45, z));
    // roof rack
    for (const sx of [-1, 1]) trimGeos.push(box(0.05, 0.05, (L.zRear - L.zScreenTop) * 0.85, sx * (W / 2 - 0.12), L.roofY + 0.1, (L.zRear + L.zScreenTop) / 2 + 0.1));
    for (let i = 0; i < 4; i++) trimGeos.push(box(W - 0.2, 0.035, 0.05, 0, L.roofY + 0.1, L.zScreenTop + 0.4 + i * 0.75));
    // spare wheel on the rear door
    const spare = new THREE.CylinderGeometry(r * 0.95, r * 0.95, 0.24, 20).rotateX(Math.PI / 2).translate(0.2, L.beltY - 0.15, L.zRear + 0.14);
    darkGeos.push(spare);
    // arch flares
    for (const za of [L.zAxleF, L.zAxleR]) for (const sx of [-1, 1]) darkGeos.push(box(0.07, 0.08, archR * 2.1, sx * (W / 2 + 0.005), bottom + archR * 0.75, za));
  }
  // windscreen (raked plane, see-through) + A-pillars + headliner so the cockpit view has a frame
  const screenGeos: THREE.BufferGeometry[] = [];
  {
    const y0 = L.hoodY + 0.07;
    const len = Math.hypot(uCowl - uTop, L.roofY - y0);
    const ang = Math.atan2(L.roofY - y0, uCowl - uTop); // rear (larger z) end goes up
    const yc = (L.roofY + y0) / 2, zc = (L.zCowl + L.zScreenTop) / 2;
    screenGeos.push(new THREE.BoxGeometry(W * 0.9, 0.012, len).rotateX(-ang).translate(0, yc + 0.01, zc));
    for (const sx of [-1, 1]) paintGeos.push(new THREE.BoxGeometry(0.09, 0.07, len + 0.04).rotateX(-ang).translate(sx * (W / 2 - 0.05), yc + 0.02, zc));
    darkGeos.push(box(W - 0.12, 0.03, Math.max(0.6, (kind === 'lc70' ? 1.0 : L.zRear - L.zScreenTop) - 0.2), 0, L.roofY - 0.07, L.zScreenTop + (kind === 'lc70' ? 0.5 : (L.zRear - L.zScreenTop) / 2)));
  }
  // bumpers, grille, lamps, mirrors, side steps
  darkGeos.push(box(W + 0.04, 0.22, 0.18, 0, L.sillY + 0.05, L.zFront + 0.05));
  darkGeos.push(box(W + 0.02, 0.2, 0.16, 0, L.sillY + 0.05, L.zRear - 0.04));
  darkGeos.push(box(W * 0.5, (L.hoodY - L.sillY) * 0.45, 0.04, 0, L.hoodY - (L.hoodY - L.sillY) * 0.3, L.zFront - 0.005));
  for (const sx of [-1, 1]) {
    darkGeos.push(box(0.28, 0.05, (L.zAxleR - L.zAxleF) - archR * 2.3, sx * (W / 2 - 0.05), L.sillY - 0.02, (L.zAxleF + L.zAxleR) / 2)); // step
    trimGeos.push(box(0.08, 0.14, 0.18, sx * (W / 2 + 0.11), L.beltY + 0.12, L.zCowl + 0.15)); // mirror
  }
  const lampGeos: THREE.BufferGeometry[] = [], tailGeos: THREE.BufferGeometry[] = [], amberGeos: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    lampGeos.push(new THREE.CylinderGeometry(0.085, 0.085, 0.03, 16).rotateX(Math.PI / 2).translate(sx * W * 0.36, L.hoodY - 0.16, L.zFront - 0.012));
    amberGeos.push(box(0.12, 0.05, 0.03, sx * W * 0.36, L.hoodY - 0.3, L.zFront - 0.01));
    tailGeos.push(box(0.1, 0.24, 0.03, sx * (W / 2 - 0.08), L.beltY - 0.12, L.zRear + 0.012));
  }
  const add = (geos: THREE.BufferGeometry[], m: THREE.Material) => {
    if (!geos.length) return;
    const mesh = new THREE.Mesh(mergeGeos(geos.map((x) => (x.index ? x : x)).map(nonIndexedSafe)), m);
    g.add(mesh);
  };
  add(paintGeos, paint);
  add(darkGeos, dark);
  add(trimGeos, trim);
  add(glassGeos, glass);
  add(screenGeos, objMaterial({ color: 0x1b2730, gloss: 0.9, transparent: true, opacity: 0.28 }));
  add(lampGeos, lamp);
  add(tailGeos, tail);
  add(amberGeos, amber);
  // interior for the cockpit camera: dashboard + steering wheel
  const inner = objMaterial({ color: 0x4a4640, gloss: 0.15 });
  const dash = new THREE.Mesh(box(W - 0.2, 0.14, 0.45, 0, L.hoodY + 0.02, L.zCowl + 0.32), inner);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.022, 6, 20).rotateX(-1.1).translate(L.eyeCockpit.x, L.eyeCockpit.y - 0.3, L.eyeCockpit.z - 0.45), trim);
  // cabin tub seen from inside (BackSide): floor and door cards up to the belt line, so the cockpit view is not see-through
  const zCabEnd = kind === 'lc70' ? L.zScreenTop + 1.0 : L.zRear - 0.1;
  const tub = new THREE.Mesh(box(W - 0.14, L.beltY - L.sillY - 0.05, zCabEnd - L.zCowl, 0, (L.beltY + L.sillY + 0.05) / 2, (L.zCowl + zCabEnd) / 2), objMaterial({ color: 0x5a554e, side: THREE.BackSide }));
  g.add(tub);
  g.add(dash, wheel);
  void chrome;
  return g;
}

/** ExtrudeGeometry is non-indexed and has uv; keep only position + normal for mergeGeos. */
function nonIndexedSafe(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', geo.getAttribute('position'));
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  out.setAttribute('normal', geo.getAttribute('normal'));
  if (geo.index) out.setIndex(geo.index);
  return out;
}
