// Raycast vehicle simulation (pure TypeScript; three.js math only, no DOM/WebGL). Fixed timestep (120 Hz).
// Rigid chassis + 4 suspension rays (circle-vs-heightfield contact), combined-slip tyres, implicit wheel/driveline
// solve (engine, clutch, gearbox, transfer case 2H/4H/4L, open or locked axle diffs), sand sinkage coupling and
// chassis-ground contacts (beaching on the belly).
import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three';
import presets from '../config/vehicles.json';
import { TyreSpec, TyreState, tyreForce, tyreState } from './tyre';
import { newWheelSink, stepSink, WheelSink } from '../sand/sink';
import type { DeformGrid } from '../sand/deformGrid';

export interface SimGround {
  heightAt(x: number, z: number): number;
  looseAt(x: number, z: number): number;
}

export interface AxleSusp {
  travel: number; spring: number; bump: number; rebound: number; antiRoll: number; bumpStop: number;
  leaf?: boolean; leafFriction?: number;
}

export interface VehicleSpec {
  label: string;
  engineLayout: string;
  mass: number;
  cgHeight: number;
  frontWeightFrac: number;
  wheelbase: number;
  trackF: number;
  trackR: number;
  body: { length: number; width: number; height: number; groundClearance: number; overhangF: number };
  inertiaScale: number[];
  tyre: TyreSpec & { inertia: number };
  susp: { front: AxleSusp; rear: AxleSusp };
  engine: {
    idleRpm: number; limiterRpm: number; redlineRpm: number; inertia: number; frictionNm: number; engineBrakeNm: number;
    torqueCurve: number[][]; turbo: { lag_s: number; naFrac: number; spoolRpm: number } | null;
    thermal?: { ambientC: number; normalC: number; heatPerSecFull: number; coolPerSec: number; derateStartC: number; derateFullC: number; derateMax: number };
  };
  gearbox: { ratios: number[]; reverse: number; final: number; lowRange: number; shiftTime: number; autoUpRpm: number[]; autoDownRpm: number[]; clutchTorque: number; stallRpm: number; converterTR: number };
  driveline: { efficiency: number; rearLocker: boolean; frontLocker: boolean; fwd?: boolean; modes?: DriveMode[]; /** traction control: throttle cut when driven-wheel slip exceeds `slip` (ratio), `gain` cut per unit excess */ tc?: { slip: number; gain: number; minSpeed: number };
    /** player car's state when it is spawned (drift setup: 2H with the rear locker in) */
    start?: { mode?: DriveMode; rearLock?: boolean } };
  brakes: { front: number; rear: number; handbrake: number };
  steer: { maxDeg: number; speedReduce: number };
  aero: { cdA: number; liftA: number };
}

export const PRESETS = presets as unknown as Record<string, VehicleSpec>;

export function getSpec(name: string): VehicleSpec {
  const s = PRESETS[name] ?? PRESETS.patrol;
  return JSON.parse(JSON.stringify(s));
}

export interface VehicleInput {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: number;
  clutch: number;
}

export type DriveMode = '2H' | '4H' | '4L';

export class Wheel {
  mount = new Vector3(); // body frame, top of travel
  front: boolean;
  left: boolean;
  travel: number;
  susp: AxleSusp;
  radius: number;
  width: number;
  inertia: number;
  omega = 0;
  spin = 0; // visual rotation angle
  steer = 0; // rad, + = right
  s = 0; // suspension extension from mount (0 = full bump, travel = full droop)
  comp = 0;
  compPrev = 0;
  contact = false;
  load = 0;
  center = new Vector3();
  point = new Vector3();
  normal = new Vector3(0, 1, 0);
  fwd = new Vector3();
  right = new Vector3();
  vLong = 0;
  vLat = 0;
  slipRatio = 0;
  slipAngle = 0;
  slipSpeed = 0;
  groundSpeed = 0;
  loose = 0;
  fx = 0;
  fy = 0;
  pressurePsi: number;
  tyre: TyreState = { mu: 1, kappaPeak: 0.1, tanAlphaPeak: 0.12, C: 1.5, B: 1, deflection: 0, patchLen: 0.2 };
  sink: WheelSink = newWheelSink();
  prevPoint = new Vector3();
  hasPrev = false;
  /** static-friction anchor for a braked wheel at (almost) standstill; removes regularised-tyre creep */
  anchor = new Vector3();
  anchored = false;
  /** low-passed tyre deflection used for the rolling radius (instantaneous load feedback would oscillate) */
  deflF = 0;
  // linearisation scratch
  c0 = 0;
  k0 = 0;
  driveTorque = 0;
  staticLoad: number;
  constructor(front: boolean, left: boolean, susp: AxleSusp, spec: VehicleSpec) {
    this.front = front;
    this.left = left;
    this.susp = susp;
    this.travel = susp.travel;
    this.radius = spec.tyre.radius;
    this.width = spec.tyre.width;
    this.inertia = spec.tyre.inertia;
    this.pressurePsi = spec.tyre.nominalPsi;
    const share = front ? spec.frontWeightFrac : 1 - spec.frontWeightFrac;
    this.staticLoad = (spec.mass * 9.81 * share) / 2;
  }
}

const G = 9.81;
const tmpV = new Vector3();
const tmpV2 = new Vector3();
const tmpV3 = new Vector3();
const tmpF: [number, number] = [0, 0];
const UPV = new Vector3(0, 1, 0);

