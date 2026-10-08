// When the update checker runs on its own (docs/PRD.md UPD-1): every N hours, and at start if the interval
// passed while the app was closed. The decisions are pure functions; `UpdateScheduler` adds the timer.

const HOUR_MS = 3_600_000;

/** Longest sleep between two looks at the clock: settings change and laptops suspend, and timers do not notice. */
export const MAX_SLEEP_MS = 10 * 60_000;
/** Never spin: even when a run is overdue the next look is at least this far away. */
const MIN_SLEEP_MS = 1000;

/** `intervalHours` of 0 is off. A check that never ran is due (the scheduler seeds the clock at the first start). */
export function isDue(lastRunAt: number | null, intervalHours: number, now: number): boolean {
  if (intervalHours <= 0) return false;
  return lastRunAt === null || now - lastRunAt >= intervalHours * HOUR_MS;
}

/** How long until the next run is due (0 if it is overdue), or null when the schedule is off. */
export function msUntilDue(lastRunAt: number | null, intervalHours: number, now: number): number | null {
  if (intervalHours <= 0) return null;
  if (lastRunAt === null) return 0;
  return Math.max(0, lastRunAt + intervalHours * HOUR_MS - now);
}

export interface SchedulerDeps {
  now(): number;
  intervalHours(): number;
  lastRunAt(): number | null;
  saveLastRunAt(at: number): void;
  isOnline(): boolean;
  /** NET-7: the check waits while offline and runs when the connection is back. */
  onOnlineChange(listener: (online: boolean) => void): () => void;
  run(): Promise<unknown>;
  onError?(error: unknown): void;
  /** Timers are injectable for tests; the defaults are `setTimeout` (unref'd, so they never hold the app open). */
  setTimer?(callback: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

export class UpdateScheduler {
  private timer: unknown;
  private unsubscribe: (() => void) | undefined;
  private started = false;
  private running = false;

  constructor(private readonly deps: SchedulerDeps) {}

  /**
   * Runs now if a run is due (catch-up after the app was closed), then keeps watching the clock. The very first
   * start has nothing to catch up on: it only starts the clock, so a fresh install does not check at once.
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.deps.lastRunAt() === null) this.deps.saveLastRunAt(this.deps.now());
    this.unsubscribe = this.deps.onOnlineChange((online) => {
      if (online) void this.tick();
    });
    void this.tick();
  }

  stop(): void {
    this.started = false;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.disarm();
  }

  /** Looks at the settings again (the interval changed). */
  reschedule(): void {
    if (this.started && !this.running) void this.tick();
  }

  private async tick(): Promise<void> {
    if (!this.started || this.running) return;
    this.disarm();
    const { deps } = this;
    if (isDue(deps.lastRunAt(), deps.intervalHours(), deps.now()) && deps.isOnline()) {
      this.running = true;
      try {
        await deps.run();
      } catch (error) {
        deps.onError?.(error);
      } finally {
        // Also after a failure: a broken run must not be retried in a loop.
        deps.saveLastRunAt(deps.now());
        this.running = false;
      }
    }
    if (this.started) this.arm();
  }

  private arm(): void {
    const wait = msUntilDue(this.deps.lastRunAt(), this.deps.intervalHours(), this.deps.now());
    // Off, or due but offline: look again later; coming back online wakes it sooner.
    const delay = wait === null || wait === 0 ? MAX_SLEEP_MS : Math.min(Math.max(wait, MIN_SLEEP_MS), MAX_SLEEP_MS);
    const handle = (this.deps.setTimer ?? defaultSetTimer)(() => void this.tick(), delay);
    this.timer = handle;
  }

  private disarm(): void {
    if (this.timer !== undefined) (this.deps.clearTimer ?? defaultClearTimer)(this.timer);
    this.timer = undefined;
  }
}

function defaultSetTimer(callback: () => void, ms: number): unknown {
  const timer = setTimeout(callback, ms);
  timer.unref();
  return timer;
}

function defaultClearTimer(handle: unknown): void {
  clearTimeout(handle as ReturnType<typeof setTimeout>);
}
