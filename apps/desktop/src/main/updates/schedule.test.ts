import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_SLEEP_MS, type SchedulerDeps, UpdateScheduler, isDue, msUntilDue } from './schedule';

const HOUR = 3_600_000;

describe('isDue / msUntilDue', () => {
  it('is due once the interval has passed', () => {
    expect(isDue(0, 12, 12 * HOUR - 1)).toBe(false);
    expect(isDue(0, 12, 12 * HOUR)).toBe(true);
    expect(isDue(0, 12, 40 * HOUR)).toBe(true);
    expect(msUntilDue(0, 12, 5 * HOUR)).toBe(7 * HOUR);
    expect(msUntilDue(0, 12, 20 * HOUR)).toBe(0);
  });

  it.each([6, 12, 24, 48, 168])('knows the %i hour interval', (hours) => {
    expect(isDue(1000, hours, 1000 + hours * HOUR - 1)).toBe(false);
    expect(isDue(1000, hours, 1000 + hours * HOUR)).toBe(true);
  });

  it('is never due when off, and a check that never ran is due', () => {
    expect(isDue(0, 0, 1e15)).toBe(false);
    expect(msUntilDue(0, 0, 1e15)).toBeNull();
    expect(isDue(null, 12, 5)).toBe(true);
    expect(msUntilDue(null, 12, 5)).toBe(0);
  });
});

/** A clock and a timer under the test's control. */
class Harness {
  now = 100 * HOUR;
  interval = 12;
  last: number | null = 100 * HOUR - 1 * HOUR;
  online = true;
  runs = 0;
  runError: Error | null = null;
  timers: { id: number; at: number; callback: () => void }[] = [];
  listeners = new Set<(online: boolean) => void>();
  private nextId = 1;
  errors: unknown[] = [];

  deps: SchedulerDeps = {
    now: () => this.now,
    intervalHours: () => this.interval,
    lastRunAt: () => this.last,
    saveLastRunAt: (at) => void (this.last = at),
    isOnline: () => this.online,
    onOnlineChange: (listener) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    },
    run: async () => {
      this.runs++;
      if (this.runError) throw this.runError;
    },
    onError: (error) => void this.errors.push(error),
    setTimer: (callback, ms) => {
      const timer = { id: this.nextId++, at: this.now + ms, callback };
      this.timers.push(timer);
      return timer.id;
    },
    clearTimer: (id) => void (this.timers = this.timers.filter((timer) => timer.id !== id)),
  };
  scheduler = new UpdateScheduler(this.deps);

  /** Moves the clock and fires the timers that came due. */
  async advance(ms: number): Promise<void> {
    this.now += ms;
    for (const timer of this.timers.filter((t) => t.at <= this.now)) {
      this.timers = this.timers.filter((t) => t !== timer);
      timer.callback();
    }
    await settle();
  }

  async goOnline(online: boolean): Promise<void> {
    this.online = online;
    for (const listener of this.listeners) listener(online);
    await settle();
  }
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};

let h: Harness;
beforeEach(() => {
  h = new Harness();
});

describe('UpdateScheduler', () => {
  it('does not run at start when the interval has not passed, and runs when it does', async () => {
    h.scheduler.start();
    await settle();
    expect(h.runs).toBe(0);
    await h.advance(10 * HOUR);
    expect(h.runs).toBe(0);
    await h.advance(1 * HOUR + MAX_SLEEP_MS);
    expect(h.runs).toBe(1);
    expect(h.last).toBe(h.now);
  });

  it('catches up at start when the app was closed past the interval', async () => {
    h.last = h.now - 30 * HOUR;
    h.scheduler.start();
    await settle();
    expect(h.runs).toBe(1);
    expect(h.last).toBe(h.now);
  });

  it('only starts the clock at the very first start', async () => {
    h.last = null;
    h.scheduler.start();
    await settle();
    expect(h.runs).toBe(0);
    expect(h.last).toBe(h.now);
  });

  it('re-arms after a run and runs again one interval later', async () => {
    h.last = h.now - 13 * HOUR;
    h.scheduler.start();
    await settle();
    expect(h.runs).toBe(1);
    expect(h.timers).toHaveLength(1);
    await h.advance(11 * HOUR);
    expect(h.runs).toBe(1);
    await h.advance(1 * HOUR + MAX_SLEEP_MS);
    expect(h.runs).toBe(2);
  });

  it('never runs when the schedule is off, and picks it up when the interval is set', async () => {
    h.interval = 0;
    h.last = h.now - 1000 * HOUR;
    h.scheduler.start();
    await h.advance(500 * HOUR);
    expect(h.runs).toBe(0);
    h.interval = 6;
    h.scheduler.reschedule();
    await settle();
    expect(h.runs).toBe(1);
  });

  it('waits while offline and runs when the connection is back', async () => {
    h.online = false;
    h.last = h.now - 30 * HOUR;
    h.scheduler.start();
    await settle();
    await h.advance(5 * HOUR);
    expect(h.runs).toBe(0);
    await h.goOnline(true);
    expect(h.runs).toBe(1);
    // Going offline and back again right after does not run it twice.
    await h.goOnline(false);
    await h.goOnline(true);
    expect(h.runs).toBe(1);
  });

  it('survives a failing run without retrying in a loop', async () => {
    h.runError = new Error('boom');
    h.last = h.now - 30 * HOUR;
    h.scheduler.start();
    await settle();
    expect(h.runs).toBe(1);
    expect(h.errors).toHaveLength(1);
    expect(h.last).toBe(h.now);
    await h.advance(MAX_SLEEP_MS);
    expect(h.runs).toBe(1);
  });

  it('stops: no timer, no listener, no more runs', async () => {
    h.scheduler.start();
    await settle();
    h.scheduler.stop();
    expect(h.timers).toHaveLength(0);
    expect(h.listeners.size).toBe(0);
    await h.advance(100 * HOUR);
    expect(h.runs).toBe(0);
  });

  it('does not start a run while one is in progress', async () => {
    let finish = (): void => undefined;
    h.deps.run = () => {
      h.runs++;
      return new Promise<void>((resolve) => (finish = resolve));
    };
    h.last = h.now - 30 * HOUR;
    h.scheduler.start();
    await settle();
    await h.goOnline(true);
    h.scheduler.reschedule();
    await settle();
    expect(h.runs).toBe(1);
    finish();
    await settle();
  });
});
