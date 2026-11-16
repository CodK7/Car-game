// Ground seen by the vehicle: real terrain (bicubic heightmap) + the sand deformation grid (ruts, dug holes).
import type { Ground } from '../world/terrainData';
import type { SimGround } from '../vehicle/vehicleSim';
import { DeformGrid } from './deformGrid';

export class SandGround implements SimGround, Ground {
  constructor(readonly base: Ground, readonly deform: DeformGrid | null) {}
  heightAt(x: number, z: number): number {
    return this.base.heightAt(x, z) + (this.deform ? this.deform.heightAt(x, z) : 0);
  }
  normalAt(x: number, z: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    const e = 0.25;
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    const inv = 1 / Math.sqrt(dx * dx + dz * dz + 1);
    out.x = -dx * inv;
    out.y = inv;
    out.z = -dz * inv;
    return out;
  }
  looseAt(x: number, z: number): number {
    return this.base.looseAt(x, z);
  }
}
