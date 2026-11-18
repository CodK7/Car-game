// High-detail procedural vehicle bodies (original shapes from public dimensions, no logos or badges).
// Each body is lofted from smooth profiles in src/config/bodies.json:
//   lower body  = cross-sections (rocker tuck, side, rounded shoulder, crowned bonnet/roof) along the length, with
//                 exact wheel-arch openings (the panel's lower edge follows the arch circle), capped nose and tail;
//   glasshouse  = cross-sections with tumblehome from the windscreen base to the rear glass, split into windscreen /
//                 side glass / pillars / roof by material.
// Details (lamps, grilles, bumpers, mirrors, handles, seams, flares, rails, steps, bed, interior) are built on the
// same analytic surfaces so they sit flush. Body frame: +x right, +y up, -z forward, origin at the centre of mass.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PRESETS, type VehicleSpec } from './vehicleSim';
import { objMaterial } from '../gfx/objMaterial';
import { mergeGeos } from './vehicleView';
import type { WheelStyle } from './wheelMesh';
import { attachModel, type ModelDef } from './modelBody';
import designs from '../config/bodies.json';

type Pt = [number, number];
interface Design {
  style: 'sedan' | 'suv' | 'pickup';
  paint: string;
  widthCore: number;
  bedU?: number;
  lower: { top: Pt[]; bottom: Pt[]; plan: Pt[]; cornerR: number; crown: number; tuck: number; tuckV: number; blackBelowV: number };
  cabin: { u0: number; u3: number; screenTop: number; roofEnd: number; top: Pt[]; tumble: number; cornerR: number; pillars: [number, number, string][]; belt: string };
  flares?: { mat: string; width: number; out: number };
  roofRails?: boolean;
  sideSteps?: boolean;
  snorkel?: boolean;
  wheel: WheelStyle;
  /** optional imported model (public/local, git-ignored) that replaces this procedural body when present */
  model?: ModelDef;
}
const DESIGNS = designs as unknown as Record<string, Design>;
const KIND_BY_LABEL: Record<string, string> = {};
for (const [k, s] of Object.entries(PRESETS)) if (!k.startsWith('_')) KIND_BY_LABEL[s.label] = k;

/** cockpit eye of a loaded imported model, per body kind (body frame) */
const MODEL_EYE = new Map<string, THREE.Vector3>();

function designFor(spec: VehicleSpec, kind?: string): { kind: string; d: Design } {
  const k = kind && DESIGNS[kind] ? kind : KIND_BY_LABEL[spec.label] && DESIGNS[KIND_BY_LABEL[spec.label]] ? KIND_BY_LABEL[spec.label] : 'patrol';
  return { kind: k, d: DESIGNS[k] };
}

