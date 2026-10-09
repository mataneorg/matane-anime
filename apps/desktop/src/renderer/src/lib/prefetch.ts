/**
 * Fetches an anime's details and episodes ahead of the click, when the pointer rests on its card. Opening an
 * anime for the first time otherwise waits for two requests to the site (BRW-6); done ahead, the page opens full.
 *
 * It is careful with the site: at most `max` at a time, each anime once per session (a failure may try again),
 * and the caller only asks after the pointer has rested a moment, so moving across a grid fetches nothing.
 */
export function createPrefetcher(refresh: (animeId: number) => Promise<unknown>, max = 2) {
  const started = new Set<number>();
  let running = 0;
  return {
    /** Starts the fetch unless it already ran, is running, or the limit is reached. Returns whether it started. */
    request(animeId: number): boolean {
      if (started.has(animeId) || running >= max) return false;
      started.add(animeId);
      running++;
      void refresh(animeId)
        .catch(() => started.delete(animeId))
        .finally(() => running--);
      return true;
    },
  };
}
