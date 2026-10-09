import type { LibraryQuery } from '@matane-anime/shared';
import { queryOptions } from '@tanstack/react-query';
import { call } from './api';
import { localQueryDefaults } from './query';

// Library, categories, "continue" and history: data main owns, refreshed by `db.changed` tags
// (`library`, `categories`, `history`, `episodes:<id>`; see `invalidateForTags`).

export const libraryQuery = (query: LibraryQuery) =>
  queryOptions({
    queryKey: ['library', 'list', query],
    queryFn: () => call('library.list', query),
    ...localQueryDefaults,
  });

export const libraryCountQuery = queryOptions({
  queryKey: ['library', 'count'],
  queryFn: () => call('library.count'),
  ...localQueryDefaults,
});

/** How many anime sit in no category: the number on the Default tab. */
export const uncategorizedCountQuery = queryOptions({
  queryKey: ['library', 'uncategorized-count'],
  queryFn: () => call('library.uncategorizedCount'),
  ...localQueryDefaults,
});

export const categoriesQuery = queryOptions({
  queryKey: ['categories'],
  queryFn: () => call('categories.list'),
  ...localQueryDefaults,
});

export const continueQuery = (animeId: number) =>
  queryOptions({
    queryKey: ['continue', animeId],
    queryFn: () => call('watch.continueTarget', { animeId }),
    ...localQueryDefaults,
  });

export const historyQuery = queryOptions({
  queryKey: ['history'],
  queryFn: () => call('history.list'),
  ...localQueryDefaults,
});

/** `anime://cover/library/<id>` for a saved cover (LIB-7); the caller falls back to the source's image. */
export const localCoverSrc = (animeId: number): string => `anime://cover/library/${animeId}`;
