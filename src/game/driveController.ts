// Maps player input to the vehicle: pedals/steer, automatic reverse, manual shifting, drive modes, lockers, tyre
// pressure. Key bindings (also shown in the HUD help):
//   W/S throttle/brake (S at standstill = reverse in auto), A/D steer, Space handbrake, Shift clutch
//   E/Q shift up/down (manual), M auto/manual, 1/2/3 = 2H/4H/4L, L rear locker, K front locker
//   [ / ] tyre pressure -/+ 2 psi, C camera, R reset to road/upright
import type { Input, Controls } from '../core/input';
import type { VehicleSim } from '../vehicle/vehicleSim';
import { t } from '../core/i18n';

export class DriveController {
  private c: Controls = { throttle: 0, brake: 0, steer: 0, handbrake: 0, clutch: 0 };
  private stopT = 0;
  autoDrive = false;
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
    v.input.throttle = c.throttle;
    v.input.brake = c.brake;
    v.input.steer = c.steer;
    v.input.handbrake = c.handbrake;
    v.input.clutch = c.clutch;
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
