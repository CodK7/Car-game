// Save game in localStorage (versioned JSON). Pure logic with an injectable storage so Vitest can run it in Node.
import parts from '../config/parts.json';
import { Build, option, SlotName, stockOption, SLOT_NAMES } from './garage';

export interface SaveData {
  v: 1;
  credits: number;
  vehicle: string;
  builds: Record<string, Build>;
  /** owned parts per vehicle, as "slot:option" */
  owned: Record<string, string[]>;
  livery: Record<string, string>;
  best: Record<string, number>;
  done: string[];
  odoKm: number;
}

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }
export const SAVE_KEY = 'wahiba.save.v1';

export function defaultSave(): SaveData {
  return { v: 1, credits: parts.startCredits, vehicle: 'patrol', builds: {}, owned: {}, livery: {}, best: {}, done: [], odoKm: 0 };
}

function storage(): KV | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadSave(kv: KV | null = storage()): SaveData {
  try {
    const raw = kv?.getItem(SAVE_KEY);
    if (!raw) return defaultSave();
    const d = JSON.parse(raw);
    if (d?.v !== 1) return defaultSave();
    return { ...defaultSave(), ...d };
  } catch {
    return defaultSave();
  }
}

export function writeSave(d: SaveData, kv: KV | null = storage()): boolean {
  try {
    kv?.setItem(SAVE_KEY, JSON.stringify(d));
    return !!kv;
  } catch {
    return false;
  }
}

export function owns(d: SaveData, veh: string, slot: SlotName, id: string): boolean {
  return id === stockOption(slot) || (d.owned[veh] ?? []).includes(`${slot}:${id}`);
}

/** Buy (if needed) and fit a part. Returns an error message or null. */
export function fitPart(d: SaveData, veh: string, slot: SlotName, id: string): string | null {
  const opt = option(slot, id);
  if (!opt) return 'Unknown part';
  if (!owns(d, veh, slot, id)) {
    if (d.credits < opt.price) return `Not enough credits (${opt.price} needed)`;
    d.credits -= opt.price;
    (d.owned[veh] ??= []).push(`${slot}:${id}`);
  }
  (d.builds[veh] ??= {})[slot] = id;
  return null;
}

export function buildOf(d: SaveData, veh: string): Build {
  const b: Build = {};
  for (const s of SLOT_NAMES) b[s] = d.builds[veh]?.[s] ?? stockOption(s);
  return b;
}
