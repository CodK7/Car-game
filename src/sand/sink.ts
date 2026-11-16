// Per-wheel sinkage / beaching model. Pure TypeScript (no DOM/WebGL) so Vitest can run it.
//
// Static sinkage: Bekker pressure–sinkage z = (p / k)^(1/n), with ground pressure p = load / contact area.
// Contact area comes from the tyre: p_ground ≈ inflation pressure + carcass stiffness (a common approximation for
// off-road tyres), so airing down lowers ground pressure and sinkage. k, n blend from compacted to loose sand.
// Dynamic digging: wheel slip speed at low ground speed on loose sand digs the wheel down (dz/dt ∝ slip), rolling
// forward climbs it back out. Rolling resistance follows sinkage (compaction + bulldozing).
import cfg from '../config/sand.json';

export type SinkParams = typeof cfg.sink;
export const PSI_TO_KPA = 6.894757;

export interface WheelSinkInput {
  load: number; // N (vertical tyre load)
  slipSpeed: number; // m/s, |wheel surface speed - ground speed| along the tyre
  groundSpeed: number; // m/s, contact patch speed over ground (abs)
  pressurePsi: number; // tyre inflation
  loose: number; // 0 compacted .. 1 loose sand
  width: number; // tyre width m
  radius: number; // tyre radius m
}

export interface WheelSink {
  /** current total sinkage below the undisturbed surface (m) */
  depth: number;
  /** static (load/pressure) part */
  static: number;
  /** dug part from wheel spin */
  dug: number;
  /** rolling resistance coefficient (force = crr * load) */
  crr: number;
  /** traction multiplier from sinkage (deep ruts reduce available grip) */
  grip: number;
  /** true when this wheel is dug in deep at low speed */
  stuck: boolean;
}

export function newWheelSink(): WheelSink {
  return { depth: 0, static: 0, dug: 0, crr: 0.012, grip: 1, stuck: false };
}

/** Ground pressure (kPa) under a tyre: inflation + carcass stiffness (the sidewall carries more at higher load). */
export function groundPressureKPa(pressurePsi: number, p: SinkParams = cfg.sink, load = p.carcassNominalLoad_N): number {
  return pressurePsi * PSI_TO_KPA + p.carcass_kPa * Math.sqrt(Math.max(load, 0) / p.carcassNominalLoad_N);
}

/** Contact patch area (m²) for a load (N) at a given inflation. */
export function contactArea(load: number, pressurePsi: number, p: SinkParams = cfg.sink): number {
  return load / 1000 / groundPressureKPa(pressurePsi, p, load);
}

/** Static Bekker sinkage (m) for a load on sand of a given looseness. */
export function staticSinkage(load: number, pressurePsi: number, loose: number, p: SinkParams = cfg.sink): number {
  if (load <= 0) return 0;
  const l = Math.min(Math.max(loose, 0), 1);
  // geometric blend of stiffness (spans ~2 orders of magnitude), linear blend of exponent
  const k = Math.exp(Math.log(p.k_compact_kPa_per_m_n) * (1 - l) + Math.log(p.k_loose_kPa_per_m_n) * l);
  const n = p.n_compact * (1 - l) + p.n_loose * l;
  const z = Math.pow(groundPressureKPa(pressurePsi, p, load) / k, 1 / n);
  return Math.min(z, p.maxStatic_m);
}

/** Hard-ground rolling resistance coefficient: rises as the tyre is aired down (flexing sidewall). */
export function crrHard(pressurePsi: number, p: SinkParams = cfg.sink): number {
  return p.crr_hard + Math.max(0, 30 - pressurePsi) * p.crr_hard_per_psi_below_30;
}

/** Advance one wheel's sinkage state by dt. Mutates and returns `s`. */
export function stepSink(s: WheelSink, inp: WheelSinkInput, dt: number, p: SinkParams = cfg.sink): WheelSink {
  const loose = Math.min(Math.max(inp.loose, 0), 1);
  if (inp.load <= 1) {
    // wheel in the air: ground no longer pressed, dug hole stays in the deformation grid (caller), state relaxes
    // unloaded (airborne, or a momentary unload while the suspension extends): sand is plastic, the rut stays;
    // the static part fades slowly instead of snapping to 0 (snapping caused a groove/suspension limit cycle)
    s.static = Math.max(0, s.static - s.static * Math.min(1, dt * 2));
    s.dug = Math.max(0, s.dug - p.settleRate * dt);
    s.depth = s.static + s.dug;
    s.crr = 0;
    s.grip = 1;
    s.stuck = false;
    return s;
  }
  const zs = staticSinkage(inp.load, inp.pressurePsi, loose, p);
  // static sinkage settles towards the target (tyre presses in over a short time)
  s.static += (zs - s.static) * Math.min(1, dt * 12);
  // digging: slip on loose sand at low ground speed throws sand out from under the tyre
  const lowSpeed = 1 / (1 + Math.pow(inp.groundSpeed / p.digLowSpeed_m_s, 2));
  const slipTerm = Math.max(0, inp.slipSpeed - 0.15) / p.digSlipSpeed_m_s;
  const pressureTerm = Math.sqrt(groundPressureKPa(inp.pressurePsi, p) / groundPressureKPa(20, p));
  const dig = p.digRate * loose * loose * slipTerm * lowSpeed * pressureTerm;
  // rolling forward climbs out of the hole (the hole stays behind in the grid)
  const climb = p.climbOut * inp.groundSpeed * s.dug;
  s.dug = Math.min(p.maxDig_m, Math.max(0, s.dug + (dig - climb) * dt));
  s.depth = s.static + s.dug;
  // rolling resistance: hard-ground part + Bekker compaction/bulldozing part ~ sqrt(z/D)
  const D = 2 * inp.radius;
  const sinkCrr = p.bulldoze * Math.sqrt(Math.max(s.depth, 0) / D) * (0.35 + 0.65 * loose);
  s.crr = crrHard(inp.pressurePsi, p) * (1 - loose) + sinkCrr;
  // deep ruts: the tread fills with sand and the tyre pushes a wall, grip drops
  s.grip = 1 - 0.45 * Math.min(1, s.dug / p.maxDig_m);
  s.stuck = s.dug > p.beachedDig_m && inp.groundSpeed < 0.6;
  return s;
}
