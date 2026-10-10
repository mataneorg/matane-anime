import { AppError, type CatalogAnime, type SourceInfo } from '@matane-anime/shared';
import { useCallback, useEffect, useState } from 'react';
import { call } from '@renderer/lib/api';
import { runPool } from '@renderer/lib/pool';

/** At most this many sources are asked at once (docs/PRD.md BRW-2). */
export const MAX_PARALLEL = 5;

export type SourceResult =
  { status: 'done'; items: CatalogAnime[]; hasNextPage: boolean } | { status: 'error'; error: AppError };

/**
 * Searches many sources for one query: five at a time, results arriving per source as they finish. A new
 * query (or a different set of sources) aborts what is still running, in main too, and results of an older
 * query are never shown. A source with no entry yet is still searching.
 */
export function useGlobalSearch(sources: SourceInfo[], query: string, enabled: boolean) {
  const key = `${query}\u0000${sources.map((source) => source.id).join(',')}`;
  const [store, setStore] = useState<{ key: string; results: Record<string, SourceResult> }>({ key: '', results: {} });

  const searchOne = useCallback(
    async (source: SourceInfo, signal?: AbortSignal): Promise<void> => {
      const requestId = crypto.randomUUID();
      signal?.addEventListener('abort', () => void call('requests.cancel', requestId), { once: true });
      let result: SourceResult;
      try {
        const page = await call('sources.browse', {
          sourceId: source.id,
          kind: 'search',
          page: 1,
          query,
          requestId,
          passive: true,
        });
        result = { status: 'done', items: page.items, hasNextPage: page.hasNextPage };
      } catch (error) {
        if (signal?.aborted) return;
        result = {
          status: 'error',
          error: error instanceof AppError ? error : new AppError('internal', String(error)),
        };
      }
      if (signal?.aborted) return;
      setStore((previous) => ({
        key,
        results: { ...(previous.key === key ? previous.results : {}), [source.id]: result },
      }));
    },
    [query, key],
  );

  useEffect(() => {
    if (!enabled || query === '') return;
    const controller = new AbortController();
    void runPool(sources, MAX_PARALLEL, (source) => searchOne(source, controller.signal), controller.signal);
    return () => controller.abort();
  }, [enabled, query, sources, searchOne]);

  const results = store.key === key ? store.results : {};

  /** Asks one source again (after an error, or after the verification window was closed). */
  const retry = useCallback(
    (source: SourceInfo): void => {
      setStore((previous) => {
        const { [source.id]: _removed, ...rest } = previous.key === key ? previous.results : {};
        return { key, results: rest };
      });
      void searchOne(source);
    },
    [key, searchOne],
  );

  return { results, retry, done: sources.filter((source) => results[source.id]).length };
}
