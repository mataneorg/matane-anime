import { describe, expect, it, vi } from 'vitest';
import { createPrefetcher } from './prefetch';

/** A refresh that ends when the test says so. */
function controlled() {
  const pending: { id: number; resolve(): void; reject(): void }[] = [];
  const refresh = vi.fn(
    (id: number) =>
      new Promise<void>((resolve, reject) => {
        pending.push({ id, resolve, reject: () => reject(new Error('down')) });
      }),
  );
  return { refresh, pending };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createPrefetcher', () => {
  it('fetches an anime once, however often it is asked', () => {
    const { refresh } = controlled();
    const prefetcher = createPrefetcher(refresh);
    expect(prefetcher.request(1)).toBe(true);
    expect(prefetcher.request(1)).toBe(false);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('runs at most `max` at a time and lets the next in when one ends', async () => {
    const { refresh, pending } = controlled();
    const prefetcher = createPrefetcher(refresh, 2);
    expect(prefetcher.request(1)).toBe(true);
    expect(prefetcher.request(2)).toBe(true);
    expect(prefetcher.request(3)).toBe(false);
    pending[0]?.resolve();
    await settle();
    expect(prefetcher.request(3)).toBe(true);
  });

  it('does not count a skipped anime as fetched: a later hover may start it', async () => {
    const { refresh, pending } = controlled();
    const prefetcher = createPrefetcher(refresh, 1);
    prefetcher.request(1);
    expect(prefetcher.request(2)).toBe(false);
    pending[0]?.resolve();
    await settle();
    expect(prefetcher.request(2)).toBe(true);
  });

  it('lets a failed anime try again, and keeps a finished one done', async () => {
    const { refresh, pending } = controlled();
    const prefetcher = createPrefetcher(refresh);
    prefetcher.request(1);
    prefetcher.request(2);
    pending[0]?.reject();
    pending[1]?.resolve();
    await settle();
    expect(prefetcher.request(1)).toBe(true);
    expect(prefetcher.request(2)).toBe(false);
  });
});