export class VehicleSim {
  spec: VehicleSpec;
  pos = new Vector3();
  quat = new Quaternion();
  vel = new Vector3();
  angVel = new Vector3();
  force = new Vector3();
  torque = new Vector3();
  mass: number;
  inertiaBody = new Vector3();
  wheels: Wheel[] = [];
  bodyPoints: Vector3[] = [];
  R = new Matrix3();
  up = new Vector3();
  fwd = new Vector3();
  right = new Vector3();
  // powertrain
  engineOmega: number;
  throttleEff = 0;
  boost = 0;
  limiterCut = false;
  limiterEvents = 0;
  gear = 1; // -1 reverse, 0 neutral, 1..n
  autoGearbox = true;
  shiftTimer = 0;
  gearHold = 0;
  /** traction control enabled (only acts when the spec has driveline.tc) */
  tcOn = true;
  /** current TCS throttle factor (1 = no cut) */
  tcFactor = 1;
  clutchEngage = 0;
  clutchSlip = 0;
  lockup = false;
  private lockHold = 0;
  engineTorque = 0;
  /** coolant temperature (°C) and resulting power factor: heat soak on long full-load climbs */
  engineTempC = 90;
  powerFactor = 1;
  private _mode: DriveMode = '4H';
  /** transfer-case mode, limited to the modes the vehicle has (driveline.modes; a FWD sedan only has 2H) */
  get mode(): DriveMode {
    return this._mode;
  }
  set mode(m: DriveMode) {
    const ok = this.spec?.driveline.modes ?? ['2H', '4H', '4L'];
    this._mode = ok.includes(m) ? m : ok.includes('4H') ? '4H' : ok[0];
  }
  rearLock = false;
  frontLock = false;
  deform: DeformGrid | null = null;
  /** chassis-ground contact load (N), > 0 when the belly or bumpers touch */
  bodyContactLoad = 0;
  /** distance travelled (m) */
  odo = 0;
  time = 0;
  input: VehicleInput = { throttle: 0, brake: 0, steer: 0, handbrake: 0, clutch: 0 };
  extForce = new Vector3(); // recovery ropes etc. (world, applied at extPoint)
  extPoint = new Vector3();
  extActive = false;
  private bodyContact: boolean[] = [];

  constructor(spec: VehicleSpec, readonly ground: SimGround) {
    this.spec = spec;
    this.mode = this._mode; // clamp the default to the modes this vehicle has
    this.mass = spec.mass;
    const b = spec.body;
    const sc = spec.inertiaScale;
    // box inertia of a vehicle-sized body, mass concentrated low (ASSUMPTION: 0.8 factor on a uniform box)
    this.inertiaBody.set(
      (this.mass / 12) * (b.height * b.height + b.length * b.length) * 0.8 * sc[0],
      (this.mass / 12) * (b.width * b.width + b.length * b.length) * 0.8 * sc[1],
      (this.mass / 12) * (b.width * b.width + b.height * b.height) * 0.8 * sc[2],
    );
    const zF = -spec.wheelbase * (1 - spec.frontWeightFrac);
    const zR = spec.wheelbase * spec.frontWeightFrac;
    const yC = -spec.cgHeight + spec.tyre.radius;
    const mk = (front: boolean, left: boolean) => {
      const su = front ? spec.susp.front : spec.susp.rear;
      const w = new Wheel(front, left, su, spec);
      const corner = (this.mass * G * (front ? spec.frontWeightFrac : 1 - spec.frontWeightFrac)) / 2;
      const c0 = Math.min(corner / su.spring, su.travel * 0.8);
      const s0 = su.travel - c0;
      const tr = front ? spec.trackF : spec.trackR;
      w.mount.set((left ? -tr : tr) / 2, yC + s0, front ? zF : zR);
      w.s = s0;
      return w;
    };
    this.wheels = [mk(true, true), mk(true, false), mk(false, true), mk(false, false)];
    // chassis contact points (body frame): belly, bumpers, roof corners
    const yb = -spec.cgHeight + b.groundClearance + 0.1;
    const zFront = zF - b.overhangF;
    const zRear = zFront + b.length;
    const hw = b.width * 0.45;
    const yTop = -spec.cgHeight + b.height;
    const pts: number[][] = [
      [-0.4, yb - 0.04, zF + 0.45], [0.4, yb - 0.04, zF + 0.45], [-0.4, yb - 0.04, zR - 0.45], [0.4, yb - 0.04, zR - 0.45],
      [-0.5, yb, (zF + zR) / 2], [0.5, yb, (zF + zR) / 2],
      [-hw, yb + 0.3, zFront + 0.05], [hw, yb + 0.3, zFront + 0.05], [0, yb + 0.25, zFront],
      [-hw, yb + 0.25, zRear - 0.05], [hw, yb + 0.25, zRear - 0.05],
      [-hw, yTop, zF + 0.6], [hw, yTop, zF + 0.6], [-hw, yTop, zR - 0.2], [hw, yTop, zR - 0.2],
      [-b.width / 2, yb + 0.5, (zF + zR) / 2], [b.width / 2, yb + 0.5, (zF + zR) / 2],
    ];
    this.bodyPoints = pts.map((p) => new Vector3(p[0], p[1], p[2]));
    this.bodyContact = this.bodyPoints.map(() => false);
    this.engineOmega = (spec.engine.idleRpm * Math.PI) / 30;
  }

  get rpm(): number {
    return (this.engineOmega * 30) / Math.PI;
  }
  /** forward speed m/s (signed) */
  get speed(): number {
    return this.vel.dot(this.fwd);
  }

