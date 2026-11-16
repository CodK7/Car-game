// Keyboard + gamepad input mapped to abstract driving controls.
export interface Controls {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (left) .. +1 (right)
  handbrake: number;
  clutch: number; // 0..1 (1 = pedal down), manual gearbox only
}

export class Input {
  readonly keys = new Set<string>();
  private pressed = new Set<string>();
  private padPrev: boolean[] = [];
  private padPressed = new Set<number>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  dragging = false;
  padConnected = false;
  private steerKb = 0;

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    target.addEventListener('mousedown', (e) => {
      if (e.button === 0 || e.button === 2) this.dragging = true;
    });
    window.addEventListener('mouseup', () => (this.dragging = false));
    window.addEventListener('mousemove', (e) => {
      if (this.dragging) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    target.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }
  /** True once per key press (edge). */
  hit(code: string): boolean {
    return this.pressed.has(code);
  }
  /** True once per gamepad button press (standard mapping index). */
  padHit(button: number): boolean {
    return this.padPressed.has(button);
  }

  private pad(): Gamepad | null {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected && p.mapping === 'standard') return p;
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** Poll devices; call once per frame before reading controls. */
  poll(): void {
    const p = this.pad();
    this.padConnected = !!p;
    this.padPressed.clear();
    if (p) {
      p.buttons.forEach((b, i) => {
        if (b.pressed && !this.padPrev[i]) this.padPressed.add(i);
        this.padPrev[i] = b.pressed;
      });
    }
  }

  controls(dt: number, speed: number, out: Controls): Controls {
    const k = this.keys;
    let throttle = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    let brake = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    const target = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    // keyboard steering: rate-limited and speed-sensitive so it feels analog
    const rate = target === 0 ? 3.2 : 1.6 + 2.4 / (1 + Math.abs(speed) * 0.08);
    const d = target - this.steerKb;
    this.steerKb += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    let steer = this.steerKb;
    let handbrake = k.has('Space') ? 1 : 0;
    let clutch = k.has('ShiftLeft') ? 1 : 0;
    const p = this.pad();
    if (p) {
      const dz = (v: number) => (Math.abs(v) < 0.08 ? 0 : (v - Math.sign(v) * 0.08) / 0.92);
      const sx = dz(p.axes[0] ?? 0);
      if (Math.abs(sx) > Math.abs(steer)) steer = Math.sign(sx) * sx * sx;
      throttle = Math.max(throttle, p.buttons[7]?.value ?? 0); // RT (analog)
      brake = Math.max(brake, p.buttons[6]?.value ?? 0); // LT (analog)
      handbrake = Math.max(handbrake, p.buttons[0]?.pressed ? 1 : 0); // A
      clutch = Math.max(clutch, p.buttons[4]?.pressed ? 1 : 0); // LB
    }
    out.throttle = throttle;
    out.brake = brake;
    out.steer = steer;
    out.handbrake = handbrake;
    out.clutch = clutch;
    return out;
  }

  /** Right stick for camera orbit (returns [x, y]). */
  padLook(): [number, number] {
    const p = this.pad();
    if (!p) return [0, 0];
    const dz = (v: number) => (Math.abs(v) < 0.12 ? 0 : v);
    return [dz(p.axes[2] ?? 0), dz(p.axes[3] ?? 0)];
  }

  endFrame(): void {
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
