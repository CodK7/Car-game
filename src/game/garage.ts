// Garage (pure TS, no DOM): applies data-driven parts (src/config/parts.json) to a VehicleSpec. Each option is a list
// of effects { path, op, value } on the spec; the result is a fresh deep copy, the preset stays untouched.
import parts from '../config/parts.json';
import { getSpec, VehicleSpec } from '../vehicle/vehicleSim';

export type SlotName = keyof typeof parts.slots;
export type Build = Partial<Record<SlotName, string>>;
export interface Effect { path: string; op: string; value: unknown }
interface OptionDef { label: string; price: number; effects: Effect[] }

export const SLOTS = parts.slots as unknown as Record<SlotName, { label: string; options: Record<string, OptionDef> }>;
export const SLOT_NAMES = Object.keys(SLOTS) as SlotName[];
export const LIVERIES = Object.fromEntries(Object.entries(parts.liveries).filter(([k]) => !k.startsWith('_'))) as Record<string, { label: string; paint: string }>;

export function stockOption(slot: SlotName): string {
  return Object.keys(SLOTS[slot].options)[0];
}
export function option(slot: SlotName, id: string): OptionDef | undefined {
  return SLOTS[slot].options[id];
}

function expand(path: string): string[] {
  return path.includes('*') ? ['front', 'rear'].map((s) => path.replace('*', s)) : [path];
}

export function applyEffect(spec: Record<string, unknown>, e: Effect): void {
  for (const p of expand(e.path)) {
    const keys = p.split('.');
    let o = spec as Record<string, unknown>;
    for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
    const k = keys[keys.length - 1];
    const v = e.value as number;
    switch (e.op) {
      case 'mul': o[k] = (o[k] as number) * v; break;
      case 'add': o[k] = (o[k] as number) + v; break;
      case 'set': o[k] = structuredClone(e.value); break;
      case 'setIfNull': if (o[k] == null) o[k] = structuredClone(e.value); break;
      case 'mulCurve': {
        // turbo-style gains build with rpm: full gain from 2000 rpm, a third of it at idle
        const curve = o[k] as number[][];
        o[k] = curve.map(([rpm, nm]) => [rpm, nm * (1 + (v - 1) * Math.min(1, 0.33 + 0.67 * Math.max(0, (rpm - 800) / 1200)))]);
        break;
      }
      default: throw new Error(`unknown op ${e.op}`);
    }
  }
}

/** Spec for a vehicle with the given parts fitted (unknown option ids fall back to stock). */
export function buildSpec(vehicle: string, build: Build = {}): VehicleSpec {
  const spec = structuredClone(getSpec(vehicle)) as unknown as Record<string, unknown>;
  for (const slot of SLOT_NAMES) {
    const id = build[slot];
    const opt = id ? option(slot, id) : undefined;
    for (const e of opt?.effects ?? []) applyEffect(spec, e);
  }
  return spec as unknown as VehicleSpec;
}

export function buildCost(build: Build): number {
  let c = 0;
  for (const slot of SLOT_NAMES) c += option(slot, build[slot] ?? '')?.price ?? 0;
  return c;
}

/** Peak power (kW) of a spec's torque curve (for the garage card and tests). */
export function peakPowerKW(spec: VehicleSpec): number {
  return Math.max(...spec.engine.torqueCurve.map(([rpm, nm]) => (nm * rpm * Math.PI) / 30 / 1000));
}