  /** Place the vehicle on the ground at (x, z) with compass heading (deg, 0 = north/-z, 90 = east/+x). */
  reset(x: number, z: number, headingDeg: number): void {
    // align to the local ground plane (fitted over the footprint) so spawning on a slope does not drop/pivot the car
    const g = this.ground;
    const dhdx = (g.heightAt(x + 2, z) - g.heightAt(x - 2, z)) / 4;
    const dhdz = (g.heightAt(x, z + 2.5) - g.heightAt(x, z - 2.5)) / 5;
    const n = tmpA.set(-dhdx, 1, -dhdz).normalize();
    this.quat.setFromUnitVectors(UPV, n).multiply(tmpQ.setFromAxisAngle(UPV, (-headingDeg * Math.PI) / 180));
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    let gy = -Infinity;
    for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) gy = Math.max(gy, g.heightAt(x + dx, z + dz) - (dhdx * dx + dhdz * dz));
    this.pos.set(x, gy, z).addScaledVector(n, this.spec.cgHeight + 0.12);
    for (const w of this.wheels) {
      w.omega = 0;
      w.sink = newWheelSink();
      w.hasPrev = false;
      w.compPrev = w.comp = w.travel - w.s;
    }
    this.engineOmega = (this.spec.engine.idleRpm * Math.PI) / 30;
    this.gear = 1;
    this.shiftTimer = 0;
    this.updateFrame();
  }

  /** refresh R / fwd / up / right from quat (also used for network ghosts) */
  updateFrame(): void {
    this.R.setFromMatrix4(tmpM4.makeRotationFromQuaternion(this.quat));
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    this.fwd.set(0, 0, -1).applyQuaternion(this.quat);
    this.right.set(1, 0, 0).applyQuaternion(this.quat);
  }

  totalRatio(): number {
    const gb = this.spec.gearbox;
    if (this.gear === 0) return 0;
    const g = this.gear < 0 ? -gb.reverse : gb.ratios[this.gear - 1];
    return g * gb.final * (this.mode === '4L' ? gb.lowRange : 1);
  }

  private peakPowerW = 0;
  private computePeakPower(): number {
    let p = 1;
    for (const [r, t] of this.spec.engine.torqueCurve) p = Math.max(p, (t * r * Math.PI) / 30);
    return p;
  }

  /** full-load torque from the published curve (no boost lag, no heat derate) */
  curveTorque(rpm: number): number {
    const c = this.spec.engine.torqueCurve;
    if (rpm <= c[0][0]) return c[0][1] * Math.max(rpm / c[0][0], 0);
    for (let i = 1; i < c.length; i++)
      if (rpm <= c[i][0]) return c[i - 1][1] + ((c[i][1] - c[i - 1][1]) * (rpm - c[i - 1][0])) / (c[i][0] - c[i - 1][0]);
    return c[c.length - 1][1];
  }

  engineTorqueAt(rpm: number, thr: number): number {
    const e = this.spec.engine;
    const c = e.torqueCurve;
    let T = c[c.length - 1][1];
    if (rpm <= c[0][0]) T = c[0][1] * Math.max(rpm / c[0][0], 0);
    else
      for (let i = 1; i < c.length; i++)
        if (rpm <= c[i][0]) {
          const t = (rpm - c[i - 1][0]) / (c[i][0] - c[i - 1][0]);
          T = c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t;
          break;
        }
    // turbo: without boost the engine is limited to naFrac of its peak torque (the low-rpm part of the curve is already
    // naturally aspirated, so it is not scaled down)
    if (e.turbo) {
      let pk = 0;
      for (const p of c) pk = Math.max(pk, p[1]);
      T = Math.min(T, pk * (e.turbo.naFrac + (1 - e.turbo.naFrac) * this.boost));
    }
    const boostF = 1;
    const brake = e.engineBrakeNm * Math.min(1, rpm / e.limiterRpm);
    return T * boostF * this.powerFactor * thr - brake * (1 - thr) - e.frictionNm * Math.min(1, rpm / 1000);
  }

  step(dt: number): void {
    const spec = this.spec;
    const inp = this.input;
    this.time += dt;
    this.updateFrame();
    const sp = this.speed;
    const absSp = Math.abs(sp);

    // ---- steering (Ackermann) ----
    const maxSteer = ((spec.steer.maxDeg * Math.PI) / 180) * (1 - spec.steer.speedReduce * Math.min(1, absSp / 33));
    const d = inp.steer * maxSteer;
    if (Math.abs(d) > 1e-4) {
      const L = spec.wheelbase, T = spec.trackF;
      const Rr = L / Math.tan(Math.abs(d));
      const inner = Math.atan(L / (Rr - T / 2));
      const outer = Math.atan(L / (Rr + T / 2));
      const sgn = Math.sign(d);
      // right turn: right wheel is inner
      this.wheels[0].steer = sgn * (d > 0 ? outer : inner);
      this.wheels[1].steer = sgn * (d > 0 ? inner : outer);
    } else this.wheels[0].steer = this.wheels[1].steer = 0;

    this.force.set(0, -G * this.mass, 0);
    this.torque.set(0, 0, 0);

    // ---- suspension contacts ----
    for (const w of this.wheels) this.suspension(w, dt);
    // anti-roll bars
    for (const [a, b] of [[0, 1], [2, 3]]) {
      const wl = this.wheels[a], wr = this.wheels[b];
      const k = wl.susp.antiRoll;
      if (!k) continue;
      const f = k * (wl.comp - wr.comp);
      if (wl.contact) wl.load = Math.max(0, wl.load + f);
      if (wr.contact) wr.load = Math.max(0, wr.load - f);
    }
    for (const w of this.wheels) {
      if (!w.contact) continue;
      this.applyForce(tmpV.copy(this.up).multiplyScalar(w.load), w.center);
    }

    // ---- tyre frames + linearisation ----
    for (const w of this.wheels) this.tyrePrep(w);

    // ---- powertrain + wheel spin (implicit) ----
    this.powertrain(dt);

    // ---- tyre forces with the new wheel speeds ----
    for (const w of this.wheels) {
      if (!w.contact) {
        w.fx = w.fy = 0;
        continue;
      }
      const held = inp.brake > 0.05 || (!w.front && inp.handbrake > 0.05);
      if (held && Math.abs(w.vLong) < 0.4 && Math.abs(w.vLat) < 0.4) {
        // static friction: spring-damper to an anchor in the contact plane, capped at the friction limit (slides beyond)
        if (!w.anchored) {
          w.anchor.copy(w.point);
          w.anchored = true;
        }
        const dpos = tmpV.copy(w.point).sub(w.anchor);
        dpos.addScaledVector(w.normal, -dpos.dot(w.normal));
        const k = 60 * w.load + 1000;
        const c = 2 * Math.sqrt(k * this.mass * 0.25);
        let fx = -k * dpos.dot(w.fwd) - c * w.vLong;
        let fy = -k * dpos.dot(w.right) - c * w.vLat;
        const lim = w.tyre.mu * w.sink.grip * w.load;
        const fm = Math.hypot(fx, fy);
        if (fm > lim) {
          fx *= lim / fm;
          fy *= lim / fm;
          // slide: move the anchor so the spring sits at the limit
          w.anchor.copy(w.point).addScaledVector(w.fwd, fx / k).addScaledVector(w.right, fy / k);
        }
        w.fx = fx;
        w.fy = fy;
        w.omega = 0;
      } else {
        w.anchored = false;
        tyreForce(w.tyre, w.load, w.sink.grip, w.omega * w.radius, w.vLong, w.vLat, 2.0, 2.5, tmpF);
        w.fx = tmpF[0];
        w.fy = tmpF[1];
      }
      const F = tmpV.copy(w.fwd).multiplyScalar(w.fx).addScaledVector(w.right, w.fy);
      // tyre forces act through a solid axle: apply at ~axle height (roll centre) rather than at the patch
      tmpV2.copy(w.point).addScaledVector(w.normal, w.radius * 0.75);
      this.applyForce(F, tmpV2);
      w.slipSpeed = w.omega * w.radius - w.vLong;
      w.slipRatio = w.slipSpeed / Math.max(Math.abs(w.vLong), 0.5);
      w.slipAngle = Math.atan2(w.vLat, Math.abs(w.vLong) + 0.1);
    }

    // ---- chassis-ground contacts ----
    this.bodyContacts();

    // ---- aero ----
    const v2 = this.vel.lengthSq();
    if (v2 > 0.01) {
      const vl = Math.sqrt(v2);
      this.force.addScaledVector(this.vel, -0.5 * 1.18 * spec.aero.cdA * vl);
    }
    if (this.extActive) this.applyForce(this.extForce, this.extPoint);

    // ---- integrate ----
    this.vel.addScaledVector(this.force, dt / this.mass);
    // world inverse inertia: R * diag(1/I) * R^T
    tmpV.copy(this.angVel).applyMatrix3(tmpR.copy(this.R).transpose()); // body frame ω
    const Ib = this.inertiaBody;
    tmpV2.set(Ib.x * tmpV.x, Ib.y * tmpV.y, Ib.z * tmpV.z); // L body
    tmpV3.copy(tmpV).cross(tmpV2); // ω × Iω (gyroscopic)
    const tb = tmpV2.copy(this.torque).applyMatrix3(tmpR).sub(tmpV3);
    tb.set(tb.x / Ib.x, tb.y / Ib.y, tb.z / Ib.z).applyMatrix3(this.R);
    this.angVel.addScaledVector(tb, dt);
    const am = this.angVel.length();
    if (am > 12) this.angVel.multiplyScalar(12 / am);
    this.pos.addScaledVector(this.vel, dt);
    this.odo += this.vel.length() * dt;
    const q = this.quat;
    const ox = this.angVel.x * dt * 0.5, oy = this.angVel.y * dt * 0.5, oz = this.angVel.z * dt * 0.5;
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    q.set(qx + ox * qw + oy * qz - oz * qy, qy + oy * qw + oz * qx - ox * qz, qz + oz * qw + ox * qy - oy * qx, qw - ox * qx - oy * qy - oz * qz).normalize();

    // ---- sand: sinkage + deformation ----
    for (const w of this.wheels) {
      w.spin += w.omega * dt;
      if (!w.contact) {
        stepSink(w.sink, { load: 0, slipSpeed: 0, groundSpeed: 0, pressurePsi: w.pressurePsi, loose: w.loose, width: w.width, radius: w.radius }, dt);
        w.hasPrev = false;
        continue;
      }
      w.groundSpeed = Math.hypot(w.vLong, w.vLat);
      stepSink(w.sink, { load: w.load, slipSpeed: Math.abs(w.slipSpeed), groundSpeed: w.groundSpeed, pressurePsi: w.pressurePsi, loose: w.loose, width: w.width, radius: w.radius }, dt);
      if (this.deform) {
        // extend the stamp ahead/behind to where the tyre circle reaches the rut depth, so the wheel never wedges on its own groove wall
        const dd = Math.max(w.sink.depth, 0);
        const a = Math.max(0.62 * w.radius, Math.sqrt(Math.max(0, 2 * w.radius * dd - dd * dd)) + 0.12);
        const hx = w.fwd.x, hz = w.fwd.z, hl = Math.hypot(hx, hz) || 1;
        const ux = (hx / hl) * a, uz = (hz / hl) * a;
        const ax = (w.hasPrev ? w.prevPoint.x : w.point.x) - ux, az = (w.hasPrev ? w.prevPoint.z : w.point.z) - uz;
        // tread width grows a little when aired down (bulge)
        const width = w.width * (1 + 0.6 * Math.min(1, w.tyre.deflection / (w.radius * 0.25)));
        this.deform.stampGroove(ax, az, w.point.x + ux, w.point.z + uz, width, w.sink.depth, w.loose);
        w.prevPoint.copy(w.point);
        w.hasPrev = true;
      }
    }
  }

  /** Torque about the CG from a world force at a world point. */
  applyForce(F: Vector3, p: Vector3): void {
    this.force.add(F);
    tmpT.copy(p).sub(this.pos).cross(F);
    this.torque.add(tmpT);
  }

  private groundTop(x: number, z: number): number {
    return this.ground.heightAt(x, z);
  }

  private suspension(w: Wheel, dt: number): void {
    const M = tmpA.copy(w.mount).applyMatrix3(this.R).add(this.pos);
    const D = tmpB.copy(this.up).negate();
    const r = w.radius - w.deflF * 0.5;
    // tyre forward projected horizontally, for sampling the ground along the circle
    const fx = this.fwd.x * Math.cos(w.steer) + this.right.x * Math.sin(w.steer);
    const fz = this.fwd.z * Math.cos(w.steer) + this.right.z * Math.sin(w.steer);
    const fl = Math.hypot(fx, fz) || 1;
    const hx = fx / fl, hz = fz / fl;
    const noDeform = !this.deform;
    let s = Math.min(Math.max(w.s, 0), w.travel);
    w.contact = false;
    if (D.y > -0.25) {
      // upside down or on its side: wheels give no support
      w.s = w.travel;
      w.compPrev = w.comp;
      w.comp = 0;
      w.load = 0;
      return;
    }
    let req = 0;
    for (let it = 0; it < 2; it++) {
      const cx = M.x + D.x * s, cz = M.z + D.z * s;
      req = -Infinity;
      for (let k = -2; k <= 2; k++) {
        const o = k * 0.3 * r;
        const h = this.groundTop(cx + hx * o, cz + hz * o) + Math.sqrt(r * r - o * o);
        if (h > req) req = h;
      }
      if (noDeform) req -= w.sink.depth;
      s = (M.y - req) / -D.y;
    }
    w.compPrev = w.comp;
    if (s > w.travel) {
      w.s = w.travel;
      w.comp = 0;
      w.load = 0;
      w.center.copy(M).addScaledVector(D, w.travel);
      return;
    }
    let over = 0;
    if (s < 0) {
      over = -s;
      s = 0;
    }
    w.s = s;
    w.comp = w.travel - s;
    w.contact = true;
    w.center.copy(M).addScaledVector(D, s);
    // ground normal (includes ruts via deformation in heightAt)
    const e = 0.2;
    const gx = (this.groundTop(w.center.x + e, w.center.z) - this.groundTop(w.center.x - e, w.center.z)) / (2 * e);
    const gz = (this.groundTop(w.center.x, w.center.z + e) - this.groundTop(w.center.x, w.center.z - e)) / (2 * e);
    w.normal.set(-gx, 1, -gz).normalize();
    w.point.copy(w.center).addScaledVector(w.normal, -r);
    w.loose = this.ground.looseAt(w.point.x, w.point.z);
    const su = w.susp;
    const vc = (w.comp - w.compPrev) / dt;
    let F = su.spring * w.comp + (vc > 0 ? su.bump : su.rebound) * vc;
    if (su.leaf && su.leafFriction) F += su.leafFriction * Math.tanh(vc / 0.02);
    const bs0 = w.travel * 0.85;
    if (w.comp > bs0) {
      const x = w.comp - bs0;
      F += su.bumpStop * x * (x / (w.travel * 0.15));
    }
    if (over > 0) F += su.bumpStop * 2 * over + 8000 * Math.max(vc, 0);
    w.load = Math.max(0, F);
  }

  private tyrePrep(w: Wheel): void {
    // wheel forward in world (steered), projected on the contact plane
    const c = Math.cos(w.steer), s = Math.sin(w.steer);
    w.fwd.copy(this.fwd).multiplyScalar(c).addScaledVector(this.right, s);
    if (w.contact) {
      w.fwd.addScaledVector(w.normal, -w.fwd.dot(w.normal)).normalize();
      w.right.copy(w.fwd).cross(w.normal).normalize();
      const v = tmpV.copy(w.point).sub(this.pos);
      const vp = tmpV2.copy(this.angVel).cross(v).add(this.vel);
      w.vLong = vp.dot(w.fwd);
      w.vLat = vp.dot(w.right);
      tyreState(this.spec.tyre, w.pressurePsi, w.loose, Math.min(w.load, w.staticLoad * 2.5), w.tyre);
      if (!w.front && this.spec.tyre.rearGrip) w.tyre.mu *= this.spec.tyre.rearGrip;
      w.deflF += (w.tyre.deflection - w.deflF) * 0.04;
    } else {
      w.right.copy(w.fwd).cross(this.up).normalize();
      w.vLong = this.vel.dot(w.fwd);
      w.vLat = 0;
    }
    // linearised tyre torque on the wheel: τ ≈ c0 + k0 (ω' - ω)
    const r = w.radius;
    if (w.contact && w.load > 0) {
      const f = (om: number) => tyreForce(w.tyre, w.load, w.sink.grip, om * r, w.vLong, w.vLat, 2.0, 2.5, tmpF)[0];
      const f0 = f(w.omega);
      const h = 0.05;
      const slope = (f(w.omega + h) - f(w.omega - h)) / (2 * h);
      w.c0 = -r * f0;
      w.k0 = -r * Math.max(slope, 0);
    } else {
      w.c0 = 0;
      w.k0 = 0;
    }
    // friction torques: brakes, handbrake, rolling resistance (Coulomb with a viscous core so it can hold at 0)
    const inp = this.input;
    const br = this.spec.brakes;
    let Tf = inp.brake * (w.front ? br.front : br.rear) + (w.front ? 0 : inp.handbrake * br.handbrake);
    if (w.contact) Tf += w.sink.crr * w.load * r;
    Tf += 6; // bearing drag
    const eps = 0.6;
    if (Math.abs(w.omega) > eps) w.c0 -= Tf * Math.sign(w.omega);
    else w.k0 -= Tf / eps;
  }

  private powertrain(dt: number): void {
    const spec = this.spec;
    const e = spec.engine;
    const gb = spec.gearbox;
    const inp = this.input;
    const W = this.wheels;
    const rpm = this.rpm;
    // limiter: hard cut with hysteresis
    if (rpm > e.limiterRpm) {
      if (!this.limiterCut) this.limiterEvents++;
      this.limiterCut = true;
    } else if (rpm < e.limiterRpm - 180) this.limiterCut = false;
    // idle governor: adds fuel below idle, up to full fuel when the engine is being lugged towards a stall
    const idleThr = Math.min(1, Math.max(0, (e.idleRpm * 1.05 - rpm) / 120));
    let thr = this.limiterCut ? 0 : inp.throttle;
    const tc = spec.driveline.tc;
    if (tc && this.tcOn) {
      // TCS: wheel speed of the driven axle vs ground speed; smoothed so the cut does not chatter
      const f = spec.driveline.fwd ? [W[0], W[1]] : [W[2], W[3]];
      const vw = Math.max(Math.abs(f[0].omega * f[0].radius), Math.abs(f[1].omega * f[1].radius));
      const vg = Math.max(Math.abs(this.speed), tc.minSpeed);
      const excess = Math.max(0, (vw - vg) / vg - tc.slip);
      const target = Math.max(0, 1 - tc.gain * excess);
      this.tcFactor += (target - this.tcFactor) * Math.min(1, dt / (target < this.tcFactor ? 0.03 : 0.25));
    } else this.tcFactor = 1;
    thr *= this.tcFactor;
    if (this.shiftTimer > 0) thr *= 0.15;
    this.throttleEff = Math.max(thr, idleThr);
    if (e.turbo) {
      const target = inp.throttle * smooth(e.turbo.spoolRpm * 0.7, e.turbo.spoolRpm * 1.7, rpm);
      this.boost += (target - this.boost) * Math.min(1, dt / e.turbo.lag_s);
    }
    this.engineTorque = this.engineTorqueAt(rpm, this.throttleEff);
    const th = e.thermal;
    if (th) {
      // ASSUMPTION (W3.6): lumped coolant model. Heat ∝ engine power fraction, cooling ∝ (T − thermostat) × airflow.
      const pMax = this.peakPowerW || (this.peakPowerW = this.computePeakPower());
      const pFrac = Math.max(0, (this.engineTorque * this.engineOmega) / pMax);
      const air = 0.4 + 0.6 * Math.min(1, Math.abs(this.speed) / 20);
      const amb = th.ambientC;
      let dT = pFrac * th.heatPerSecFull - th.coolPerSec * Math.max(0, this.engineTempC - th.normalC) * air;
      if (this.engineTempC < th.normalC) dT += 0.05 * (1 + pFrac); // warm-up towards the thermostat
      this.engineTempC = Math.max(amb, this.engineTempC + dT * dt);
      this.powerFactor = 1 - th.derateMax * smooth(th.derateStartC, th.derateFullC, this.engineTempC);
    }

    // ---- gearbox (auto logic) ----
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    if (this.gearHold > 0) this.gearHold -= dt;
    const ratio = this.totalRatio();
    // primary (always driven) axle: rear for the 4x4s, front for a FWD car (driveline.fwd)
    const fwd = !!spec.driveline.fwd;
    const p0 = fwd ? 0 : 2, p1 = fwd ? 1 : 3, s0 = fwd ? 2 : 0, s1 = fwd ? 3 : 1;
    const rearAvg = (W[p0].omega + W[p1].omega) / 2;
    if (this.autoGearbox && this.gear > 0 && this.shiftTimer <= 0) {
      // output-shaft speed as a TCU sees it, clamped to ground speed (-15 % / +15 % +2 rad/s) so wheelspin or wheel hop does not trigger shifts
      const vOut = Math.abs(this.speed) / W[2].radius;
      const rpmIn = (Math.min(Math.max(Math.abs(rearAvg), vOut * 0.85), vOut * 1.15 + 2) * Math.abs(ratio) * 30) / Math.PI;
      const up = lerp(gb.autoUpRpm[0], gb.autoUpRpm[1], inp.throttle);
      const dn = lerp(gb.autoDownRpm[0], gb.autoDownRpm[1], inp.throttle);
      const rs = gb.ratios;
      // hysteresis: only shift if the new gear lands inside the band (prevents hunting)
      const rpmUp = this.gear < rs.length ? (rpmIn * rs[this.gear]) / rs[this.gear - 1] : 0;
      const rpmDn = this.gear > 1 ? (rpmIn * rs[this.gear - 2]) / rs[this.gear - 1] : Infinity;
      // minimum time in gear (no hunting), except a kickdown when the engine is lugging far below the band
      const canShift = this.gearHold <= 0;
      if (canShift && rpmIn > up && this.gear < rs.length && (rpmUp > dn * 1.1 || rpmIn > e.limiterRpm * 0.95)) {
        this.gear++;
        this.shiftTimer = gb.shiftTime;
        this.gearHold = 1.2;
      } else if ((canShift || rpmIn < dn * 0.6) && rpmIn < dn && this.gear > 1 && rpmDn < up * 0.85) {
        this.gear--;
        this.shiftTimer = gb.shiftTime * 0.7;
        this.gearHold = 1.2;
      }
    }

    // ---- clutch engagement (pedal, shift, and an anti-stall launch model) ----
    let engage = this.autoGearbox ? 1 : 1 - inp.clutch;
    if (this.shiftTimer > 0 && !this.autoGearbox) engage = 0;
    if (this.gear === 0) engage = 0;
    // manual: anti-stall clutch assist near idle
    if (!this.autoGearbox) engage *= smooth(e.idleRpm * 0.9, e.idleRpm * 1.8, rpm);
    this.clutchEngage = engage;

    // ---- implicit driveline solve over DOFs ----
    // DOF 0 engine; 1 rear axle mean; then optional rear diff, front mean (2H), front diff
    const centerLocked = this.mode !== '2H';
    const rearOpen = !(this.rearLock && spec.driveline.rearLocker);
    const frontOpen = !(this.frontLock && spec.driveline.frontLocker && centerLocked);
    let m = 2;
    const iDr = rearOpen ? m++ : -1;
    const iF = centerLocked ? 1 : m++;
    const iDf = frontOpen ? m++ : -1;
    // J: wheel ω = Σ J[i][k] q[k]
    const J = JM;
    for (let i = 0; i < 4; i++) for (let k = 0; k < 6; k++) J[i][k] = 0;
    J[p0][1] = 1; J[p1][1] = 1;
    if (iDr >= 0) { J[p0][iDr] = 1; J[p1][iDr] = -1; }
    J[s0][iF] = 1; J[s1][iF] = 1;
    if (iDf >= 0) { J[s0][iDf] = 1; J[s1][iDf] = -1; }
    // current q from wheel speeds
    const q = QV;
    q[0] = this.engineOmega;
    q[1] = (W[p0].omega + W[p1].omega) / 2;
    if (iDr >= 0) q[iDr] = (W[p0].omega - W[p1].omega) / 2;
    if (!centerLocked) q[iF] = (W[s0].omega + W[s1].omega) / 2;
    if (iDf >= 0) q[iDf] = (W[s0].omega - W[s1].omega) / 2;
    if (centerLocked) {
      // part-time 4WD: front and rear shafts locked together; snap to the inertia-weighted mean
      const mean = (W[0].omega + W[1].omega + W[2].omega + W[3].omega) / 4;
      q[1] = mean;
    }
    const A = AM, b = BV;
    for (let i = 0; i < m; i++) {
      b[i] = 0;
      for (let k = 0; k < m; k++) A[i][k] = 0;
    }
    // wheels: M += J^T I J ; Q += J^T c ; K += J^T k J
    for (let i = 0; i < 4; i++) {
      const w = W[i];
      for (let a = 1; a < m; a++) {
        const ja = J[i][a];
        if (!ja) continue;
        b[a] += dt * ja * w.c0;
        for (let c = 1; c < m; c++) {
          const jc = J[i][c];
          if (!jc) continue;
          A[a][c] += ja * jc * (w.inertia - dt * w.k0);
        }
      }
    }
    // engine inertia and torque
    A[0][0] += e.inertia;
    b[0] += dt * this.engineTorque;
    // clutch between engine (DOF 0) and gearbox input = ratio * rear shaft (DOF 1), efficiency on the gear side
    const eta = spec.driveline.efficiency;
    const Kc = 4000;
    const cap = engage * gb.clutchTorque;
    const wt = ratio * q[1]; // gearbox input (turbine) speed
    const sr = this.engineOmega > 1 ? wt / this.engineOmega : 0;
    if (this.autoGearbox) {
      // lock-up clutch in 2nd and above once the converter is nearly coupled
      // state is held for a minimum time so driven-wheel hop cannot make it chatter; stays open while TCS is cutting
      this.lockHold -= dt;
      const want = this.lockup
        ? !(sr < 0.8 || this.gear < 2 || this.shiftTimer > 0)
        : this.gear >= 2 && sr > 0.9 && this.shiftTimer <= 0 && this.tcFactor > 0.95;
      if (this.gear < 2 || this.shiftTimer > 0) {
        this.lockup = false;
      } else if (want !== this.lockup && this.lockHold <= 0) {
        this.lockup = want;
        this.lockHold = 0.6;
      }
    } else this.lockup = false;
    if (this.autoGearbox && !this.lockup && ratio !== 0 && engage > 0) {
      // torque converter: pump torque = (ω_e / K)², K from the stall speed; turbine torque = TR(sr) · pump torque
      const ws = (gb.stallRpm * Math.PI) / 30;
      // K-factor from the rated (full-boost) torque at the stall speed: a converter property, not the current boost state
      const K2 = (ws * ws) / Math.max(this.curveTorque(gb.stallRpm), 50);
      const TRs = gb.converterTR;
      // returns [engine torque, rear-shaft torque] from the converter at (ω_e, ω_turbine)
      const conv = (we: number, wt: number, out: number[]) => {
        let Tp: number, TR: number;
        if (Math.abs(wt) <= we) {
          const x = we > 1 ? Math.abs(wt) / we : 0;
          const cap01 = x < 0.85 ? 1 : Math.max(0, (1 - x) / 0.15);
          Tp = ((we * we) / K2) * cap01;
          TR = x < 0.85 ? TRs - ((TRs - 1) * x) / 0.85 : 1;
          if (wt < 0) TR = TRs; // turbine stalled/driven backwards (rolling back): full stall multiplication
        } else {
          // overrun: turbine drives the pump (engine braking through the converter)
          const x = we / Math.abs(wt);
          Tp = -((wt * wt) / K2) * Math.min(1, (1 - x) / 0.15) * 0.6 * Math.sign(wt);
          TR = 1;
        }
        out[0] = -Tp;
        out[1] = eta * ratio * Tp * TR;
        return out;
      };
      // implicit: linearise around the current state (explicit integration diverges when the wheels spin up)
      const we = this.engineOmega;
      const c0 = conv(we, wt, CV0);
      const hE = 0.5, hT = 0.5;
      const cE = conv(we + hE, wt, CV1);
      const dE0 = (cE[0] - c0[0]) / hE, dE1 = (cE[1] - c0[1]) / hE;
      const cT = conv(we, wt + hT, CV1);
      const dT0 = ((cT[0] - c0[0]) / hT) * ratio, dT1 = ((cT[1] - c0[1]) / hT) * ratio;
      b[0] += dt * c0[0];
      b[1] += dt * c0[1];
      A[0][0] -= dt * Math.min(dE0, 0);
      A[0][1] -= dt * dT0;
      A[1][0] -= dt * dE1;
      A[1][1] -= dt * Math.min(dT1, 0);
      this.clutchSlip = Math.min(1, Math.max(0, 1 - sr));
    } else if (ratio !== 0 && cap > 0) {
      const dw = this.engineOmega - ratio * q[1];
      // effective inertia across the clutch: the torque that syncs both sides in one step is Irel·|dw|/dt
      const Irel = 1 / (1 / Math.max(A[0][0], 1e-3) + (eta * ratio * ratio) / Math.max(A[1][1], 1e-3));
      if (Kc * Math.abs(dw) < cap || (Irel * Math.abs(dw)) / dt < cap) {
        b[0] -= dt * Kc * dw;
        b[1] += dt * eta * ratio * Kc * dw;
        A[0][0] += dt * Kc;
        A[0][1] -= dt * Kc * ratio;
        A[1][0] -= dt * eta * ratio * Kc;
        A[1][1] += dt * eta * ratio * ratio * Kc;
        this.clutchSlip = 0;
      } else {
        // slipping at full capacity (it cannot sync this step, so the sign of dw cannot flip: no chatter)
        const Tc = cap * Math.sign(dw);
        this.clutchSlip = Math.min(1, Math.abs(dw) / Math.max(this.engineOmega, 1));
        b[0] -= dt * Tc;
        b[1] += dt * eta * ratio * Tc;
      }
    } else this.clutchSlip = 1;
    // gearbox drag when the clutch is open keeps the free DOF well-conditioned
    A[1][1] += 1e-3;
    solve(A, b, m);
    for (let k = 0; k < m; k++) q[k] += b[k];
    this.engineOmega = Math.min(Math.max(q[0], (e.idleRpm * 0.5 * Math.PI) / 30), (e.limiterRpm * 1.25 * Math.PI) / 30);
    for (let i = 0; i < 4; i++) {
      let om = 0;
      for (let k = 1; k < m; k++) om += J[i][k] * q[k];
      W[i].omega = om;
    }
  }

  private bodyContacts(): void {
    let total = 0;
    const kB = 160000, cB = 14000;
    for (let i = 0; i < this.bodyPoints.length; i++) {
      const P = tmpA.copy(this.bodyPoints[i]).applyMatrix3(this.R).add(this.pos);
      const h = this.groundTop(P.x, P.z);
      const pen = h - P.y;
      this.bodyContact[i] = pen > 0;
      if (pen <= 0) continue;
      const e = 0.25;
      const gx = (this.groundTop(P.x + e, P.z) - this.groundTop(P.x - e, P.z)) / (2 * e);
      const gz = (this.groundTop(P.x, P.z + e) - this.groundTop(P.x, P.z - e)) / (2 * e);
      const n = tmpB.set(-gx, 1, -gz).normalize();
      const r = tmpV.copy(P).sub(this.pos);
      const v = tmpV2.copy(this.angVel).cross(r).add(this.vel);
      const vn = v.dot(n);
      const Fn = Math.max(0, kB * Math.min(pen, 0.3) - cB * vn);
      total += Fn;
      const vt = v.addScaledVector(n, -vn);
      const vtl = vt.length();
      const loose = this.ground.looseAt(P.x, P.z);
      const mu = 0.45 + 0.25 * loose; // sliding a belly through sand ploughs it
      const F = tmpV3.copy(n).multiplyScalar(Fn);
      if (vtl > 1e-4) F.addScaledVector(vt, (-mu * Fn) / Math.max(vtl, 0.25));
      this.applyForce(F, tmpC.copy(P));
    }
    this.bodyContactLoad = total;
  }

  /** True when the vehicle is beached: belly carrying load, wheels dug in, not moving. */
  get beached(): boolean {
    const dug = this.wheels.filter((w) => w.sink.stuck || w.sink.dug > 0.2).length;
    return Math.abs(this.speed) < 0.7 && (this.bodyContactLoad > this.mass * G * 0.15 || dug >= 2);
  }

  /** Air pressure for all tyres (psi, clamped to 8-40). */
  setPressure(psi: number): void {
    const p = Math.min(40, Math.max(8, psi));
    for (const w of this.wheels) w.pressurePsi = p;
  }
}

