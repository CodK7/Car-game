// Frame-time statistics (performance.now based) for the ?debug overlay and the ?bench runs.
export class Perf {
  private buf = new Float32Array(600);
  private n = 0;
  private i = 0;
  private benchTimes: number[] | null = null;

  frame(dtMs: number): void {
    this.buf[this.i] = dtMs;
    this.i = (this.i + 1) % this.buf.length;
    if (this.n < this.buf.length) this.n++;
    this.benchTimes?.push(dtMs);
  }

  static summarize(times: ArrayLike<number>): { fps: number; avgMs: number; p50Ms: number; p99Ms: number; low1Fps: number; frames: number } {
    const a = Array.from(times).sort((x, y) => x - y);
    const n = a.length;
    if (!n) return { fps: 0, avgMs: 0, p50Ms: 0, p99Ms: 0, low1Fps: 0, frames: 0 };
    const sum = a.reduce((s, v) => s + v, 0);
    const worst = a.slice(Math.floor(n * 0.99));
    const worstAvg = worst.reduce((s, v) => s + v, 0) / worst.length;
    const r = (v: number) => Math.round(v * 100) / 100;
    return { fps: r((1000 * n) / sum), avgMs: r(sum / n), p50Ms: r(a[n >> 1]), p99Ms: r(a[Math.floor(n * 0.99)]), low1Fps: r(1000 / worstAvg), frames: n };
  }

  recent(): ReturnType<typeof Perf.summarize> {
    return Perf.summarize(this.buf.subarray(0, this.n));
  }
  startBench(): void {
    this.benchTimes = [];
  }
  endBench(): ReturnType<typeof Perf.summarize> {
    const r = Perf.summarize(this.benchTimes ?? []);
    this.benchTimes = null;
    return r;
  }
}
