// OSM road network: spatial index for distance queries (pure TS: used by physics, placement and tests).
export type RoadKind = 'track' | 'paved';

export interface RoadSeg {
  ax: number; az: number; bx: number; bz: number;
  kind: RoadKind;
}

const PAVED = new Set(['motorway', 'motorway_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'residential', 'service', 'unclassified']);

export function roadKind(cls: string, surface: string | null): RoadKind {
  if (cls === 'track' || cls === 'path' || cls === 'footway') return 'track';
  if (surface && /sand|unpaved|dirt|gravel|ground|compacted/.test(surface)) return 'track';
  return PAVED.has(cls) ? 'paved' : 'track';
}

export class RoadNet {
  readonly segs: RoadSeg[] = [];
  private cell = 64;
  private grid = new Map<number, number[]>();

  constructor(roads: { c: string; s: string | null; p: number[] }[]) {
    for (const r of roads) {
      const kind = roadKind(r.c, r.s);
      for (let i = 0; i + 3 < r.p.length; i += 2) this.segs.push({ ax: r.p[i], az: r.p[i + 1], bx: r.p[i + 2], bz: r.p[i + 3], kind });
    }
    this.segs.forEach((s, i) => {
      const x0 = Math.floor((Math.min(s.ax, s.bx) - 20) / this.cell);
      const x1 = Math.floor((Math.max(s.ax, s.bx) + 20) / this.cell);
      const z0 = Math.floor((Math.min(s.az, s.bz) - 20) / this.cell);
      const z1 = Math.floor((Math.max(s.az, s.bz) + 20) / this.cell);
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          const k = this.key(x, z);
          let a = this.grid.get(k);
          if (!a) this.grid.set(k, (a = []));
          a.push(i);
        }
    });
  }

  private key(x: number, z: number): number {
    return (x + 4096) * 8192 + (z + 4096);
  }

  /** Distance (m) to the nearest road within ~20 m, else Infinity. `out.kind` receives the road kind. */
  distance(x: number, z: number, out?: { kind: RoadKind | null }): number {
    const a = this.grid.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (out) out.kind = null;
    if (!a) return Infinity;
    let best = Infinity;
    for (const i of a) {
      const s = this.segs[i];
      const dx = s.bx - s.ax;
      const dz = s.bz - s.az;
      const l2 = dx * dx + dz * dz;
      let t = l2 > 0 ? ((x - s.ax) * dx + (z - s.az) * dz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = s.ax + dx * t - x;
      const pz = s.az + dz * t - z;
      const d = px * px + pz * pz;
      if (d < best) {
        best = d;
        if (out) out.kind = s.kind;
      }
    }
    return Math.sqrt(best);
  }
}
