import type { BrowseInput } from '@matane-anime/shared';
import { type QueryClient, infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { call } from './api';
import { localQueryDefaults } from './query';

// Query keys and options for extensions, sources, anime and episodes. Local data (what main stored) never
// goes stale by itself: `db.changed` invalidates it by tag. Remote data (what an extension fetched) keeps
// TanStack Query's retry and a short staleness window.

export const extensionsQuery = queryOptions({
  queryKey: ['extensions'],
  queryFn: () => call('extensions.list'),
  ...localQueryDefaults,
});

export const sourcesQuery = queryOptions({
  queryKey: ['sources'],
  queryFn: () => call('sources.list'),
  ...localQueryDefaults,
});

export const reposQuery = queryOptions({
  queryKey: ['repos'],
  queryFn: () => call('repos.list'),
  ...localQueryDefaults,
});

/** What the repositories offer (already narrowed by the 18+ and language settings in main). */
export const availableQuery = queryOptions({
  queryKey: ['available'],
  queryFn: () => call('extensions.available'),
  ...localQueryDefaults,
});

export const networkStatusQuery = queryOptions({
  queryKey: ['network', 'status'],
  queryFn: () => call('network.getStatus'),
  ...localQueryDefaults,
});

export const extensionLogsQuery = (extensionId?: string) =>
  queryOptions({
    queryKey: ['extension-logs', extensionId ?? 'all'],
    queryFn: () => call('extensions.logs', { extensionId }),
    ...localQueryDefaults,
  });

export const preferencesQuery = (extensionId: string) =>
  queryOptions({
    queryKey: ['extension-preferences', extensionId],
    queryFn: () => call('extensions.preferences', { extensionId }),
    ...localQueryDefaults,
  });

export const capabilitiesQuery = (sourceId: string) =>
  queryOptions({
    queryKey: ['sources', sourceId, 'capabilities'],
    queryFn: () => call('sources.capabilities', { sourceId }),
    staleTime: 5 * 60_000,
    retry: 1,
  });

export const animeQuery = (animeId: number) =>
  queryOptions({
    queryKey: ['anime', animeId],
    queryFn: () => call('anime.get', { animeId }),
    ...localQueryDefaults,
  });

export const episodesQuery = (animeId: number) =>
  queryOptions({
    queryKey: ['episodes', animeId],
    queryFn: () => call('episodes.list', { animeId }),
    ...localQueryDefaults,
  });

/** Tells main to stop waiting for a call when TanStack Query aborts it (a new search, leaving the page). */
function cancelOnAbort(signal: AbortSignal): string {
  const requestId = crypto.randomUUID();
  signal.addEventListener('abort', () => void call('requests.cancel', requestId), { once: true });
  return requestId;
}

export const filtersQuery = (sourceId: string) =>
  queryOptions({
    queryKey: ['sources', sourceId, 'filters'],
    queryFn: ({ signal }) => call('sources.filters', { sourceId, requestId: cancelOnAbort(signal) }),
    staleTime: 10 * 60_000,
    retry: 1,
  });

export interface BrowseParams {
  sourceId: string;
  kind: BrowseInput['kind'];
  query: string;
  filters: Record<string, unknown>;
}

export const browseQuery = (params: BrowseParams, enabled = true) =>
  infiniteQueryOptions({
    queryKey: ['browse', params.sourceId, params.kind, params.query, params.filters],
    queryFn: ({ pageParam, signal }) =>
      call('sources.browse', { ...params, page: pageParam, requestId: cancelOnAbort(signal) }),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (last.hasNextPage ? pages.length + 1 : undefined),
    staleTime: 2 * 60_000,
    enabled,
  });

/**
 * The first page of Popular or Latest as last seen (main keeps it between runs). Browse shows it while the real
 * page loads, so opening a source is not a blank grid. Never retried: it is only a head start.
 */
export const browseCachedQuery = (params: BrowseParams, enabled = true) =>
  queryOptions({
    queryKey: ['browse-cached', params.sourceId, params.kind],
    queryFn: () => call('sources.browseCached', { ...params, page: 1 }),
    staleTime: Infinity,
    retry: false,
    enabled: enabled && params.kind !== 'search',
  });

const UPDATES_DEBOUNCE_MS = 300;
const updatesTimers = new WeakMap<QueryClient, ReturnType<typeof setTimeout>>();

/** A check emits the `updates` tag once per anime: refetch the list and the badge once the burst is over. */
function invalidateUpdates(queryClient: QueryClient): void {
  clearTimeout(updatesTimers.get(queryClient));
  updatesTimers.set(
    queryClient,
    setTimeout(() => void queryClient.invalidateQueries({ queryKey: ['updates'] }), UPDATES_DEBOUNCE_MS),
  );
}

/** What a write in main touched (`db.changed` tags) → which cached queries are now out of date. */
export function invalidateForTags(queryClient: QueryClient, tags: string[]): void {
  for (const tag of tags) {
    if (tag === 'repos') {
      void queryClient.invalidateQueries({ queryKey: ['repos'] });
      void queryClient.invalidateQueries({ queryKey: ['extensions'] });
      void queryClient.invalidateQueries({ queryKey: ['available'] });
      continue;
    }
    if (tag === 'extensions' || tag === 'sources') {
      void queryClient.invalidateQueries({ queryKey: ['extensions'] });
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      void queryClient.invalidateQueries({ queryKey: ['extension-preferences'] });
      void queryClient.invalidateQueries({ queryKey: ['available'] });
      continue;
    }
    if (tag === 'library') {
      void queryClient.invalidateQueries({ queryKey: ['library'] });
      void queryClient.invalidateQueries({ queryKey: ['continue'] });
      continue;
    }
    if (tag === 'categories') {
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
      void queryClient.invalidateQueries({ queryKey: ['library'] });
      continue;
    }
    if (tag === 'downloads') {
      void queryClient.invalidateQueries({ queryKey: ['downloads'] });
      invalidateUpdates(queryClient);
      continue;
    }
    if (tag === 'updates') {
      invalidateUpdates(queryClient);
      continue;
    }
    if (tag === 'history') {
      void queryClient.invalidateQueries({ queryKey: ['history'] });
      void queryClient.invalidateQueries({ queryKey: ['continue'] });
      continue;
    }
    const [kind, id] = tag.split(':');
    if (kind === 'anime' && id) void queryClient.invalidateQueries({ queryKey: ['anime', Number(id)] });
    if (kind === 'episodes' && id) {
      void queryClient.invalidateQueries({ queryKey: ['episodes', Number(id)] });
      void queryClient.invalidateQueries({ queryKey: ['continue', Number(id)] });
      // Watching an episode takes it off the Updates list without an `updates` tag.
      invalidateUpdates(queryClient);
    }
  }
}

/** `anime://cover/<source>/<image>`: main fetches the image through the extension's session. */
export function coverSrc(sourceId: string, imageUrl: string | null): string | null {
  if (!imageUrl) return null;
  const encode = (text: string): string => {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  return `anime://cover/${encode(sourceId)}/${encode(imageUrl)}`;
}