const tmpM4 = new Matrix4();
const tmpT = new Vector3();
const tmpC = new Vector3();
const tmpR = new Matrix3();
const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpQ = new Quaternion();
const CV0 = [0, 0];
const CV1 = [0, 0];
const JM: number[][] = [0, 1, 2, 3].map(() => new Array(6).fill(0));
const AM: number[][] = [0, 1, 2, 3, 4, 5].map(() => new Array(6).fill(0));
const BV: number[] = new Array(6).fill(0);
const QV: number[] = new Array(6).fill(0);

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(Math.max(t, 0), 1);
}
function smooth(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Gaussian elimination with partial pivoting; solves A x = b in place (x returned in b). */
export function solve(A: number[][], b: number[], n: number): void {
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (p !== c) {
      const t = A[p]; A[p] = A[c]; A[c] = t;
      const tb = b[p]; b[p] = b[c]; b[c] = tb;
    }
    const d = A[c][c];
    if (Math.abs(d) < 1e-12) continue;
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / d;
      if (!f) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  for (let c = n - 1; c >= 0; c--) {
    let s = b[c];
    for (let k = c + 1; k < n; k++) s -= A[c][k] * b[k];
    b[c] = Math.abs(A[c][c]) < 1e-12 ? 0 : s / A[c][c];
  }
}
