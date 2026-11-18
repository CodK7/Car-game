// Detailed procedural wheels: lathed tyre (rounded shoulders, bulging sidewall), tread blocks or highway ribs, rim
// barrel + lip, spoke / multi-spoke / steel-disc faces, centre cap, lug nuts and a brake disc.
// Local frame: axle along x, the outer (show) face looks to +x. Left wheels are turned around by the caller.
import * as THREE from 'three';
import { objMaterial } from '../gfx/objMaterial';
import { mergeGeos } from './vehicleView';

export interface WheelStyle {
  style: 'spoke' | 'multispoke' | 'steel' | 'plain';
  spokes: number;
  rim: string;
  face: string;
  lip: string;
  /** tyre type: 'at' (all-terrain blocks) or 'hw' (highway ribs) */
  tread?: 'at' | 'hw';
}

const SEG = 56;

/** Lathe a (radius, axial) profile around the axle (x). */
function lathe(pts: [number, number][], seg = SEG): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(pts.map(([r, a]) => new THREE.Vector2(r, a)), seg);
  g.rotateZ(-Math.PI / 2); // lathe axis y -> +x
  return clean(g);
}

/** keep position + normal (+ index) so mergeGeos can combine everything */
function clean(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const o = new THREE.BufferGeometry();
  o.setAttribute('position', g.getAttribute('position'));
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  o.setAttribute('normal', g.getAttribute('normal'));
  if (g.index) o.setIndex(g.index);
  return o;
}

function tyreGeo(r: number, w: number, rr: number, hw: boolean): THREE.BufferGeometry {
  const sw = r - rr;
  const h = w / 2;
  const sh = Math.min(0.035, sw * 0.28); // shoulder radius
  const p: [number, number][] = [];
  // inner bead → inner sidewall → shoulder → tread → outer shoulder → outer sidewall → outer bead
  p.push([rr - 0.004, -h * 0.86], [rr + 0.012, -h * 0.93], [rr + sw * 0.25, -h * 0.99], [rr + sw * 0.55, -h * 1.02], [r - sh * 1.4, -h * 0.98]);
  for (let i = 0; i <= 4; i++) {
    const a = (i / 4) * (Math.PI / 2);
    p.push([r - sh + Math.sin(a) * sh, -(h * 0.94 - sh) - Math.cos(a) * sh]);
  }
  if (hw) {
    // highway tyre: three circumferential grooves
    const xs = [-0.55, -0.2, 0.2, 0.55];
    for (const x of xs) {
      p.push([r, h * x - 0.012], [r - 0.008, h * x - 0.008], [r - 0.008, h * x + 0.008], [r, h * x + 0.012]);
    }
  } else p.push([r, -h * 0.3], [r, h * 0.3]);
  for (let i = 0; i <= 4; i++) {
    const a = (i / 4) * (Math.PI / 2);
    p.push([r - sh + Math.cos(a) * sh, h * 0.94 - sh + Math.sin(a) * sh]);
  }
  p.push([r - sh * 1.4, h * 0.98], [rr + sw * 0.55, h * 1.02], [rr + sw * 0.25, h * 0.99], [rr + 0.012, h * 0.93], [rr - 0.004, h * 0.86]);
  // lathe needs the profile in one direction; radius may go up and down, axial increases
  return lathe(p, 64);
}

function treadBlocks(r: number, w: number): THREE.BufferGeometry {
  const list: THREE.BufferGeometry[] = [];
  const n = 30;
  const circ = (2 * Math.PI * r) / n;
  const h = w / 2;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    // centre pair (staggered) + shoulder lugs that wrap onto the sidewall
    const rows: [number, number, number, number][] = [
      [-h * 0.22, w * 0.3, circ * 0.55, 0],
      [h * 0.22, w * 0.3, circ * 0.55, 0.5],
      [-h * 0.74, w * 0.22, circ * 0.62, 0.25],
      [h * 0.74, w * 0.22, circ * 0.62, 0.75],
    ];
    for (const [x, bw, bl, off] of rows) {
      const b = new THREE.BoxGeometry(bw, 0.016, bl);
      b.translate(x, r + 0.004, 0);
      b.rotateX(a + (off * Math.PI * 2) / n);
      list.push(clean(b));
    }
  }
  return mergeGeos(list);
}

function rimLathe(rr: number, w: number): THREE.BufferGeometry {
  const h = w / 2;
  // inner flange → barrel → outer flange lip, ending just in front of the face
  return lathe([
    [rr - 0.012, -h * 0.84], [rr + 0.012, -h * 0.88], [rr + 0.004, -h * 0.8], [rr - 0.03, -h * 0.72], [rr - 0.03, h * 0.5],
    [rr - 0.004, h * 0.7], [rr + 0.012, h * 0.84], [rr + 0.016, h * 0.88], [rr + 0.004, h * 0.92], [rr - 0.022, h * 0.86],
  ]);
}

/** spoke outline from the hub to the rim (radial along +x of the shape, tangential along y), extruded along the axle */
function spokeGeo(r0: number, r1: number, w0: number, w1: number, depth: number, dish: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(r0, -w0 / 2);
  s.lineTo(r1, -w1 / 2);
  s.quadraticCurveTo(r1 + w1 * 0.25, 0, r1, w1 / 2);
  s.lineTo(r0, w0 / 2);
  s.lineTo(r0, -w0 / 2);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 4 });
  // shape (x radial, y tangential, z axial) → wheel (x axial, y radial, z tangential)
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    // dish: outer ends of the spokes sit further out (concave face)
    const t = (x - r0) / (r1 - r0);
    pos.setXYZ(i, z + dish * t, x, y);
  }
  g.computeVertexNormals();
  return clean(g);
}

