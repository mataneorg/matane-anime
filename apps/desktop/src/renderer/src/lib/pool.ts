/**
 * Runs `worker` over `items` with at most `limit` running at once, starting the next as soon as one ends
 * (docs/PRD.md BRW-2: at most five sources at a time). Stops starting new ones once `signal` aborts. A worker
 * that throws does not stop the others: it is the worker's job to report its own failure.
 */
export async function runPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length && !signal?.aborted) {
      const item = items[next++] as T;
      try {
        await worker(item);
      } catch {
        // Reported by the worker itself.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}
