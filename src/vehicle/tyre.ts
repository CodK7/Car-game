// Tyre model (pure TS). Combined-slip "similarity" model: normalised slips sx = κ/κpeak, sy = tanα/tanαpeak,
// force magnitude μ·Fz·shape(|s|) along the slip direction. Parameters depend on inflation pressure and sand type.
import { PSI_TO_KPA } from '../sand/sink';

export interface TyreSpec {
  radius: number; // m (unloaded)
  width: number; // m
  mu_hard: number; // peak friction on compacted ground at nominal pressure
  mu_sand: number; // peak friction on loose sand at nominal pressure
  kappaPeak: number; // slip ratio at peak (hard)
  alphaPeakDeg: number; // slip angle at peak (hard, nominal pressure)
  nominalPsi: number;
  shapeHard: number; // Pacejka-like C (higher = sharper drop after peak)
  shapeSand: number;
  sidewall_m: number; // sidewall height (for bulge / deflection)
}

export interface TyreState {
  mu: number;
  kappaPeak: number;
  tanAlphaPeak: number;
  C: number;
  B: number;
  /** extra rolling radius loss from deflection (m) */
  deflection: number;
  /** contact patch length (m) */
  patchLen: number;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/**
 * Tyre parameters for a pressure (psi), sand looseness (0..1) and load (N).
 * ASSUMPTION (DECISIONS W3.4): airing down from 30 to 12 psi roughly doubles the contact patch length (deflection
 * grows ~1/p), raises peak grip on loose sand ~25 %, lowers it slightly on hard ground (sidewall squirm), and
 * softens cornering stiffness (peak slip angle grows).
 */
export function tyreState(t: TyreSpec, psi: number, loose: number, load: number, out: TyreState): TyreState {
  const p = clamp(psi, 6, 45);
  const l = clamp(loose, 0, 1);
  const pn = t.nominalPsi;
  // vertical deflection ≈ load / (pressure * k): contact patch length from chord of the deflected circle
  const pk = (p * PSI_TO_KPA + 55) * 1000; // Pa, same carcass model as the sink model
  const area = Math.max(load, 0) / pk; // m²
  const patchLen = clamp(area / (t.width * 0.85), 0.05, t.radius * 1.4);
  const defl = clamp((patchLen * patchLen) / (8 * t.radius), 0, t.sidewall_m * 0.6);
  const softness = clamp((pn - p) / pn, -0.5, 0.75); // + when aired down
  const muHard = t.mu_hard * (1 - 0.06 * Math.max(softness, 0));
  const muSand = t.mu_sand * (1 + 0.38 * softness);
  out.mu = muHard * (1 - l) + muSand * l;
  out.kappaPeak = t.kappaPeak * (1 + 0.6 * l) * (1 + 0.4 * Math.max(softness, 0));
  const aPk = t.alphaPeakDeg * (1 + 0.9 * Math.max(softness, 0)) * (1 + 0.5 * l);
  out.tanAlphaPeak = Math.tan((aPk * Math.PI) / 180);
  out.C = t.shapeHard * (1 - l) + t.shapeSand * l;
  out.B = Math.tan(Math.PI / (2 * out.C));
  out.deflection = defl;
  out.patchLen = patchLen;
  return out;
}

/** Normalised force shape: 0 at s=0, 1 at s=1 (peak), falls off after depending on C. */
export function shape(s: number, B: number, C: number): number {
  return Math.sin(C * Math.atan(B * s));
}

/**
 * Combined slip force (Fx along tyre forward, Fy along tyre right) for slip velocities.
 * vRef regularises low speed so the model behaves like a stiff damper near standstill.
 */
export function tyreForce(
  st: TyreState, fz: number, grip: number, wheelSurf: number, vLong: number, vLat: number, vRefL: number, vRefS: number, out: [number, number],
): [number, number] {
  if (fz <= 0) {
    out[0] = 0;
    out[1] = 0;
    return out;
  }
  const kappa = (wheelSurf - vLong) / Math.max(Math.abs(vLong), vRefL);
  const tanA = vLat / Math.max(Math.abs(vLong), vRefS);
  const sx = kappa / st.kappaPeak;
  const sy = tanA / st.tanAlphaPeak;
  const s = Math.sqrt(sx * sx + sy * sy);
  if (s < 1e-9) {
    out[0] = 0;
    out[1] = 0;
    return out;
  }
  const F = st.mu * grip * fz * shape(s, st.B, st.C);
  out[0] = (F * sx) / s;
  out[1] = (-F * sy) / s;
  return out;
}
