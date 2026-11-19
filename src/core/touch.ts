// On-screen touch controls for phones and tablets (DOM). Multi-touch via pointer events:
//   left: floating steering stick (analog) · right: gas, brake/reverse, handbrake pedals
//   top: menu, camera, reset, 4x4 mode, tyre psi -/+ · bottom: winch, reel in, recovery car, dig
//   drag anywhere else on the screen: orbit the camera.
// Buttons feed Input.virt (analog) or Input.hold(code) (virtual keys), so the game logic is unchanged.
import type { Input } from './input';
import { TOUCH_CFG } from './settings';
import { t } from './i18n';

interface Btn { cls: string; label: string; code?: string; pedal?: 'throttle' | 'brake' | 'handbrake'; tip?: string }

const TOP: Btn[] = [
  { cls: 'tb', label: '☰', code: 'KeyB', tip: 'touch.menu' },
  { cls: 'tb', label: '🎥', code: 'KeyC', tip: 'touch.camera' },
  { cls: 'tb', label: '↺', code: 'KeyR', tip: 'touch.reset' },
  { cls: 'tb wide', label: '4×4', code: 'TouchMode', tip: 'touch.mode' },
  { cls: 'tb wide', label: 'psi−', code: 'BracketLeft', tip: 'touch.psiDown' },
  { cls: 'tb wide', label: 'psi+', code: 'BracketRight', tip: 'touch.psiUp' },
];
const REC: Btn[] = [
  { cls: 'tb', label: '⚓', code: 'KeyH', tip: 'touch.winch' },
  { cls: 'tb', label: '⤒', code: 'KeyJ', tip: 'touch.reel' },
  { cls: 'tb', label: '🚙', code: 'KeyT', tip: 'touch.tow' },
  { cls: 'tb', label: '⛏', code: 'KeyG', tip: 'touch.dig' },
];
const PEDALS: Btn[] = [
  { cls: 'pedal hb', label: 'HB', pedal: 'handbrake', tip: 'touch.handbrake' },
  { cls: 'pedal brake', label: '▼', pedal: 'brake', tip: 'touch.brake' },
  { cls: 'pedal gas', label: '▲', pedal: 'throttle', tip: 'touch.gas' },
];

export class TouchControls {
  readonly root: HTMLDivElement;
  private stick: HTMLDivElement;
  private knob: HTMLDivElement;
  private stickId = -1;
  private stickX = 0;
  private lookId = -1;
  private lookX = 0;
  private lookY = 0;

  constructor(private input: Input, canvas: HTMLElement, parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'touch';
    const row = (cls: string, list: Btn[]) => `<div class="${cls}">${list.map((b) => `<button class="${b.cls}" ${b.code ? `data-code="${b.code}"` : ''} ${b.pedal ? `data-pedal="${b.pedal}"` : ''} data-tip="${b.tip ?? ''}">${b.label}</button>`).join('')}</div>`;
    this.root.innerHTML = `<div class="zone"><div class="base"><div class="knob"></div></div></div>` + row('top', TOP) + row('rec', REC) + row('pedals', PEDALS);
    parent.appendChild(this.root);
    this.stick = this.root.querySelector('.zone') as HTMLDivElement;
    this.knob = this.root.querySelector('.knob') as HTMLDivElement;
    this.relabel();

    for (const b of this.root.querySelectorAll<HTMLButtonElement>('button')) this.bindButton(b);
    this.bindStick();
    this.bindLook(canvas);
  }

  /** tooltips/aria labels follow the UI language */
  relabel(): void {
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('button')) {
      if (!b.dataset.tip) continue;
      b.title = t(b.dataset.tip);
      b.setAttribute('aria-label', b.title);
    }
  }

  private bindButton(b: HTMLButtonElement): void {
    let id = -1;
    const set = (on: boolean) => {
      b.classList.toggle('down', on);
      const v = this.input.virt;
      if (b.dataset.pedal) v[b.dataset.pedal as 'throttle'] = on ? 1 : 0;
      if (b.dataset.code) this.input.hold(b.dataset.code, on);
      if (on && navigator.vibrate) navigator.vibrate(8);
    };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      id = e.pointerId;
      capture(b, e.pointerId);
      set(true);
    });
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1;
      set(false);
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private bindStick(): void {
    const z = this.stick;
    const base = z.querySelector('.base') as HTMLDivElement;
    const R = TOUCH_CFG.stickRadius;
    const move = (e: PointerEvent) => {
      const dx = Math.max(-R, Math.min(R, e.clientX - this.stickX));
      const v = this.input.virt;
      const n = dx / R;
      v.steer = Math.sign(n) * Math.pow(Math.abs(n), TOUCH_CFG.steerExponent);
      this.knob.style.transform = `translate(${dx}px, 0)`;
    };
    z.addEventListener('pointerdown', (e) => {
      if (this.stickId >= 0) return;
      e.preventDefault();
      this.stickId = e.pointerId;
      capture(z, e.pointerId);
      // floating stick: centre it under the finger
      const r = z.getBoundingClientRect();
      this.stickX = e.clientX;
      base.style.left = `${e.clientX - r.left}px`;
      base.style.top = `${e.clientY - r.top}px`;
      base.classList.add('active');
      this.input.virt.steering = true;
      move(e);
    });
    z.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) move(e);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = -1;
      const v = this.input.virt;
      v.steer = 0;
      v.steering = false;
      this.knob.style.transform = '';
      base.classList.remove('active');
      base.style.left = base.style.top = '';
    };
    z.addEventListener('pointerup', end);
    z.addEventListener('pointercancel', end);
    z.addEventListener('lostpointercapture', end);
  }

  private bindLook(canvas: HTMLElement): void {
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || this.lookId >= 0) return;
      this.lookId = e.pointerId;
      this.lookX = e.clientX;
      this.lookY = e.clientY;
      capture(canvas, e.pointerId);
      this.input.touchDrag = true;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      const g = TOUCH_CFG.lookGain;
      this.input.look((e.clientX - this.lookX) * g, (e.clientY - this.lookY) * g);
      this.lookX = e.clientX;
      this.lookY = e.clientY;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.lookId) return;
      this.lookId = -1;
      this.input.touchDrag = false;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('lostpointercapture', end);
  }

  /** release everything (e.g. when the controls are hidden mid-press) */
  reset(): void {
    const v = this.input.virt;
    v.throttle = v.brake = v.handbrake = v.steer = 0;
    v.steering = false;
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('button.down')) {
      b.classList.remove('down');
      if (b.dataset.code) this.input.hold(b.dataset.code, false);
    }
    this.input.touchDrag = false;
    this.lookId = this.stickId = -1;
  }
}

/** keep receiving a finger's moves/up even if it slides off the element (no-op if the pointer is already gone) */
function capture(el: HTMLElement, id: number): void {
  try {
    el.setPointerCapture(id);
  } catch {
    /* pointer already released */
  }
}
