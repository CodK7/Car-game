// Instanced vegetation (streamed around the camera) and static settlement props (buildings, camps, shelters, poles).
import * as THREE from 'three';
import { objMaterial } from '../gfx/objMaterial';
import { hash2, mulberry32 } from '../core/rng';
import { TerrainData } from './terrainData';
import { RoadNet } from './roadNet';
import { OsmData } from './assets';
import { placeAround, Placed, PropRule } from './placement';
import * as meshes from './propMeshes';
import world from '../config/world.json';
import { Quality } from '../gfx/quality';

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

interface Layer {
  rule: PropRule & { fade: number[] };
  mesh: THREE.InstancedMesh;
  range: number;
  seed: number;
  cx: number;
  cz: number;
  placed: Placed[];
  max: number;
}

function setInst(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, rot: number, sx: number, sy = sx, sz = sx): void {
  tmpQ.setFromAxisAngle(UP, rot);
  tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz));
  mesh.setMatrixAt(i, tmpM);
}

export class Props {
  readonly group = new THREE.Group();
  private layers: Layer[] = [];
  private density = 1;
  stats = { ghaf: 0, shrub: 0, tuft: 0, buildings: 0, huts: 0, shelters: 0, poles: 0 };
  /** Camp centres (used by missions). */
  camps: { x: number; z: number; name: string }[] = [];
  /** Solid obstacles for vehicle collision: centre + radius. */
  obstacles: { x: number; z: number; r: number }[] = [];

  constructor(readonly t: TerrainData, readonly roads: RoadNet, osm: OsmData, q: Quality, readonly seed = world.seed) {
    const P = world.props;
    const mk = (geo: THREE.BufferGeometry, rule: any, max: number, sway: number, seedOff: number) => {
      const mesh = new THREE.InstancedMesh(geo, objMaterial({ vertexColors: true, sway, fade: [0, 0] }), max);
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      this.group.add(mesh);
      const l: Layer = { rule, mesh, range: 0, seed: seed + seedOff, cx: 1e9, cz: 1e9, placed: [], max };
      this.layers.push(l);
      return l;
    };
    mk(meshes.ghafTree(), P.ghaf, 4000, 0.25, 100);
    mk(meshes.shrub(), P.shrub, 6000, 0.6, 200);
    mk(meshes.tuft(), P.tuft, 8000, 1.5, 300);
    this.setQuality(q);
    this.buildStatic(osm);
  }

  setQuality(q: Quality): void {
    this.density = q.propDensity;
    const ranges = [q.treeRange, q.shrubRange, q.shrubRange * world.props.tuft.rangeOfShrub];
    this.layers.forEach((l, i) => {
      l.range = ranges[i];
      l.cx = 1e9; // force rebuild
      const f = l.rule.fade;
      (l.mesh.material as THREE.ShaderMaterial).uniforms.uFade.value.set(l.range * f[0], l.range * f[1]);
    });
  }

  /** Re-place a layer when the camera moved far enough from its last centre. */
  update(cam: THREE.Vector3): void {
    for (const l of this.layers) {
      const moved = Math.hypot(cam.x - l.cx, cam.z - l.cz);
      if (moved < l.range * 0.12) continue;
      l.cx = cam.x;
      l.cz = cam.z;
      placeAround(this.t, this.roads, l.rule, l.seed, cam.x, cam.z, l.range, this.density, l.placed);
      const n = Math.min(l.placed.length, l.max);
      for (let i = 0; i < n; i++) {
        const p = l.placed[i];
        setInst(l.mesh, i, p.x, p.y - 0.15 * p.s, p.z, p.rot, p.s);
      }
      l.mesh.count = n;
      l.mesh.instanceMatrix.needsUpdate = true;
    }
    this.stats.ghaf = this.layers[0].mesh.count;
    this.stats.shrub = this.layers[1].mesh.count;
    this.stats.tuft = this.layers[2].mesh.count;
  }

  /** Trees near a point (vehicle collision). */
  treesNear(x: number, z: number, r: number, out: { x: number; z: number; r: number }[]): void {
    const l = this.layers[0];
    for (const p of l.placed) if (Math.abs(p.x - x) < r && Math.abs(p.z - z) < r) out.push({ x: p.x, z: p.z, r: 0.4 * p.s });
  }

  private ground(x: number, z: number): number {
    // lowest of a few samples, so footprints sit into slopes instead of floating
    const t = this.t;
    return Math.min(t.heightAt(x, z), t.heightAt(x + 2, z + 2), t.heightAt(x - 2, z - 2), t.heightAt(x + 2, z - 2), t.heightAt(x - 2, z + 2));
  }