export function detailedWheel(radius: number, width: number, st: WheelStyle, sidewall?: number): THREE.Group {
  const g = new THREE.Group();
  const rr = Math.max(radius * 0.5, radius - (sidewall ?? radius * 0.42));
  const h = width / 2;
  const rubber = objMaterial({ color: 0x1c1b1a, gloss: 0.04 });
  const tyre = new THREE.Mesh(tyreGeo(radius, width, rr, st.tread === 'hw'), rubber);
  g.add(tyre);
  if (st.tread !== 'hw') g.add(new THREE.Mesh(treadBlocks(radius, width), objMaterial({ color: 0x232120, gloss: 0.03 })));
  const rimMat = objMaterial({ color: st.rim, gloss: 0.55, side: THREE.DoubleSide });
  g.add(new THREE.Mesh(rimLathe(rr, width), objMaterial({ color: st.lip, gloss: 0.7, side: THREE.DoubleSide })));
  // brake disc + hub (dark), seen through the spokes
  const disc = new THREE.CylinderGeometry(rr * 0.78, rr * 0.78, 0.028, 40).rotateZ(Math.PI / 2).translate(h * 0.05, 0, 0);
  const hub = new THREE.CylinderGeometry(rr * 0.36, rr * 0.36, 0.06, 24).rotateZ(Math.PI / 2).translate(h * 0.22, 0, 0);
  g.add(new THREE.Mesh(mergeGeos([clean(disc), clean(hub)]), objMaterial({ color: 0x5d5a57, gloss: 0.3 })));
  // inner barrel back plate so the wheel is not see-through
  const back = new THREE.CircleGeometry(rr - 0.03, 32).rotateY(Math.PI / 2).translate(-h * 0.2, 0, 0);
  g.add(new THREE.Mesh(clean(back), objMaterial({ color: 0x141312, side: THREE.DoubleSide })));
  const faceX = h * 0.52;
  const faceGeos: THREE.BufferGeometry[] = [];
  const darkGeos: THREE.BufferGeometry[] = [];
  const n = Math.max(3, st.spokes);
  if (st.style === 'steel') {
    // pressed steel disc with round cut-outs and a raised centre
    const s = new THREE.Shape();
    s.absarc(0, 0, rr - 0.012, 0, Math.PI * 2, false);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const hole = new THREE.Path();
      hole.absarc(Math.cos(a) * rr * 0.62, Math.sin(a) * rr * 0.62, rr * 0.13, 0, Math.PI * 2, true);
      s.holes.push(hole);
    }
    const cut = new THREE.Path();
    cut.absarc(0, 0, rr * 0.2, 0, Math.PI * 2, true);
    s.holes.push(cut);
    const d = new THREE.ExtrudeGeometry(s, { depth: 0.01, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 20 });
    d.rotateY(Math.PI / 2).translate(faceX - 0.03, 0, 0);
    faceGeos.push(clean(d));
    faceGeos.push(lathe([[rr * 0.2, faceX - 0.03], [rr * 0.34, faceX + 0.005], [rr * 0.46, faceX + 0.01], [rr * 0.5, faceX - 0.02]], 32));
  } else if (st.style !== 'plain') {
    const multi = st.style === 'multispoke';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const sp = multi ? spokeGeo(rr * 0.3, rr - 0.02, 0.03, 0.032, 0.03, -0.02) : spokeGeo(rr * 0.3, rr - 0.02, 0.07, 0.085, 0.035, -0.025);
      sp.rotateX(a);
      sp.translate(faceX - 0.035, 0, 0);
      faceGeos.push(sp);
      if (multi) {
        // machined bright top face on each spoke (two-tone alloy)
        const cap = spokeGeo(rr * 0.34, rr - 0.03, 0.018, 0.02, 0.002, -0.02);
        cap.rotateX(a);
        cap.translate(faceX + 0.0, 0, 0);
        darkGeos.push(cap);
      }
    }
    faceGeos.push(lathe([[rr * 0.16, faceX - 0.04], [rr * 0.34, faceX - 0.004], [rr * 0.36, faceX - 0.03]], 32));
  }
  if (faceGeos.length) g.add(new THREE.Mesh(mergeGeos(faceGeos), objMaterial({ color: st.face, gloss: 0.5 })));
  if (darkGeos.length) g.add(new THREE.Mesh(mergeGeos(darkGeos), objMaterial({ color: st.lip, gloss: 0.8 })));
  // centre cap + lug nuts
  const nuts: THREE.BufferGeometry[] = [];
  const lugs = st.style === 'multispoke' ? 5 : 6;
  const pcd = lugs === 5 ? 0.057 : 0.07;
  for (let i = 0; i < lugs; i++) {
    const a = (i / lugs) * Math.PI * 2 + 0.3;
    nuts.push(clean(new THREE.CylinderGeometry(0.011, 0.011, 0.024, 6).rotateZ(Math.PI / 2).translate(faceX - 0.01, Math.cos(a) * pcd, Math.sin(a) * pcd)));
  }
  nuts.push(lathe([[0.001, faceX + 0.012], [0.03, faceX + 0.008], [0.04, faceX - 0.01], [0.042, faceX - 0.03]], 24));
  g.add(new THREE.Mesh(mergeGeos(nuts), objMaterial({ color: 0x8d8f92, gloss: 0.7 })));
  for (const c of g.children) c.userData.noShadowDetail = true;
  return g;
}
