import type { LibraryQuery, LibrarySettings } from '@matane-anime/shared';

export { ANIME_STATUSES as STATUSES } from '@matane-anime/shared';

/** What narrows the library besides the category and the search text; saved with the library settings. */
export type LibraryFilters = Pick<
  LibrarySettings,
  'unwatchedOnly' | 'startedOnly' | 'downloadedOnly' | 'status' | 'sourceIds'
>;

export const NO_FILTERS: LibraryFilters = {
  unwatchedOnly: false,
  startedOnly: false,
  downloadedOnly: false,
  status: [],
  sourceIds: [],
};

/** The filters part of the library settings. */
export const filtersOf = (settings: LibraryFilters): LibraryFilters => ({
  unwatchedOnly: settings.unwatchedOnly,
  startedOnly: settings.startedOnly,
  downloadedOnly: settings.downloadedOnly,
  status: settings.status,
  sourceIds: settings.sourceIds,
});

/**
 * The filters without sources that are gone (an extension removed since the filter was set), which would match
 * nothing and could not be unticked. `known` null means the source list has not loaded yet: nothing is dropped.
 */
export function pruneSources(filters: LibraryFilters, known: ReadonlySet<string> | null): LibraryFilters {
  if (known === null) return filters;
  const sourceIds = filters.sourceIds.filter((id) => known.has(id));
  return sourceIds.length === filters.sourceIds.length ? filters : { ...filters, sourceIds };
}

/** How many filters are on (each chosen status and source counts). */
export function filterCount(filters: LibraryFilters): number {
  return (
    Number(filters.unwatchedOnly) +
    Number(filters.startedOnly) +
    Number(filters.downloadedOnly) +
    filters.status.length +
    filters.sourceIds.length
  );
}

/** Only what the user switched on is sent: the query is also the cache key. */
export function filtersQueryPart(filters: LibraryFilters): Partial<LibraryQuery> {
  return {
    ...(filters.unwatchedOnly && { unwatchedOnly: true }),
    ...(filters.startedOnly && { startedOnly: true }),
    ...(filters.downloadedOnly && { downloadedOnly: true }),
    ...(filters.status.length > 0 && { status: filters.status }),
    ...(filters.sourceIds.length > 0 && { sourceIds: filters.sourceIds }),
  };
}

/** `list` with `value` out if it is in, in at the end if not. */
export function toggleIn<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}