  private buildStatic(osm: OsmData): void {
    const P = world.props;
    const rnd = mulberry32(this.seed + 900);
    // Buildings: OSM centroids plus procedural houses lining residential streets.
    // ASSUMPTION: OSM maps only 90 of the town's buildings and no footprints; sizes come from config ranges and
    // streets get one house per `street.spacing_m` per side (skipped at random) so Al Mintarib reads as a town.
    const B = P.building as any;
    const houses: number[][] = osm.buildings.map((b) => [b[0], b[1], rnd() * Math.PI]);
    for (const r of osm.roads) {
      if (r.c !== 'residential') continue;
      let acc = 0;
      for (let i = 0; i + 3 < r.p.length; i += 2) {
        const ax = r.p[i], az = r.p[i + 1], bx = r.p[i + 2], bz = r.p[i + 3];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 1e-3) continue;
        const ux = (bx - ax) / len, uz = (bz - az) / len;
        for (let s = B.street.spacing_m - acc; s <= len; s += B.street.spacing_m) {
          for (const side of [-1, 1]) {
            const x = ax + ux * s - uz * B.street.offset_m * side;
            const z = az + uz * s + ux * B.street.offset_m * side;
            if (hash2(Math.round(x), Math.round(z), this.seed) < B.street.skip) continue;
            if (this.roads.distance(x, z) < B.street.offset_m - 4) continue; // would sit on another street
            houses.push([x, z, Math.atan2(ux, uz)]);
          }
        }
        acc = (acc + len) % B.street.spacing_m;
        if (houses.length >= B.street.max) break;
      }
    }
    const bm = new THREE.InstancedMesh(meshes.house(), objMaterial({ vertexColors: true, receiveShadow: true }), Math.max(houses.length, 1));
    houses.forEach((b, i) => {
      const sx = B.size_m[0] + rnd() * (B.size_m[1] - B.size_m[0]);
      const sz = B.size_m[0] + rnd() * (B.size_m[1] - B.size_m[0]);
      const h = B.height_m[0] + rnd() * (B.height_m[1] - B.height_m[0]);
      const y = this.ground(b[0], b[1]) - 0.3;
      setInst(bm, i, b[0], y, b[1], b[2], sx, h, sz);
      this.obstacles.push({ x: b[0], z: b[1], r: Math.max(sx, sz) * 0.55 });
    });
    bm.count = houses.length;
    bm.computeBoundingSphere();
    this.group.add(bm);
    this.stats.buildings = bm.count;

    // camps: OSM camp sites + a few extra desert camps placed on interdune floors (ASSUMPTION: OSM camp list is incomplete)
    const sites = osm.pois.filter((p) => p.k === 'camp_site').map((p) => ({ x: p.x, z: p.z, name: p.n ?? 'Camp' }));
    const xr = mulberry32(this.seed + P.camp.extraCampsSeed);
    for (let tries = 0, added = 0; tries < 400 && added < P.camp.extraCamps; tries++) {
      const x = (xr() - 0.5) * this.t.half * 1.6;
      const z = (xr() - 0.5) * this.t.half * 1.6;
      if (this.t.slopeDegAt(x, z) < 4 && this.t.looseAt(x, z) < 0.3 && this.roads.distance(x, z) > 40) {
        sites.push({ x, z, name: `Desert camp ${added + 1}` });
        added++;
      }
    }
    this.camps = sites;
    const hutGeo = meshes.campHut();
    const huts = new THREE.InstancedMesh(hutGeo, objMaterial({ vertexColors: true, receiveShadow: true }), sites.length * P.camp.huts);
    const pits = new THREE.InstancedMesh(meshes.firePit(), objMaterial({ vertexColors: true }), sites.length);
    let k = 0;
    sites.forEach((c, ci) => {
      for (let i = 0; i < P.camp.huts; i++) {
        const a = (i / P.camp.huts) * Math.PI * 2 + hash2(ci, i, 3) * 0.3;
        const x = c.x + Math.cos(a) * P.camp.radius_m;
        const z = c.z + Math.sin(a) * P.camp.radius_m;
        setInst(huts, k++, x, this.ground(x, z) - 0.1, z, -a - Math.PI / 2, 1);
        this.obstacles.push({ x, z, r: 2.4 });
      }
      setInst(pits, ci, c.x, this.t.heightAt(c.x, c.z) - 0.05, c.z, 0, 1);
    });
    huts.count = k;
    pits.count = sites.length;
    huts.computeBoundingSphere();
    pits.computeBoundingSphere();
    this.group.add(huts, pits);
    this.stats.huts = k;

    // shade shelters along sand tracks and power poles along main roads
    const shelters: number[][] = [];
    const poles: number[][] = [];
    const poleClasses = new Set(P.poles.roadClasses);
    for (const r of osm.roads) {
      const isTrack = r.c === 'track';
      const isPole = poleClasses.has(r.c);
      if (!isTrack && !isPole) continue;
      const every = isTrack ? P.shelterAlongTracks_m : P.poles.spacing_m;
      let acc = isTrack ? every * 0.5 : 0;
      for (let i = 0; i + 3 < r.p.length; i += 2) {
        const ax = r.p[i], az = r.p[i + 1], bx = r.p[i + 2], bz = r.p[i + 3];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 1e-3) continue;
        const ux = (bx - ax) / len, uz = (bz - az) / len;
        let s = every - acc;
        while (s <= len) {
          const off = isTrack ? 7 : P.poles.offset_m;
          const x = ax + ux * s - uz * off;
          const z = az + uz * s + ux * off;
          (isTrack ? shelters : poles).push([x, z, Math.atan2(ux, uz)]);
          s += every;
        }
        acc = (acc + len) % every;
      }
    }
    const sm = new THREE.InstancedMesh(meshes.shelter(), objMaterial({ vertexColors: true }), Math.max(shelters.length, 1));
    shelters.forEach((p, i) => {
      setInst(sm, i, p[0], this.ground(p[0], p[1]), p[1], p[2], 1);
      this.obstacles.push({ x: p[0], z: p[1], r: 2.2 });
    });
    sm.count = shelters.length;
    sm.computeBoundingSphere();
    const pm = new THREE.InstancedMesh(meshes.powerPole(), objMaterial({ vertexColors: true, fade: [P.poles.fade_m * 0.8, P.poles.fade_m] }), Math.max(poles.length, 1));
    poles.forEach((p, i) => {
      setInst(pm, i, p[0], this.t.heightAt(p[0], p[1]) - 0.5, p[1], p[2], 1);
      this.obstacles.push({ x: p[0], z: p[1], r: 0.3 });
    });
    pm.count = poles.length;
    pm.frustumCulled = false;
    this.group.add(sm, pm);
    this.stats.shelters = shelters.length;
    this.stats.poles = poles.length;
  }
}
