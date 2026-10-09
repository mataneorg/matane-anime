import { z } from 'zod';
import { ANIME_STATUSES, LIBRARY_SORTS } from './library';

// How the lists look and what narrows them. Kept in the app settings (one key each, saved as JSON), so a view
// survives a restart. Every field falls back on its own (`.catch`): an old or edited value never resets the rest.

export const LIBRARY_DISPLAYS = ['comfortable', 'compact', 'cover', 'list'] as const;
export type LibraryDisplay = (typeof LIBRARY_DISPLAYS)[number];

/** Cover width in CSS px for the grid displays. */
export const COVER_SIZE = { min: 100, max: 280, step: 10, default: 160 } as const;

const display = z.enum(LIBRARY_DISPLAYS).catch('comfortable');
const coverSize = z.number().int().min(COVER_SIZE.min).max(COVER_SIZE.max).catch(COVER_SIZE.default);

/** The library page: display, sort and the filters (the category tab and the search text are not kept). */
export const librarySettingsSchema = z.object({
  display,
  coverSize,
  sort: z.enum(LIBRARY_SORTS).catch('lastWatched'),
  /** Every sort field has a natural direction (A–Z, newest first); this reverses it. */
  descending: z.boolean().catch(false),
  unwatchedOnly: z.boolean().catch(false),
  startedOnly: z.boolean().catch(false),
  downloadedOnly: z.boolean().catch(false),
  /** Any of these statuses; empty means every status. */
  status: z.array(z.enum(ANIME_STATUSES)).max(ANIME_STATUSES.length).catch([]),
  /** Any of these sources; empty means every source. */
  sourceIds: z.array(z.string().max(200)).max(200).catch([]),
});
export type LibrarySettings = z.infer<typeof librarySettingsSchema>;

export const DEFAULT_LIBRARY_SETTINGS: LibrarySettings = {
  display: 'comfortable',
  coverSize: COVER_SIZE.default,
  sort: 'lastWatched',
  descending: false,
  unwatchedOnly: false,
  startedOnly: false,
  downloadedOnly: false,
  status: [],
  sourceIds: [],
};

export const EPISODE_SORTS = ['newest', 'oldest'] as const;
export type EpisodeSortOrder = (typeof EPISODE_SORTS)[number];

/** How one anime's episode list is sorted and narrowed; remembered per anime (null = the default view). */
export const episodeViewSchema = z.object({
  sort: z.enum(EPISODE_SORTS).catch('newest'),
  unwatchedOnly: z.boolean().catch(false),
  downloadedOnly: z.boolean().catch(false),
});
export type EpisodeView = z.infer<typeof episodeViewSchema>;

export const DEFAULT_EPISODE_VIEW: EpisodeView = { sort: 'newest', unwatchedOnly: false, downloadedOnly: false };

/** A source's list in Browse: the same display choices as the library, kept apart. */
export const browseSettingsSchema = z.object({ display, coverSize });
export type BrowseSettings = z.infer<typeof browseSettingsSchema>;

export const DEFAULT_BROWSE_SETTINGS: BrowseSettings = { display: 'comfortable', coverSize: COVER_SIZE.default };

/** Global search: which sources it asks, and whether sources without a result are hidden. */
export const globalSearchSettingsSchema = z.object({
  /** Null means every source that can be searched. */
  sourceIds: z.array(z.string().max(200)).max(200).nullable().catch(null),
  onlyWithResults: z.boolean().catch(false),
});
export type GlobalSearchSettings = z.infer<typeof globalSearchSettingsSchema>;

export const DEFAULT_GLOBAL_SEARCH_SETTINGS: GlobalSearchSettings = { sourceIds: null, onlyWithResults: false };
