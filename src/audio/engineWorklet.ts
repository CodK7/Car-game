// AudioWorklet processor wrapping EngineDsp. Parameters arrive as port messages (~60 Hz) and are smoothed per sample
// inside the DSP. An optional processorOptions.script ([[time, params], ...]) drives it from currentTime (offline tests).
import { EngineDsp } from './engineDsp';

declare const sampleRate: number;
declare const currentTime: number;
declare const AudioWorkletProcessor: { new (): { port: MessagePort } };
declare function registerProcessor(name: string, ctor: unknown): void;

class EngineProcessor extends AudioWorkletProcessor {
  private dsp: EngineDsp;
  private script: [number, Record<string, unknown>][] | null;
  private si = 0;
  constructor(opts: { processorOptions: { engine: any; turbo: any; seed: number; params?: any; script?: any } }) {
    super();
    const o = opts.processorOptions;
    this.dsp = new EngineDsp(o.engine, o.turbo, sampleRate, o.seed);
    if (o.params) this.dsp.set(o.params);
    this.script = o.script ?? null;
    this.port.onmessage = (e: MessageEvent) => this.dsp.set(e.data);
  }
  process(_in: Float32Array[][], out: Float32Array[][]): boolean {
    if (this.script) while (this.si < this.script.length && this.script[this.si][0] <= currentTime) this.dsp.set(this.script[this.si++][1] as any);
    const o = out[0];
    this.dsp.process(o[0], o[1] ?? o[0], o[0].length);
    return true;
  }
}
registerProcessor('wahiba-engine', EngineProcessor);
