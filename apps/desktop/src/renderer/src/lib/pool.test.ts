import { describe, expect, it } from 'vitest';
import { dayKey, dayLabel, formatClock } from './dates';
import { runPool } from './pool';

describe('runPool', () => {
  it('never runs more than the limit at once, and runs everything', async () => {
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5 * (n % 3)));
      running--;
      done.push(n);
    });
    expect(peak).toBe(3);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('starts the next item as soon as one finishes', async () => {
    const order: string[] = [];
    await runPool(['slow', 'fast', 'next'], 2, async (name) => {
      order.push(`start ${name}`);
      await new Promise((resolve) => setTimeout(resolve, name === 'slow' ? 30 : 1));
      order.push(`end ${name}`);
    });
    expect(order.indexOf('start next')).toBeLessThan(order.indexOf('end slow'));
  });

  it('keeps going when a worker throws, and stops starting after an abort', async () => {
    const seen: number[] = [];
    await runPool([1, 2, 3], 1, async (n) => {
      seen.push(n);
      if (n === 1) throw new Error('boom');
    });
    expect(seen).toEqual([1, 2, 3]);

    const controller = new AbortController();
    const started: number[] = [];
    await runPool(
      [1, 2, 3, 4],
      1,
      async (n) => {
        started.push(n);
        if (n === 2) controller.abort();
      },
      controller.signal,
    );
    expect(started).toEqual([1, 2]);
  });

  it('handles an empty list', async () => {
    await expect(runPool([], 5, async () => undefined)).resolves.toBeUndefined();
  });
});

describe('history day labels', () => {
  const now = new Date(2026, 9, 8, 15, 0).getTime(); // Thursday 8 Oct 2026
  const at = (day: number, hour = 12) => new Date(2026, 9, day, hour).getTime();

  it('says Today and Yesterday, then the weekday, then the date', () => {
    expect(dayLabel(at(8, 9), now, 'en')).toBe('Today');
    expect(dayLabel(at(7, 23), now, 'en')).toBe('Yesterday');
    expect(dayLabel(at(5), now, 'en')).toBe('Monday');
    expect(dayLabel(at(1), now, 'en')).toMatch(/Oct 1, 2026/);
  });

  it('follows the language', () => {
    expect(dayLabel(at(8), now, 'id').toLowerCase()).toBe('hari ini');
    expect(dayLabel(at(7), now, 'id').toLowerCase()).toBe('kemarin');
  });

  it('groups by local day', () => {
    expect(dayKey(at(8, 1))).toBe(dayKey(at(8, 23)));
    expect(dayKey(at(8))).not.toBe(dayKey(at(7)));
  });
});

describe('formatClock', () => {
  it('formats minutes and hours', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(763_000)).toBe('12:43');
    expect(formatClock(3_723_000)).toBe('1:02:03');
    expect(formatClock(-5)).toBe('0:00');
  });
});
