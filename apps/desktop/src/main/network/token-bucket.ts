/**
 * A token bucket: `perSecond` requests may start per second, with a burst of the same size (docs/PRD.md
 * NET-2). `take()` resolves when the request may go. Time is injectable for tests.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;
  private queue: Promise<void> = Promise.resolve();
  private readonly perSecond: number;
  private readonly burst: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    perSecond: number,
    options: { burst?: number; now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
  ) {
    if (!(perSecond > 0)) throw new RangeError('perSecond must be positive');
    this.perSecond = perSecond;
    this.burst = Math.max(1, options.burst ?? perSecond);
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.tokens = this.burst;
    this.last = this.now();
  }

  /** Waiters are served in the order they asked. */
  take(): Promise<void> {
    const turn = this.queue.then(() => this.acquire());
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  private async acquire(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await this.sleep(Math.ceil(((1 - this.tokens) / this.perSecond) * 1000));
    }
  }

  private refill(): void {
    const now = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
  }
}
