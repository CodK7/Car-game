// Maps player input to the vehicle: pedals/steer, automatic reverse, manual shifting, drive modes, lockers, tyre
// pressure. Key bindings (also shown in the HUD help):
//   W/S throttle/brake (S at standstill = reverse in auto), A/D steer, Space handbrake, Shift clutch
//   E/Q shift up/down (manual), M auto/manual, 1/2/3 = 2H/4H/4L, L rear locker, K front locker
//   [ / ] tyre pressure -/+ 2 psi, C camera, R reset to road/upright
import type { Input, Controls } from '../core/input';
import type { VehicleSim } from '../vehicle/vehicleSim';
import { t } from '../core/i18n';
import drift from '../config/drift.json';

export class DriveController {
  private c: Controls = { throttle: 0, brake: 0, steer: 0, handbrake: 0, clutch: 0 };
  private stopT = 0;
  autoDrive = false;
  /** automatic counter-steer while sliding (settings: Drift assist) */
  driftAssist = true;
  messages: string[] = [];

  update(dt: number, input: Input, v: VehicleSim): void {
    const c = input.controls(dt, v.speed, this.c);
    if (this.autoDrive) c.throttle = Math.max(c.throttle, 1);
    const sp = v.speed;
    // automatic gearbox: S at standstill selects reverse, W selects drive
    if (v.autoGearbox) {
      if (v.gear > 0 && c.brake > 0.3 && c.throttle < 0.05 && sp < 0.4) {
        this.stopT += dt;
        if (this.stopT > 0.35) {
          v.gear = -1;
          this.stopT = 0;
        }
      } else if (v.gear < 0 && c.throttle > 0.3 && c.brake < 0.05 && sp > -0.4) {
        this.stopT += dt;
        if (this.stopT > 0.2) {
          v.gear = 1;
          this.stopT = 0;
        }
      } else this.stopT = 0;
      if (v.gear < 0) {
        // in reverse the pedals swap: S drives backwards, W brakes
        const t = c.throttle;
        c.throttle = c.brake;
        c.brake = t;
      }
      if (v.gear === 0) v.gear = 1;
    } else {
      if (input.hit('KeyE')) v.gear = Math.min(v.spec.gearbox.ratios.length, v.gear + 1);
      if (input.hit('KeyQ')) v.gear = Math.max(-1, v.gear - 1);
      if (input.padHit(5)) v.gear = Math.min(v.spec.gearbox.ratios.length, v.gear + 1); // RB
      if (input.padHit(2)) v.gear = Math.max(-1, v.gear - 1); // X
    }
    if (input.hit('KeyM')) this.say((v.autoGearbox = !v.autoGearbox) ? t('ctl.auto') : t('ctl.manual'));
    if (input.hit('Digit1')) this.setMode(v, '2H');
    if (input.hit('Digit2')) this.setMode(v, '4H');
    if (input.hit('Digit3') || input.padHit(3)) this.setMode(v, v.mode === '4L' ? '4H' : '4L');
    if (input.hit('TouchMode')) {
      // on-screen 4x4 button: next available mode (2H → 4H → 4L → 2H)
      const modes = v.spec.driveline.modes ?? ['2H', '4H', '4L'];
      this.setMode(v, modes[(modes.indexOf(v.mode) + 1) % modes.length] as '2H' | '4H' | '4L');
    }
    if (input.hit('KeyL')) {
      v.rearLock = !v.rearLock && v.spec.driveline.rearLocker;
      this.say(v.spec.driveline.rearLocker ? t('ctl.rearLock', t(v.rearLock ? 'ctl.on' : 'ctl.off')) : t('ctl.noRear'));
    }
    if (input.hit('KeyK')) {
      v.frontLock = !v.frontLock && v.spec.driveline.frontLocker;
      this.say(v.spec.driveline.frontLocker ? t('ctl.frontLock', t(v.frontLock ? 'ctl.on' : 'ctl.off')) + (v.frontLock && v.mode === '2H' ? t('ctl.needs4') : '') : t('ctl.noFront'));
    }
    if (input.hit('BracketLeft') || input.padHit(14)) this.pressure(v, -2);
    if (input.hit('BracketRight') || input.padHit(15)) this.pressure(v, 2);
    if (this.driftAssist) this.assist(v, c, dt);
    v.input.throttle = c.throttle;
    v.input.brake = c.brake;
    v.input.steer = c.steer;
    v.input.handbrake = c.handbrake;
    v.input.clutch = c.clutch;
  }

  private prevBeta = 0;

  /**
   * Drift assist, what a drifter's hands and right foot do:
   *  - steer: counter-steer toward the direction of travel by the body slip angle beta, plus a damping term on
   *    d(beta)/dt so the car is caught before it snaps into a spin; scaled down while the player steers hard so
   *    they keep control of the angle.
   *  - throttle: past maxAngleDeg the throttle is eased off so the rear stops overspinning (keyboard players
   *    cannot feather a binary W key).
   * Modifies c.steer / c.throttle in place.
   */
  assist(v: VehicleSim, c: { steer: number; throttle: number }, dt: number): void {
    const A = drift.assist;
    const rad = Math.PI / 180;
    const vLong = v.vel.dot(v.fwd), vLat = v.vel.dot(v.right);
    if (Math.hypot(vLong, vLat) < A.minSpeed || vLong < 0) {
      this.prevBeta = 0;
      return;
    }
    const beta = Math.atan2(vLat, vLong); // + = sliding toward the right
    const dBeta = dt > 0 ? Math.max(-3, Math.min(3, (beta - this.prevBeta) / dt)) : 0;
    this.prevBeta = beta;
    const dead = A.deadbandDeg * rad;
    if (Math.abs(beta) < dead) return;
    const maxSteer = v.spec.steer.maxDeg * rad * (1 - v.spec.steer.speedReduce * Math.min(1, Math.abs(v.speed) / 33));
    const want = (Math.sign(beta) * (Math.abs(beta) - dead) + A.rateGain * dBeta) / Math.max(maxSteer, 0.05);
    const k = A.gain * (1 - A.fadeWithInput * Math.abs(c.steer));
    c.steer = Math.max(-1, Math.min(1, c.steer + want * k));
    const over = (Math.abs(beta) - A.maxAngleDeg * rad) / (A.throttleFadeDeg * rad);
    if (over > 0) c.throttle *= Math.max(A.minThrottle, 1 - over);
  }

  private setMode(v: VehicleSim, m: '2H' | '4H' | '4L'): void {
    const modes = v.spec.driveline.modes ?? ['2H', '4H', '4L'];
    if (!modes.includes(m)) {
      this.say(t('ctl.noMode', m));
      return;
    }
    if (m === '4L' && Math.abs(v.speed) > 3) {
      this.say(t('ctl.stop4L'));
      return;
    }
    v.mode = m;
    this.say(t('ctl.mode', m));
  }

  private pressure(v: VehicleSim, d: number): void {
    const p = v.wheels[0].pressurePsi + d;
    v.setPressure(p);
    this.say(t('ctl.tyres', v.wheels[0].pressurePsi.toFixed(0)));
  }

  say(m: string): void {
    this.messages.push(m);
  }
}
