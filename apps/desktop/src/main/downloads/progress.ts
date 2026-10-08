/** Download speed over a moving window, and the time left at that speed. */
export class SpeedMeter {
  private samples: { at: number; bytes: number }[] = [];

  constructor(private readonly windowMs = 5000) {}

  /** `bytes` is the running total; call whenever it grows. */
  sample(at: number, bytes: number): void {
    this.samples.push({ at, bytes });
    const cutoff = at - this.windowMs;
    while (this.samples.length > 2 && (this.samples[1] as { at: number }).at <= cutoff) this.samples.shift();
  }

  /** Bytes per second; 0 when nothing arrived within the window. */
  bytesPerSecond(now: number): number {
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (!first || !last || last === first || now - last.at > this.windowMs) return 0;
    const seconds = (last.at - first.at) / 1000;
    return seconds > 0 ? (last.bytes - first.bytes) / seconds : 0;
  }

  /** Seconds left; null when the speed or the amount left is unknown. */
  etaSeconds(now: number, remainingBytes: number | null): number | null {
    const speed = this.bytesPerSecond(now);
    return remainingBytes === null || speed <= 0 ? null : Math.ceil(remainingBytes / speed);
  }

  reset(): void {
    this.samples = [];
  }
}
