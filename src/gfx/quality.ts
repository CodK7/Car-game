// Quality presets (data in src/config/quality.json) + automatic selection by measured FPS.
import presets from '../config/quality.json';
import { P, QualityName } from '../core/params';

export type Quality = typeof presets.low;
export type PresetName = 'low' | 'medium' | 'high';
const ORDER: PresetName[] = ['low', 'medium', 'high'];

export class QualityManager {
  name: PresetName;
  auto: boolean;
  q: Quality;
  onChange: ((q: Quality, name: PresetName) => void) | null = null;
  private acc = 0;
  private frames = 0;
  private goodWindows = 0;
  private downs = 0;

  constructor(requested: QualityName = P.quality) {
    this.auto = requested === 'auto';
    // Auto starts on Low (the integrated-GPU floor) and only climbs when there is clear headroom.
    this.name = requested === "auto" ? "low" : requested;
    this.q = { ...presets[this.name] };
    if (P.scale) this.q.renderScale = P.scale;
  }

  set(name: PresetName): void {
    if (name === this.name) return;
    this.name = name;
    this.q = { ...presets[name] };
    if (P.scale) this.q.renderScale = P.scale;
    this.onChange?.(this.q, name);
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
