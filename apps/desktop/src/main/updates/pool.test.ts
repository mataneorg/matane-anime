import { describe, expect, it } from 'vitest';
import { runPool } from './pool';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A worker that stays busy until the test releases it. */
function gate() {
  const waiting: (() => void)[] = [];
  let active = 0;
  let peak = 0;
  const started: number[] = [];
  return {
    started,
    get peak() {
      return peak;
    },
    worker: async (item: number) => {
      started.push(item);
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => waiting.push(resolve));
      active--;
      return item * 2;
    },
    release: () => waiting.shift()?.(),
    get waiting() {
      return waiting.length;
    },
  };
}

describe('runPool', () => {
  it('runs three at a time by default and keeps the order of the results', async () => {
    const g = gate();
    const run = runPool([1, 2, 3, 4, 5], g.worker);
    await tick();
    expect(g.started).toEqual([1, 2, 3]);
    g.release();
    await tick();
    expect(g.started).toEqual([1, 2, 3, 4]);
    while (g.waiting > 0) {
      g.release();
      await tick();
    }
    const outcomes = await run;
    expect(g.peak).toBe(3);
    expect(outcomes).toEqual([2, 4, 6, 8, 10].map((value) => ({ status: 'ok', value })));
  });

  it('honours another concurrency, and handles an empty list', async () => {
    const g = gate();
    const run = runPool([1, 2, 3], g.worker, { concurrency: 1 });
    await tick();
    expect(g.started).toEqual([1]);
    while (g.waiting > 0 || g.started.length < 3) {
      g.release();
      await tick();
    }
    await run;
    expect(g.peak).toBe(1);
    await expect(runPool([], g.worker)).resolves.toEqual([]);
  });

  it('records a failure and carries on with the rest', async () => {
    const outcomes = await runPool([1, 2, 3, 4], async (item) => {
      if (item === 2) throw new Error('boom');
      return item;
    });
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['ok', 'error', 'ok', 'ok']);
    expect(outcomes[1]).toMatchObject({ error: { message: 'boom' } });
  });

  it('stops starting new work once the signal aborts, and leaves those items skipped', async () => {
    const controller = new AbortController();
    const g = gate();
    const run = runPool([1, 2, 3, 4, 5, 6], g.worker, { signal: controller.signal });
    await tick();
    controller.abort();
    while (g.waiting > 0) {
      g.release();
      await tick();
    }
    const outcomes = await run;
    expect(g.started).toEqual([1, 2, 3]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['ok', 'ok', 'ok', 'skipped', 'skipped', 'skipped']);
  });

  it('gives the signal to the workers so they can stop what is in flight', async () => {
    const controller = new AbortController();
    const run = runPool(
      [1, 2],
      (_item, _index, signal) =>
        new Promise<number>((_resolve, reject) =>
          signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
        ),
      { signal: controller.signal },
    );
    await tick();
    controller.abort();
    const outcomes = await run;
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['error', 'error']);
  });
});
