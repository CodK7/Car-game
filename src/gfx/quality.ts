// Quality presets (data in src/config/quality.json) + automatic selection by measured FPS.
import presets from '../config/quality.json';
import { P, QualityName } from '../core/params';

export type Quality = typeof presets.low;
export type PresetName = 'low' | 'medium' | 'high' | 'ultra' | 'legendary';
/** presets Auto may step through; Ultra and Legendary are manual only (powerful GPUs) */
const ORDER: PresetName[] = ['low', 'medium', 'high'];
export const PRESET_NAMES: PresetName[] = ['low', 'medium', 'high', 'ultra', 'legendary'];

export class QualityManager {
  name: PresetName;
  auto: boolean;
  q: Quality;
  onChange: ((q: Quality, name: PresetName) => void) | null = null;
  private acc = 0;
  private frames = 0;
  private goodWindows = 0;
  private downs = 0;

  constructor(requested: QualityName = P.quality, scaleOverride = 0) {
    this.auto = requested === 'auto';
    // Auto starts on Low (the integrated-GPU floor) and only climbs when there is clear headroom.
    this.name = requested === "auto" ? "low" : requested;
    this.q = { ...presets[this.name] };
    this.scaleOverride = scaleOverride;
    this.applyScale();
  }

  set(name: PresetName): void {
    if (name === this.name) return;
    this.name = name;
    this.q = { ...presets[name] };
    this.applyScale();
    this.onChange?.(this.q, name);
  }

  /** Settings: resolution override (0 = preset's renderScale). The ?scale URL parameter wins. */
  scaleOverride = 0;
  setScale(s: number): void {
    this.scaleOverride = s;
    this.applyScale();
  }
  private applyScale(): void {
    this.q.renderScale = P.scale || this.scaleOverride || presets[this.name].renderScale;
  }

  /** Settings: 'auto' keeps the current preset and lets frame() step it; a preset name fixes it. */
  setMode(m: QualityName): void {
    this.auto = m === 'auto';
    this.goodWindows = 0;
    this.downs = 0;
    this.acc = 0;
    this.frames = 0;
    if (m !== 'auto') this.set(m);
    else if (!ORDER.includes(this.name)) this.set('high'); // Auto never runs Ultra/Legendary
  }

  /** Feed frame times; in Auto mode steps the preset down/up with hysteresis. */
  frame(dt: number): void {
    if (!this.auto) return;
    this.acc += dt;
    this.frames++;
    const a = presets.auto;
    if (this.acc < a.windowSeconds) return;
    const fps = this.frames / this.acc;
    this.acc = 0;
    this.frames = 0;
    const i = ORDER.indexOf(this.name);
    if (fps < a.downBelowFps && i > 0) {
      this.downs++;
      this.goodWindows = 0;
      this.set(ORDER[i - 1]);
    } else if (fps > a.upAboveFps && i < ORDER.length - 1 && this.downs < 2) {
      if (++this.goodWindows >= 2) {
        this.goodWindows = 0;
        this.set(ORDER[i + 1]);
      }
    } else this.goodWindows = 0;
  }
}
