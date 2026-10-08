export type PoolOutcome<R> = { status: 'ok'; value: R } | { status: 'error'; error: unknown } | { status: 'skipped' };

export interface PoolOptions {
  concurrency?: number;
  /** Once aborted, nothing new starts. Work in flight gets the same signal and decides for itself. */
  signal?: AbortSignal;
}

/** The update checker looks at this many anime at once (docs/PRD.md UPD-2). */
export const UPDATE_CONCURRENCY = 3;

/**
 * Runs `worker` over `items`, a few at a time, in order. A worker that throws is recorded and the others carry
 * on; items that never started because the signal aborted come back as `skipped`. The result lines up with
 * `items`.
 */
export async function runPool<T, R>(
  items: readonly T[],
  worker: (item: T, index: number, signal: AbortSignal | undefined) => Promise<R>,
  { concurrency = UPDATE_CONCURRENCY, signal }: PoolOptions = {},
): Promise<PoolOutcome<R>[]> {
  const outcomes: PoolOutcome<R>[] = items.map(() => ({ status: 'skipped' }));
  let next = 0;
  const lane = async (): Promise<void> => {
    while (!signal?.aborted && next < items.length) {
      const index = next++;
      try {
        outcomes[index] = { status: 'ok', value: await worker(items[index] as T, index, signal) };
      } catch (error) {
        outcomes[index] = { status: 'error', error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, lane));
  return outcomes;
}