// ---------------------------------------------------------------- profile curves
/** Monotone cubic (Fritsch-Carlson) interpolation through sorted [u, v] points; clamps outside. */
function pchip(pts: Pt[]): (u: number) => number {
  const n = pts.length;
  const x = pts.map((p) => p[0]), y = pts.map((p) => p[1]);
  const d: number[] = [], m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((y[i + 1] - y[i]) / Math.max(1e-6, x[i + 1] - x[i]));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = harmonic(d[i - 1], d[i]);
  return (u: number) => {
    if (u <= x[0]) return y[0];
    if (u >= x[n - 1]) return y[n - 1];
    let i = 0;
    while (i < n - 2 && u > x[i + 1]) i++;
    const h = x[i + 1] - x[i], t = (u - x[i]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * y[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * y[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
function harmonic(a: number, b: number): number {
  return a * b <= 0 ? 0 : (2 * a * b) / (a + b);
}
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---------------------------------------------------------------- analytic body surface
class BodyShape {
  readonly L: number;
  readonly W2: number;
  readonly ground: number;
  readonly zF: number;
  readonly axles: number[];
  readonly archR: number;
  readonly archC: number;
  readonly vLow: number;
  readonly top: (u: number) => number;
  readonly botRaw: (u: number) => number;
  readonly plan: (u: number) => number;
  readonly cabTop: (u: number) => number;

  constructor(readonly spec: VehicleSpec, readonly d: Design) {
    const b = spec.body;
    this.L = b.length;
    this.W2 = (b.width / 2) * d.widthCore;
    this.ground = -spec.cgHeight;
    const zAxleF = -spec.wheelbase * (1 - spec.frontWeightFrac);
    this.zF = zAxleF - b.overhangF;
    this.axles = [b.overhangF, b.overhangF + spec.wheelbase];
    this.archR = spec.tyre.radius + (d.style === 'sedan' ? 0.045 : 0.075);
    this.archC = spec.tyre.radius - 0.02;
    this.vLow = Math.min(...d.lower.bottom.map((p) => p[1])) - 0.01;
    this.top = pchip(d.lower.top);
    this.botRaw = pchip(d.lower.bottom);
    this.plan = pchip(d.lower.plan);
    this.cabTop = pchip(d.cabin.top);
  }

  /** lower edge of the side panel: sill/bumper line, raised over the wheels by the arch openings */
  bot(u: number): number {
    let v = this.botRaw(u);
    for (const ua of this.axles) {
      const dd = Math.abs(u - ua);
      if (dd <= this.archR) v = Math.max(v, this.archC + Math.sqrt(this.archR * this.archR - dd * dd) * 0.98);
    }
    return v;
  }
  hw(u: number): number {
    return this.W2 * this.plan(u);
  }
  R(u: number): number {
    return Math.min(this.d.lower.cornerR, (this.top(u) - this.botRaw(u)) * 0.35);
  }
  sh(u: number): number {
    return this.top(u) - this.R(u);
  }
  /** half width of the side panel at height v (tucks in towards the rocker) */
  sideX(u: number, v: number): number {
    const lo = this.d.lower;
    return this.hw(u) * (1 - lo.tuck * smooth(lo.tuckV, this.vLow, v));
  }
  /** where the flat top ends and the shoulder radius starts */
  xe(u: number): number {
    return Math.max(0.05, this.sideX(u, this.sh(u)) - this.R(u));
  }
  /** height of the top surface (bonnet / belt / boot incl. shoulder) at lateral x */
  topAt(u: number, x: number): number {
    const xe = this.xe(u), R = this.R(u), ax = Math.abs(x);
    if (ax <= xe) return this.top(u) + this.d.lower.crown * (1 - (ax / xe) ** 2);
    const dx = Math.min(R, ax - xe);
    return this.sh(u) + Math.sqrt(Math.max(0, R * R - dx * dx));
  }
  P(x: number, v: number, u: number): THREE.Vector3 {
    return new THREE.Vector3(x, this.ground + v, this.zF + u);
  }

  /** lower-body cross-section from the left rocker over the top to the right rocker. reg: 0 side, 1 corner, 2 top */
  lowerSection(u: number, inset = 0): { x: number; v: number; reg: number }[] {
    const NS = 12, NC = 6, NT = 10;
    const out: { x: number; v: number; reg: number }[] = [];
    const sh = this.sh(u), R = Math.max(0.005, this.R(u) - inset), xe = this.xe(u), bot = this.bot(u);
    const left: { x: number; v: number; reg: number }[] = [];
    for (let k = 0; k <= NS; k++) {
      const v = Math.max(lerp(this.vLow, sh, k / NS), bot);
      left.push({ x: -(this.sideX(u, v) - inset), v, reg: 0 });
    }
    for (let j = 1; j <= NC; j++) {
      const th = (j / NC) * (Math.PI / 2);
      left.push({ x: -(xe + R * Math.cos(th)), v: sh + R * Math.sin(th) - (j === NC ? 0 : 0), reg: 1 });
    }
    out.push(...left);
    const xt = xe;
    for (let j = 1; j < NT; j++) {
      const x = lerp(-xt, xt, j / NT);
      out.push({ x, v: this.topAt(u, x) - inset, reg: 2 });
    }
    for (let i = left.length - 1; i >= 0; i--) out.push({ x: -left[i].x, v: left[i].v, reg: left[i].reg });
    return out;
  }

  /** glasshouse base (sits on the shoulder) and section */
  cabBase(u: number): { xb: number; vb: number } {
    const xe = this.xe(u), R = this.R(u);
    const xb = xe + R * 0.45;
    return { xb, vb: this.topAt(u, xb) - 0.012 };
  }
  static GT = [0, 0.035, 0.12, 0.26, 0.42, 0.58, 0.74, 0.88, 0.95, 1.0];
  cabSection(u: number, inset = 0): { x: number; v: number; reg: number; k: number }[] {
    const c = this.d.cabin;
    const { xb, vb } = this.cabBase(u);
    const ct = Math.max(vb + 0.002, this.cabTop(u)) - inset;
    const hgt = ct - vb;
    const Rg = Math.max(0.002, Math.min(c.cornerR, hgt * 0.45) - inset * 0.5);
    const xr = xb - c.tumble * hgt - inset;
    const out: { x: number; v: number; reg: number; k: number }[] = [];
    const left: { x: number; v: number; reg: number; k: number }[] = [];
    BodyShape.GT.forEach((t, k) => left.push({ x: -lerp(xb - inset, xr, t), v: lerp(vb, ct - Rg, t), reg: 0, k }));
    const NC = 6;
    for (let j = 1; j <= NC; j++) {
      const th = (j / NC) * (Math.PI / 2);
      left.push({ x: -(xr - Rg + Rg * Math.cos(th)), v: ct - Rg + Rg * Math.sin(th), reg: 1, k: j });
    }
    out.push(...left);
    const NT = 12, xt = xr - Rg;
    for (let j = 1; j < NT; j++) {
      const x = lerp(-xt, xt, j / NT);
      out.push({ x, v: ct + 0.018 * (1 - (x / xt) ** 2), reg: 2, k: j });
    }
    for (let i = left.length - 1; i >= 0; i--) out.push({ ...left[i], x: -left[i].x });
    return out;
  }
}

// ---------------------------------------------------------------- geometry helpers
type MatKey = string;
class Parts {
  map = new Map<MatKey, THREE.BufferGeometry[]>();
  add(key: MatKey, g: THREE.BufferGeometry): void {
    const c = clean(g);
    (this.map.get(key) ?? this.map.set(key, []).get(key)!).push(c);
  }
}

function clean(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', geo.getAttribute('position'));
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  out.setAttribute('normal', geo.getAttribute('normal'));
  if (geo.index) out.setIndex(geo.index);
  return out;
}

/**
 * Loft: stations × section points → one shared vertex grid with smooth normals, split by material.
 * classify(uMid, quad info) returns a material key or null (skip the quad).
 */
function loft<T extends { x: number; v: number; reg: number }>(
  S: BodyShape, us: number[], section: (u: number) => T[], classify: (u: number, a: T, b: T, j: number) => MatKey | null, parts: Parts, flip = false,
): void {
  const rows = us.map((u) => section(u));
  const n = rows[0].length;
  const pos = new Float32Array(us.length * n * 3);
  rows.forEach((row, i) => row.forEach((p, j) => {
    const o = (i * n + j) * 3;
    pos[o] = p.x;
    pos[o + 1] = S.ground + p.v;
    pos[o + 2] = S.zF + us[i];
  }));
  const all: number[] = [];
  const byMat = new Map<MatKey, number[]>();
  for (let i = 0; i < us.length - 1; i++) {
    const um = (us[i] + us[i + 1]) / 2;
    for (let j = 0; j < n - 1; j++) {
      const a = i * n + j, b = (i + 1) * n + j, c = (i + 1) * n + j + 1, dd = i * n + j + 1;
      // winding: outward normals (sections run left→over→right, stations run forward→back)
      const tri = flip ? [a, dd, b, b, dd, c] : [a, b, dd, b, c, dd];
      all.push(...tri);
      const key = classify(um, rows[i][j], rows[i][j + 1], j);
      if (key) (byMat.get(key) ?? byMat.set(key, []).get(key)!).push(...tri);
    }
  }
  const base = new THREE.BufferGeometry();
  base.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  base.setIndex(all);
  base.computeVertexNormals();
  const nor = base.getAttribute('normal');
  for (const [key, idx] of byMat) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('normal', nor);
    g.setIndex(idx);
    parts.add(key, g);
  }
}

/** flat fan cap over a section polygon (closed along the bottom) at station u, facing dir (-1 front, +1 rear) */
function cap(S: BodyShape, u: number, pts: { x: number; v: number }[], dir: number): THREE.BufferGeometry {
  const cx = 0, cv = pts.reduce((s, p) => s + p.v, 0) / pts.length;
  const pos: number[] = [S.ground + 0, 0, 0];
  pos.length = 0;
  pos.push(cx, S.ground + cv, S.zF + u);
  for (const p of pts) pos.push(p.x, S.ground + p.v, S.zF + u);
  const idx: number[] = [];
  const m = pts.length;
  for (let i = 0; i < m; i++) {
    const a = 1 + i, b = 1 + ((i + 1) % m);
    // sections run -x → over the top → +x: counter-clockwise seen from the front
    if (dir < 0) idx.push(0, a, b);
    else idx.push(0, b, a);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** grid patch from a parametric function (a, b in [0,1]) → body-frame point, pushed out along its normal */
function patch(fn: (a: number, b: number) => THREE.Vector3, na: number, nb: number, out = 0, flip = false): THREE.BufferGeometry {
  const pos = new Float32Array((na + 1) * (nb + 1) * 3);
  for (let i = 0; i <= na; i++) for (let j = 0; j <= nb; j++) {
    const p = fn(i / na, j / nb);
    pos.set([p.x, p.y, p.z], (i * (nb + 1) + j) * 3);
  }
  const idx: number[] = [];
  for (let i = 0; i < na; i++) for (let j = 0; j < nb; j++) {
    const a = i * (nb + 1) + j, b = (i + 1) * (nb + 1) + j, c = b + 1, d = a + 1;
    if (flip) idx.push(a, d, b, b, d, c);
    else idx.push(a, b, d, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (out) {
    const n = g.getAttribute('normal');
    for (let i = 0; i < n.count; i++) pos.set([pos[i * 3] + n.getX(i) * out, pos[i * 3 + 1] + n.getY(i) * out, pos[i * 3 + 2] + n.getZ(i) * out], i * 3);
    g.getAttribute('position').needsUpdate = true;
  }
  return g;
}

const rbox = (w: number, h: number, l: number, r: number, x: number, y: number, z: number, seg = 2) =>
  new RoundedBoxGeometry(w, h, l, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, l / 2 - 1e-3)).translate(x, y, z);
const box = (w: number, h: number, l: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, l).translate(x, y, z);
const cyl = (r: number, len: number, seg: number) => new THREE.CylinderGeometry(r, r, len, seg);

// ---------------------------------------------------------------- seating
/** Eye positions (u) of the front and rear rows: heads sit just ahead of the B / C pillars, as in real cabins. */
function seatPlan(d: Design): { eyeF: number; eyeR: number | null } {
  const c = d.cabin;
  const after = c.pillars.filter((p) => p[0] > c.screenTop - 0.1).map((p) => p[0]).sort((a, b) => a - b);
  const uB = after[0] ?? c.u3 - 0.1;
  const eyeF = uB - 0.22;
  const uC = after[1];
  const eyeR = d.style === 'pickup' || uC === undefined ? null : uC - 0.3;
  return { eyeF, eyeR };
}

// ---------------------------------------------------------------- layout for cameras / tests
export interface BodyLayout {
  ground: number;
  zFront: number;
  zRear: number;
  zAxleF: number;
  zAxleR: number;
  hoodY: number;
  roofY: number;
  beltY: number;
  sillY: number;
  zCowl: number;
  zScreenTop: number;
  eyeCockpit: THREE.Vector3;
  eyeBonnet: THREE.Vector3;
}

export function bodyLayout(s: VehicleSpec, kind?: string): BodyLayout {
  const { kind: k, d } = designFor(s, kind);
  const S = new BodyShape(s, d);
  const c = d.cabin;
  const roofV = S.cabTop((c.screenTop + c.roofEnd) / 2);
  const uEye = seatPlan(d).eyeF;
  const eyeV = Math.min(S.cabTop(uEye), roofV) - (d.style === 'sedan' ? 0.28 : 0.31);
  return {
    ground: S.ground,
    zFront: S.zF,
    zRear: S.zF + S.L,
    zAxleF: S.zF + S.axles[0],
    zAxleR: S.zF + S.axles[1],
    hoodY: S.ground + S.top(c.u0),
    roofY: S.ground + roofV,
    beltY: S.ground + S.top((c.u0 + c.u3) / 2),
    sillY: S.ground + S.botRaw(S.L / 2),
    zCowl: S.zF + c.u0,
    zScreenTop: S.zF + c.screenTop,
    // left-hand drive (Oman drives on the right)
    eyeCockpit: MODEL_EYE.get(k)?.clone() ?? new THREE.Vector3(-0.37, S.ground + eyeV, S.zF + uEye),
    eyeBonnet: new THREE.Vector3(0, S.ground + S.topAt(0.9, 0) + 0.2, S.zF + 0.9),
  };
}

// ---------------------------------------------------------------- materials
function materials(paintHex: string, d: Design): Record<string, THREE.Material> {
  const interior = d.style === 'pickup' || d.style === 'suv' && d.paint === DESIGNS.patrol?.paint ? 0x6e6455 : 0x2b2927;
  return {
    paint: objMaterial({ color: paintHex, gloss: 0.8, receiveShadow: true, side: THREE.DoubleSide }),
    black: objMaterial({ color: 0x17181a, gloss: 0.18, receiveShadow: true, side: THREE.DoubleSide }),
    satin: objMaterial({ color: 0x26272a, gloss: 0.35, receiveShadow: true, side: THREE.DoubleSide }),
    chrome: objMaterial({ color: 0xd6d9dc, gloss: 1.0, side: THREE.DoubleSide }),
    alu: objMaterial({ color: 0xa9adb1, gloss: 0.6, side: THREE.DoubleSide }),
    glass: objMaterial({ color: 0x0b1216, gloss: 1.0, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
    screen: objMaterial({ color: 0x14202a, gloss: 1.0, transparent: true, opacity: 0.32, side: THREE.DoubleSide }),
    lens: objMaterial({ color: 0xcfdbe4, gloss: 1.0, emissive: 0.18, side: THREE.DoubleSide }),
    reflector: objMaterial({ color: 0x3d4349, gloss: 1.0, emissive: 0.02, side: THREE.DoubleSide }),
    drl: objMaterial({ color: 0xf4f8ff, emissive: 1.4, gloss: 0.6, side: THREE.DoubleSide }),
    tail: objMaterial({ color: 0x8e0d0a, emissive: 0.45, gloss: 0.9, side: THREE.DoubleSide }),
    tailDark: objMaterial({ color: 0x3a0605, emissive: 0.15, gloss: 0.9, side: THREE.DoubleSide }),
    amber: objMaterial({ color: 0xe0861a, emissive: 0.35, gloss: 0.9, side: THREE.DoubleSide }),
    plate: objMaterial({ color: 0xf2efe6, gloss: 0.3, side: THREE.DoubleSide }),
    rubber: objMaterial({ color: 0x111111, gloss: 0.05, side: THREE.DoubleSide }),
    interior: objMaterial({ color: interior, gloss: 0.08, side: THREE.BackSide }),
    seat: objMaterial({ color: interior, gloss: 0.12 }),
    dash: objMaterial({ color: 0x232220, gloss: 0.15 }),
    liner: objMaterial({ color: 0x0d0d0d, gloss: 0.02, side: THREE.DoubleSide }),
    gauge: objMaterial({ color: 0x1d2a33, emissive: 0.35, gloss: 0.9 }),
    mirror: objMaterial({ color: 0x8fa0ab, gloss: 1.0, side: THREE.DoubleSide }),
  };
}

// ---------------------------------------------------------------- body builder
export function buildBody(spec: VehicleSpec, kindIn: string, paintHex?: string): THREE.Group {
  const { kind, d } = designFor(spec, kindIn);
  const S = new BodyShape(spec, d);
  const c = d.cabin;
  const L = S.L;
  const parts = new Parts();
  const ex = new Parts(); // exterior details without shadow casting
  const inner = new Parts();

  // ---- stations along the body: uniform, refined over the arches, exact at arch edges and cabin ends
  const us = new Set<number>();
  for (let u = 0; u <= L + 1e-6; u += 0.075) us.add(+u.toFixed(4));
  for (let u = 0; u <= 0.3; u += 0.03) { us.add(+u.toFixed(4)); us.add(+(L - u).toFixed(4)); } // rounded nose / tail
  us.add(L);
  for (const ua of S.axles) {
    for (let t = -1; t <= 1; t += 0.1) us.add(+(ua + t * S.archR).toFixed(4));
    for (const t of [-0.98, -0.94, 0.94, 0.98]) us.add(+(ua + t * S.archR).toFixed(4));
    for (const e of [-1, 1]) {
      us.add(+(ua + e * S.archR).toFixed(4));
      us.add(+(ua + e * (S.archR + 0.004)).toFixed(4));
    }
  }
  for (const u of [c.u0, c.u3, d.bedU ?? -1]) if (u > 0 && u < L) us.add(u);
  const stations = [...us].filter((u) => u >= 0 && u <= L).sort((a, b) => a - b);

  const cabIn = (u: number) => u > c.u0 + 0.01 && u < c.u3 - 0.01;
  const inBed = (u: number) => d.bedU !== undefined && u > d.bedU && u < L - 0.05;
  const lowerMat = (v: number) => (v < d.lower.blackBelowV ? 'black' : 'paint');
  loft(S, stations, (u) => S.lowerSection(u), (u, a, b) => {
    if (a.reg === 2 && b.reg === 2 && (cabIn(u) || inBed(u))) return null; // open under the glasshouse / pickup bed
    return lowerMat((a.v + b.v) / 2);
  }, parts);
  // nose and tail caps (fascia / tailgate)
  for (const [u, dir] of [[0, -1], [L, 1]] as [number, number][]) {
    const sec = S.lowerSection(u);
    parts.add('paint', cap(S, u, sec, dir));
  }

  // ---- glasshouse
  const cs = new Set<number>();
  for (let u = c.u0; u <= c.u3 + 1e-6; u += 0.06) cs.add(+u.toFixed(4));
  for (const u of [c.u3, c.screenTop, c.roofEnd, ...c.pillars.flat().filter((x) => typeof x === 'number') as number[]]) if (u >= c.u0 && u <= c.u3) cs.add(u);
  const cst = [...cs].sort((a, b) => a - b);
  const nGT = BodyShape.GT.length - 1;
  const pillarAt = (u: number) => c.pillars.find(([a, b]) => u > a && u < b)?.[2];
  loft(S, cst, (u) => S.cabSection(u), (u, a, b) => {
    if (a.reg === 2 && b.reg === 2) return u < c.screenTop ? 'screen' : u > c.roofEnd ? 'glass' : 'paint';
    if (a.reg === 1 || b.reg === 1) return u < c.screenTop - 0.02 || u > c.roofEnd + 0.02 ? 'paint' : 'paint';
    // side band
    const k = Math.min(a.k, b.k);
    if (k === 0) return c.belt;
    const p = pillarAt(u);
    if (p) return p;
    if (k === nGT - 1) return 'black';
    return 'glass';
  }, parts);
  {
    const sec = S.cabSection(c.u3);
    parts.add('paint', cap(S, c.u3, sec, 1));
  }
  // interior shells (seen from inside / through the glass)
  const cstIn = cst.filter((u, i) => i % 3 === 0 || u === c.u3 || u === c.screenTop || u === c.roofEnd);
  loft(S, cstIn, (u) => S.cabSection(u, 0.018), (u, a, b) => {
    if (a.reg === 2 && b.reg === 2) return u > c.screenTop + 0.03 && u < c.roofEnd - 0.03 ? 'interior' : null;
    if (a.reg === 1 || b.reg === 1) return 'interior';
    const p = pillarAt(u);
    return p ? 'interior' : null;
  }, inner);
  const cabStations = stations.filter((u, i) => u >= c.u0 && u <= c.u3 && (i % 3 === 0 || u === c.u0 || u === c.u3));
  loft(S, cabStations, (u) => S.lowerSection(u, 0.035), (_u, a, b) => (a.reg === 2 && b.reg === 2 ? null : 'interior'), inner);

  // ---- wheel arches: dark liners, and flares where the design has them
  const uCabMid = (c.u0 + c.u3) / 2;
  for (const ua of S.axles) {
    for (const side of [-1, 1]) {
      const xo = S.sideX(ua, S.archC + S.archR * 0.5) - 0.01;
      const depth = 0.42;
      inner.add('liner', patch((a, b) => {
        const th = a * Math.PI;
        return S.P(side * (xo - b * depth), S.archC + Math.sin(th) * S.archR * 0.99, ua + Math.cos(th) * S.archR * 0.99);
      }, 20, 2, 0, side < 0));
      if (d.flares) {
        const f = d.flares;
        ex.add(f.mat, patch((a, b) => {
          const th = -0.05 + a * (Math.PI + 0.1);
          const r = S.archR + 0.004 + b * f.width;
          const uu = ua + Math.cos(th) * r, vv = S.archC + Math.sin(th) * r;
          const bump = f.out * Math.pow(Math.sin(Math.min(1, b * 1.15) * Math.PI * 0.5 + (b > 0.85 ? (b - 0.85) * 6 : 0)), 0.7);
          const lip = b < 0.08 ? -0.015 * (1 - b / 0.08) : 0;
          return S.P(side * (S.sideX(uu, vv) + bump + lip + 0.003), vv, uu);
        }, 26, 6, 0, side < 0));
      }
    }
  }

  // ---- underbody between the wheels
  {
    const halfIn = Math.min(spec.trackF, spec.trackR) / 2 - spec.tyre.width / 2 - 0.05;
    const v = S.botRaw(L / 2) + 0.03;
    inner.add('black', box(halfIn * 2, 0.02, L - 0.3, 0, S.ground + v, S.zF + L / 2));
  }

  // ---- shared details
  const beltU = (u: number) => S.top(u);
  // mirrors (door-mounted, at the front of the side glass)
  const um = c.u0 + (d.style === 'sedan' ? 0.42 : 0.3);
  for (const side of [-1, 1]) {
    const xs = S.sideX(um, beltU(um));
    const big = d.style !== 'sedan';
    const w = big ? 0.12 : 0.1, h = big ? 0.2 : 0.14, l = big ? 0.11 : 0.1;
    const x = side * (xs + w * 0.5 + 0.035), y = S.ground + beltU(um) + h * 0.5 + 0.05, z = S.zF + um + 0.02;
    parts.add(d.style === 'pickup' ? 'black' : 'paint', rbox(w, h, l, 0.04, x, y, z, 3));
    ex.add('mirror', box(w * 0.82, h * 0.78, 0.004, x, y, z + l / 2 + 0.002));
    ex.add('black', rbox(0.05, 0.05, 0.08, 0.015, side * (xs + 0.02), y - h * 0.35, z, 1));
    ex.add('amber', box(0.012, 0.018, l * 0.6, x + side * (w / 2), y - h * 0.15, z - 0.005));
  }
  // door seams, handles
  const doors: number[] = [];
  const front0 = S.axles[0] + S.archR + 0.06;
  const pB = c.pillars.find((p) => p[2] === 'black' && p[0] > c.screenTop - 0.1);
  const uB = pB ? (pB[0] + pB[1]) / 2 : c.u0 + 1.05;
  doors.push(front0, uB);
  const pC = c.pillars.filter((p) => p[2] === 'black' && p[0] > uB + 0.2)[0];
  if (d.style !== 'pickup') doors.push(d.style === 'sedan' ? Math.min(S.axles[1] - S.archR + 0.04, c.pillars[c.pillars.length - 1][0] + 0.05) : pC ? (pC[0] + pC[1]) / 2 : uB + 1.0);
  else doors[1] = c.u3 - 0.02;
  for (const side of [-1, 1]) {
    for (const u of doors) {
      ex.add('black', patch((a, b) => {
        const uu = u + (b - 0.5) * 0.006;
        const vv = lerp(Math.max(S.bot(uu), S.botRaw(uu)) + 0.02, beltU(uu) - 0.02, a);
        return S.P(side * (S.sideX(uu, vv) + 0.0015), vv, uu);
      }, 10, 1, 0, side > 0));
    }
    for (let i = 0; i < doors.length - 1; i++) {
      const uh = doors[i + 1] - 0.3;
      const vh = beltU(uh) - 0.1;
      ex.add(d.cabin.belt === 'chrome' ? 'chrome' : 'black', rbox(0.035, 0.035, 0.17, 0.014, side * (S.sideX(uh, vh) + 0.012), S.ground + vh, S.zF + uh, 2));
    }
  }
  // wipers
  for (const side of [-1, 1]) {
    const u = c.u0 + 0.08, x0 = side * 0.05;
    ex.add('black', box(0.6, 0.012, 0.02, x0 + side * 0.3, S.ground + S.cabTop(u) + 0.01, S.zF + u).rotateY(side * 0.08));
  }
  // plates (blank, no text)
  {
    const v0 = S.botRaw(0) + 0.09;
    ex.add('plate', box(0.5, 0.12, 0.012, 0, S.ground + v0 + 0.06, S.zF - 0.01 - (d.style === 'sedan' ? 0 : 0.06)));
    ex.add('plate', box(0.5, 0.12, 0.012, 0, S.ground + S.botRaw(L) + 0.22, S.zF + L + 0.008));
  }

  // ---- style-specific: fascia, lamps, bumpers, rear
  if (kind === 'camry') camryDetails(S, parts, ex);
  else if (kind === 'lc300') lc300Details(S, parts, ex);
  else if (kind === 'patrol') patrolDetails(S, parts, ex);
  else lc70Details(S, parts, ex);
  if (d.roofRails) {
    const v = S.cabTop(uCabMid);
    for (const side of [-1, 1]) {
      const u0 = c.screenTop + 0.12, u1 = c.roofEnd - 0.06;
      const xr = S.cabBase(uCabMid).xb - c.tumble * (v - S.cabBase(uCabMid).vb) - 0.09;
      ex.add('satin', patch((a, b) => {
        const u = lerp(u0, u1, a);
        const th = b * Math.PI;
        const lift = 0.05 * Math.min(1, Math.min(a, 1 - a) * 12);
        return S.P(side * (xr + Math.cos(th) * 0.022), S.cabTop(u) + 0.012 + lift + Math.sin(th) * 0.022, u);
      }, 40, 6, 0, side > 0));
    }
  }
  if (d.sideSteps) {
    const u0 = S.axles[0] + S.archR + 0.08, u1 = S.axles[1] - S.archR - 0.08;
    for (const side of [-1, 1]) {
      const v = S.botRaw((u0 + u1) / 2) - 0.03;
      const x = side * (S.sideX((u0 + u1) / 2, v) - 0.02);
      ex.add('black', rbox(0.2, 0.05, u1 - u0, 0.02, x, S.ground + v, S.zF + (u0 + u1) / 2, 2));
      ex.add('alu', box(0.16, 0.006, u1 - u0 - 0.08, x + side * 0.01, S.ground + v + 0.027, S.zF + (u0 + u1) / 2));
    }
  }
  if (d.snorkel) {
    const u = c.u0 - 0.12, x = S.sideX(u, S.top(u) - 0.1) + 0.05;
    ex.add('black', rbox(0.1, 0.36, 0.1, 0.035, x, S.ground + S.top(u) - 0.05, S.zF + u, 2));
    ex.add('black', patch((a, b) => {
      const v = lerp(S.top(u) + 0.1, S.cabTop(c.screenTop) + 0.05, a);
      const uu = lerp(u, c.u0 + (c.screenTop - c.u0) * 0.92, a) + 0.0;
      const th = b * Math.PI * 2;
      const xx = x - a * 0.04 + Math.cos(th) * 0.045;
      return S.P(xx, v, uu + Math.sin(th) * 0.045);
    }, 12, 10, 0, false));
    ex.add('black', rbox(0.11, 0.09, 0.16, 0.03, x - 0.04, S.ground + S.cabTop(c.screenTop) + 0.07, S.zF + c.screenTop - 0.06, 2));
  }

  // ---- interior: floor, dashboard, wheel, seats, console
  {
    const { xb } = S.cabBase(uCabMid);
    const wIn = xb * 2 - 0.12;
    const floorV = S.botRaw(uCabMid) + 0.16;
    inner.add('dash', box(wIn, 0.02, c.u3 - c.u0 - 0.1, 0, S.ground + floorV, S.zF + (c.u0 + c.u3) / 2));
    const dashU = c.u0 + 0.28, dashV = S.top(c.u0) - 0.06; // dash top just under the windscreen base
    inner.add('dash', rbox(wIn, 0.2, 0.5, 0.06, 0, S.ground + dashV - 0.06, S.zF + dashU, 2));
    inner.add('black', rbox(wIn * 0.92, 0.04, 0.25, 0.015, 0, S.ground + dashV + 0.05, S.zF + dashU - 0.05, 1));
    const Ly = bodyLayout(spec, kind);
    const sw = new THREE.Group();
    const wheelGeo: THREE.BufferGeometry[] = [new THREE.TorusGeometry(0.185, 0.02, 8, 32)];
    for (const a of [Math.PI / 2 + 0.05, -0.2, Math.PI + 0.2]) wheelGeo.push(box(0.15, 0.025, 0.012, Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0).rotateZ(0));
    wheelGeo.push(cyl(0.045, 0.04, 16).rotateX(Math.PI / 2));
    const swm = mergeGeos(wheelGeo.map(clean));
    swm.rotateX(-1.12).translate(Ly.eyeCockpit.x, Ly.eyeCockpit.y - 0.27, Ly.eyeCockpit.z - 0.45);
    inner.add('dash', swm);
    void sw;
    inner.add('dash', box(0.18, 0.14, 0.75, 0, S.ground + floorV + 0.12, S.zF + dashU + 0.6)); // console
    // instrument binnacle in front of the driver and a centre screen (dim emissive faces)
    const ex0 = Ly.eyeCockpit.x;
    inner.add('dash', rbox(0.42, 0.1, 0.16, 0.04, ex0, S.ground + dashV + 0.08, S.zF + dashU + 0.12, 2));
    inner.add('gauge', box(0.36, 0.075, 0.004, ex0, S.ground + dashV + 0.075, S.zF + dashU + 0.202));
    inner.add('gauge', box(0.24, 0.14, 0.004, 0.02, S.ground + dashV + 0.0, S.zF + dashU + 0.255).rotateX(-0.25));
    for (const x of [-wIn / 2 + 0.12, wIn / 2 - 0.12, -0.12, 0.16]) inner.add('black', box(0.1, 0.05, 0.01, x, S.ground + dashV - 0.02, S.zF + dashU + 0.255)); // vents
    const plan = seatPlan(d);
    const rows = plan.eyeR === null ? [plan.eyeF] : [plan.eyeF, plan.eyeR];
    rows.forEach((eye, row) => {
      const u = eye + 0.06; // cushion centre slightly behind the eye
      const xs = row === 0 ? [-0.37, 0.37] : [0];
      const sv = floorV + 0.28;
      // headrest must stay under the roof / sloping rear glass (sedans)
      const roof = Math.min(S.cabTop(u + 0.3), S.cabTop(u + 0.2)) - 0.07;
      const hrV = Math.min(sv + 0.74, roof - 0.09);
      const backH = Math.max(0.3, Math.min(0.62, hrV - 0.1 - sv));
      for (const x of xs) {
        const w = row === 0 ? 0.52 : wIn - 0.1;
        inner.add('seat', rbox(w, 0.13, 0.5, 0.05, x, S.ground + sv, S.zF + u, 2));
        inner.add('seat', rbox(w, backH, 0.14, 0.06, x, S.ground + sv + 0.04 + backH / 2, S.zF + u + 0.28, 2));
        const hx = row === 0 ? [x] : [-0.45, 0, 0.45];
        for (const h of hx) inner.add('seat', rbox(0.24, 0.16, 0.1, 0.04, h, S.ground + hrV, S.zF + u + 0.3, 2));
      }
    });
  }

  // ---- assemble
  const paint = paintHex ? paintHex : d.paint;
  const M = materials(paint, d);
  const g = new THREE.Group();
  const emit = (p: Parts, opts: { noShadow?: boolean; order?: number } = {}) => {
    for (const [key, list] of p.map) {
      if (!list.length) continue;
      const mesh = new THREE.Mesh(mergeGeos(list), M[key] ?? M.paint);
      if (opts.noShadow || key === 'glass' || key === 'screen' || key === 'interior' || key === 'liner') mesh.userData.noShadow = true;
      if (key === 'glass' || key === 'screen') mesh.renderOrder = 2;
      g.add(mesh);
    }
  };
  emit(parts);
  emit(ex, { noShadow: true });
  emit(inner, { noShadow: true });
  g.userData.wheelStyle = { ...d.wheel, tread: kind === 'camry' ? 'hw' : 'at' } as WheelStyle;
  g.userData.kind = kind;
  if (d.model) attachModel(g, spec, d.model, paint, (eye) => (eye ? MODEL_EYE.set(kind, eye) : MODEL_EYE.delete(kind)));
  return g;
}

// ---------------------------------------------------------------- per-vehicle details
/** planar patch on the front (u = 0) or rear (u = L) cap face; x/v rectangle, pushed out by `out` */
/** keep a point on the nose / tail face inside the body outline (lamps must not overhang the corners) */
function capClampX(S: BodyShape, rear: boolean, x: number, v: number): number {
  const lim = S.sideX(rear ? S.L : 0, v) - 0.008;
  return Math.sign(x) * Math.min(Math.abs(x), lim);
}
function capRect(S: BodyShape, rear: boolean, x0: number, x1: number, v0: number, v1: number, out: number): THREE.BufferGeometry {
  const u = rear ? S.L + out : -out;
  return patch((a, b) => {
    const v = lerp(v0, v1, b);
    return S.P(capClampX(S, rear, lerp(x0, x1, a), v), v, u);
  }, 1, 1, 0, (x1 > x0) !== rear);
}
/** quad with arbitrary corners on the cap face (for trapezoid grilles / angled lamps) */
function capQuad(S: BodyShape, rear: boolean, pts: Pt[], out: number): THREE.BufferGeometry {
  const u = rear ? S.L + out : -out;
  const [p0, p1, p2, p3] = pts.map(([x, v]) => S.P(capClampX(S, rear, x, v), v, u));
  return patch((a, b) => {
    const top = p3.clone().lerp(p2, a), bottom = p0.clone().lerp(p1, a);
    return bottom.lerp(top, b);
  }, 1, 1, 0, (pts[1][0] > pts[0][0]) !== rear);
}
/** patch hugging the top/shoulder surface: u range × x range */
function topRect(S: BodyShape, u0: number, u1: number, x0: number, x1: number, out: number, nu = 6, nx = 8): THREE.BufferGeometry {
  return patch((a, b) => {
    const u = lerp(u0, u1, a);
    const x = lerp(x0, x1, b);
    return S.P(x, S.topAt(u, x), u);
  }, nu, nx, out, x0 > x1);
}
/** patch hugging the side surface: u range × v range on one side */
function sideRect(S: BodyShape, side: number, u0: number, u1: number, v0: number, v1: number, out: number, nu = 6, nv = 3): THREE.BufferGeometry {
  return patch((a, b) => {
    const u = lerp(u0, u1, a), v = lerp(v0, v1, b);
    return S.P(side * S.sideX(u, v), v, u);
  }, nu, nv, out, side > 0);
}
const slats = (S: BodyShape, parts: Parts, key: string, x0: number, x1: number, v0: number, v1: number, n: number, out: number, th = 0.012) => {
  for (let i = 0; i < n; i++) {
    const v = lerp(v0, v1, (i + 0.5) / n);
    parts.add(key, box(x1 - x0, th, 0.02, (x0 + x1) / 2, S.ground + v, S.zF - out));
  }
};

function camryDetails(S: BodyShape, parts: Parts, ex: Parts): void {
  const L = S.L;
  // lower grille: wide trapezoid with horizontal mesh bars, chrome-less (sport look)
  ex.add('black', capQuad(S, false, [[-0.6, 0.27], [0.6, 0.27], [0.5, 0.52], [-0.5, 0.52]], 0.004));
  for (let i = 0; i < 6; i++) {
    const v = 0.3 + i * 0.038, w = 1.12 - i * 0.03;
    ex.add('satin', box(w, 0.01, 0.025, 0, S.ground + v, S.zF - 0.01));
  }
  // slim upper grille between the lamps
  ex.add('black', topRect(S, 0.0, 0.07, -0.42, 0.42, 0.003, 3, 6));
  // fog-lamp bezels
  for (const side of [-1, 1]) {
    ex.add('black', capQuad(S, false, [[side * 0.62, 0.3], [side * 0.7, 0.3], [side * 0.72, 0.5], [side * 0.64, 0.5]], 0.004));
    ex.add('lens', capRect(S, false, side * 0.64, side * 0.69, 0.33, 0.36, 0.006));
  }
  // headlights: slim, swept back over the shoulder; lens + projector + L-shaped DRL
  for (const side of [-1, 1]) {
    ex.add('reflector', topRect(S, 0.02, 0.36, side * 0.46, side * (S.xe(0.2) + S.R(0.2) * 0.85), 0.004, 8, 8));
    ex.add('lens', topRect(S, 0.05, 0.3, side * 0.5, side * 0.62, 0.007, 4, 3));
    ex.add('drl', topRect(S, 0.03, 0.06, side * 0.5, side * (S.xe(0.05) + S.R(0.05) * 0.7), 0.008, 2, 6));
    ex.add('drl', topRect(S, 0.06, 0.34, side * (S.xe(0.2) + S.R(0.2) * 0.55), side * (S.xe(0.2) + S.R(0.2) * 0.7), 0.008, 6, 2));
  }
  // tail lamps: wrap from the boot lid onto the rear wings, with a dark smoked centre
  for (const side of [-1, 1]) {
    ex.add('tail', sideRect(S, side, L - 0.3, L - 0.005, 0.86, 0.97, 0.004, 6, 2));
    ex.add('tail', capQuad(S, true, [[side * 0.48, 0.8], [side * 0.82, 0.8], [side * 0.86, 0.88], [side * 0.5, 0.88]].map(([x, v]) => [x, v] as Pt), 0.004));
    ex.add('tailDark', capQuad(S, true, [[side * 0.52, 0.815], [side * 0.7, 0.815], [side * 0.72, 0.865], [side * 0.54, 0.865]], 0.006));
  }
  ex.add('chrome', capRect(S, true, -0.45, 0.45, 0.835, 0.845, 0.004));
  // boot-lid lip spoiler and dual exhaust tips in the rear diffuser
  parts.add('paint', topRect(S, L - 0.12, L - 0.03, -0.62, 0.62, 0.012, 3, 10));
  for (const side of [-1, 1]) {
    ex.add('chrome', cyl(0.045, 0.06, 20).rotateX(Math.PI / 2).scale(1.35, 0.7, 1).translate(side * 0.5, S.ground + 0.29, S.zF + L - 0.035));
    ex.add('rubber', cyl(0.036, 0.062, 20).rotateX(Math.PI / 2).scale(1.35, 0.7, 1).translate(side * 0.5, S.ground + 0.29, S.zF + L - 0.033));
  }
  // shark-fin antenna
  const ua = S.d.cabin.roofEnd - 0.05;
  parts.add('black', rbox(0.06, 0.06, 0.17, 0.03, 0, S.ground + S.cabTop(ua) + 0.035, S.zF + ua, 2));
  // side skirts (black) and chrome window-line already via cabin.belt
  for (const side of [-1, 1]) ex.add('black', sideRect(S, side, S.axles[0] + S.archR + 0.02, S.axles[1] - S.archR - 0.02, S.botRaw(2.4) + 0.005, S.botRaw(2.4) + 0.06, 0.004, 12, 1));
}

function lc300Details(S: BodyShape, parts: Parts, ex: Parts): void {
  const L = S.L;
  // big grille: chrome frame, black field, three thick chrome bars
  ex.add('chrome', capRect(S, false, -0.62, 0.62, 0.6, 0.95, 0.006));
  ex.add('black', capRect(S, false, -0.58, 0.58, 0.63, 0.92, 0.012));
  for (const v of [0.69, 0.775, 0.86]) ex.add('chrome', rbox(1.14, 0.03, 0.03, 0.012, 0, S.ground + v, S.zF - 0.022, 2));
  // headlamps: slim LED units at the top corners, wrapping onto the wings
  for (const side of [-1, 1]) {
    ex.add('reflector', capQuad(S, false, [[side * 0.64, 0.84], [side * 0.93, 0.85], [side * 0.93, 0.96], [side * 0.64, 0.95]], 0.008));
    for (let i = 0; i < 3; i++) ex.add('lens', capRect(S, false, side * (0.68 + i * 0.075), side * (0.73 + i * 0.075), 0.87, 0.93, 0.012));
    ex.add('drl', capRect(S, false, side * 0.66, side * 0.92, 0.845, 0.857, 0.012));
    ex.add('reflector', sideRect(S, side, 0.01, 0.2, 0.86, 0.96, 0.004, 4, 2));
    ex.add('amber', sideRect(S, side, 0.03, 0.17, 0.83, 0.85, 0.005, 3, 1));
  }
  // front bumper: body colour with a black lower air dam, fog lamps and a skid plate
  parts.add('paint', rbox(1.86, 0.2, 0.22, 0.06, 0, S.ground + 0.55, S.zF + 0.05, 3));
  ex.add('black', rbox(1.5, 0.08, 0.06, 0.02, 0, S.ground + 0.5, S.zF - 0.065, 2));
  ex.add('alu', rbox(0.9, 0.05, 0.2, 0.02, 0, S.ground + 0.42, S.zF + 0.05, 2));
  for (const side of [-1, 1]) {
    ex.add('black', rbox(0.2, 0.09, 0.04, 0.02, side * 0.72, S.ground + 0.5, S.zF - 0.06, 2));
    ex.add('lens', rbox(0.12, 0.035, 0.02, 0.01, side * 0.72, S.ground + 0.5, S.zF - 0.08, 1));
  }
  // rear: horizontal tail lamps at the shoulder linked by a chrome strip, rear bumper with step pad
  for (const side of [-1, 1]) {
    ex.add('tail', capQuad(S, true, [[side * 0.55, 1.06], [side * 0.93, 1.06], [side * 0.93, 1.17], [side * 0.55, 1.17]], 0.006));
    ex.add('tailDark', capRect(S, true, side * 0.6, side * 0.78, 1.09, 1.14, 0.009));
    ex.add('tail', sideRect(S, side, L - 0.2, L - 0.005, 1.06, 1.17, 0.004, 4, 2));
  }
  ex.add('chrome', capRect(S, true, -0.55, 0.55, 1.1, 1.13, 0.008));
  parts.add('paint', rbox(1.92, 0.22, 0.2, 0.06, 0, S.ground + 0.6, S.zF + L - 0.06, 3));
  ex.add('black', rbox(1.4, 0.04, 0.14, 0.015, 0, S.ground + 0.715, S.zF + L - 0.03, 2));
  // mud flaps
  for (const ua of S.axles) for (const side of [-1, 1]) ex.add('rubber', box(0.22, 0.2, 0.01, side * (S.sideX(ua, 0.5) - 0.12), S.ground + 0.38, S.zF + ua + S.archR + 0.04));
}

function patrolDetails(S: BodyShape, parts: Parts, ex: Parts): void {
  const L = S.L;
  // chrome grille with horizontal bars and a vertical centre divider
  ex.add('chrome', capRect(S, false, -0.48, 0.48, 0.68, 0.96, 0.006));
  ex.add('black', capRect(S, false, -0.44, 0.44, 0.71, 0.93, 0.01));
  slats(S, ex, 'chrome', -0.44, 0.44, 0.71, 0.93, 5, 0.014, 0.018);
  ex.add('chrome', box(0.03, 0.22, 0.02, 0, S.ground + 0.82, S.zF - 0.016));
  // square headlamps with amber corner indicators wrapping round
  for (const side of [-1, 1]) {
    ex.add('chrome', capRect(S, false, side * 0.5, side * 0.82, 0.77, 0.96, 0.006));
    ex.add('reflector', capRect(S, false, side * 0.52, side * 0.8, 0.79, 0.94, 0.01));
    ex.add('lens', capRect(S, false, side * 0.55, side * 0.66, 0.82, 0.91, 0.013));
    ex.add('lens', capRect(S, false, side * 0.68, side * 0.78, 0.82, 0.91, 0.013));
    ex.add('amber', capRect(S, false, side * 0.83, side * 0.9, 0.79, 0.94, 0.006));
    ex.add('amber', sideRect(S, side, 0.005, 0.12, 0.8, 0.93, 0.004, 3, 2));
  }
  // bumper: body colour top, black lower half, fog lamps; rear bumper with lamps in the corners
  parts.add('paint', rbox(1.9, 0.14, 0.2, 0.05, 0, S.ground + 0.6, S.zF + 0.03, 3));
  ex.add('black', rbox(1.9, 0.12, 0.2, 0.04, 0, S.ground + 0.47, S.zF + 0.04, 3));
  for (const side of [-1, 1]) ex.add('lens', cyl(0.05, 0.03, 20).rotateX(Math.PI / 2).translate(side * 0.66, S.ground + 0.48, S.zF - 0.065));
  for (const side of [-1, 1]) {
    ex.add('tail', capRect(S, true, side * 0.72, side * 0.9, 0.78, 1.1, 0.006));
    ex.add('amber', capRect(S, true, side * 0.72, side * 0.9, 0.7, 0.77, 0.006));
    ex.add('tail', sideRect(S, side, L - 0.1, L - 0.004, 0.78, 1.1, 0.004, 2, 3));
  }
  parts.add('paint', rbox(1.94, 0.13, 0.18, 0.05, 0, S.ground + 0.6, S.zF + L - 0.04, 3));
  ex.add('black', rbox(1.94, 0.1, 0.18, 0.04, 0, S.ground + 0.49, S.zF + L - 0.04, 3));
  // rear barn-door seam + chrome handle, bonnet bulge
  ex.add('black', capRect(S, true, 0.18, 0.186, 0.56, 1.15, 0.004));
  ex.add('chrome', rbox(0.18, 0.035, 0.03, 0.01, 0.0, S.ground + 1.0, S.zF + L + 0.012, 2));
  parts.add('paint', topRect(S, 0.25, 1.15, -0.32, 0.32, 0.018, 10, 8));
  // mud flaps
  for (const ua of S.axles) for (const side of [-1, 1]) ex.add('rubber', box(0.24, 0.22, 0.01, side * (S.sideX(ua, 0.5) - 0.12), S.ground + 0.36, S.zF + ua + S.archR + 0.05));
}

function lc70Details(S: BodyShape, parts: Parts, ex: Parts): void {
  const L = S.L;
  const bedU = S.d.bedU ?? 2.66;
  // wide grille with horizontal slats; rectangular LED headlamps; indicators in the wing corners
  ex.add('black', capRect(S, false, -0.56, 0.56, 0.66, 0.97, 0.008));
  slats(S, ex, 'satin', -0.54, 0.54, 0.68, 0.95, 6, 0.016, 0.02);
  for (const side of [-1, 1]) {
    ex.add('black', capRect(S, false, side * 0.58, side * 0.86, 0.77, 0.95, 0.006));
    ex.add('reflector', capRect(S, false, side * 0.6, side * 0.84, 0.79, 0.93, 0.01));
    ex.add('lens', capRect(S, false, side * 0.62, side * 0.72, 0.81, 0.91, 0.013));
    ex.add('lens', capRect(S, false, side * 0.73, side * 0.82, 0.81, 0.91, 0.013));
    ex.add('drl', capRect(S, false, side * 0.6, side * 0.84, 0.78, 0.79, 0.013));
    ex.add('amber', capRect(S, false, side * 0.6, side * 0.8, 0.7, 0.75, 0.007));
  }
  // heavy black steel bumper with a winch fairlead, recovery points and a rear step bumper
  ex.add('black', rbox(1.95, 0.24, 0.24, 0.03, 0, S.ground + 0.55, S.zF - 0.03, 2));
  ex.add('alu', rbox(0.25, 0.08, 0.05, 0.01, 0, S.ground + 0.58, S.zF - 0.16, 1));
  for (const side of [-1, 1]) ex.add('chrome', new THREE.TorusGeometry(0.03, 0.01, 6, 12).translate(side * 0.45, S.ground + 0.5, S.zF - 0.16));
  ex.add('black', rbox(1.9, 0.16, 0.18, 0.03, 0, S.ground + 0.6, S.zF + L + 0.05, 2));
  // bed: floor, inner walls, headboard, tailgate inner face, rails, and a headboard guard
  const floorV = 0.95, topV = S.top(L / 2) - 0.02;
  const xIn = S.sideX((bedU + L) / 2, topV) - 0.045;
  const bl = L - 0.05 - bedU, bz = S.zF + (bedU + L - 0.05) / 2;
  ex.add('satin', box(xIn * 2, 0.02, bl, 0, S.ground + floorV, bz));
  for (const side of [-1, 1]) ex.add('satin', box(0.02, topV - floorV, bl, side * xIn, S.ground + (topV + floorV) / 2, bz));
  ex.add('satin', box(xIn * 2, topV - floorV, 0.03, 0, S.ground + (topV + floorV) / 2, S.zF + bedU + 0.015));
  ex.add('satin', box(xIn * 2, topV - floorV, 0.02, 0, S.ground + (topV + floorV) / 2, S.zF + L - 0.05));
  for (let i = 0; i < 6; i++) ex.add('black', box(0.03, 0.012, bl, lerp(-xIn + 0.15, xIn - 0.15, i / 5), S.ground + floorV + 0.012, bz));
  for (const side of [-1, 1]) ex.add('black', box(0.06, 0.012, bl, side * (xIn + 0.03), S.ground + topV + 0.025, bz));
  const gv = topV + 0.02;
  for (const side of [-1, 1]) ex.add('black', cyl(0.025, 0.42, 10).translate(side * (xIn - 0.05), S.ground + gv + 0.21, S.zF + bedU + 0.05));
  ex.add('black', cyl(0.025, xIn * 2 - 0.1, 10).rotateZ(Math.PI / 2).translate(0, S.ground + gv + 0.42, S.zF + bedU + 0.05));
  for (let i = 0; i < 5; i++) ex.add('black', box(0.015, 0.4, 0.015, lerp(-xIn + 0.25, xIn - 0.25, i / 4), S.ground + gv + 0.2, S.zF + bedU + 0.05));
  // tail lamps on the rear corners, tailgate handle
  for (const side of [-1, 1]) {
    ex.add('tail', capRect(S, true, side * 0.72, side * 0.86, 0.78, 1.05, 0.006));
    ex.add('amber', capRect(S, true, side * 0.72, side * 0.86, 0.7, 0.77, 0.006));
  }
  ex.add('black', rbox(0.2, 0.04, 0.03, 0.01, 0, S.ground + 1.08, S.zF + L + 0.012, 1));
  // bonnet scoop (intercooler) and mud flaps
  parts.add('paint', rbox(0.5, 0.06, 0.32, 0.025, 0, S.ground + S.topAt(0.9, 0) + 0.02, S.zF + 0.9, 2));
  ex.add('black', box(0.4, 0.03, 0.01, 0, S.ground + S.topAt(0.9, 0) + 0.03, S.zF + 0.74));
  for (const ua of S.axles) for (const side of [-1, 1]) ex.add('rubber', box(0.24, 0.24, 0.01, side * (S.sideX(ua, 0.5) - 0.12), S.ground + 0.4, S.zF + ua + S.archR + 0.06));
}
