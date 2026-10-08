import type { Filter, Preference } from '@matane-anime/extension-sdk';
import { z } from 'zod';

// What crosses IPC about extensions, sources, anime and episodes. Extension output is validated in main
// (packages/extension-runtime/src/results.ts) before it is stored; these describe what the renderer gets.

export const extensionSourceSchema = z.object({
  /** `<extensionId>/<key>`. */
  id: z.string(),
  key: z.string(),
  lang: z.string(),
  name: z.string(),
});

export const extensionInfoSchema = z.object({
  /** The manifest id; for a folder that failed to load, the folder path. */
  id: z.string(),
  folder: z.string(),
  /** Phase 1 loads only from folders; repositories come in phase 4. */
  origin: z.literal('dev'),
  status: z.enum(['ready', 'error']),
  error: z.string().nullable(),
  name: z.string(),
  version: z.string().nullable(),
  nsfw: z.boolean(),
  hasPreferences: z.boolean(),
  sources: z.array(extensionSourceSchema),
});
export type ExtensionInfo = z.infer<typeof extensionInfoSchema>;

export const sourceInfoSchema = z.object({
  id: z.string(),
  extensionId: z.string(),
  extensionName: z.string(),
  key: z.string(),
  lang: z.string(),
  name: z.string(),
  nsfw: z.boolean(),
  pinned: z.boolean(),
  lastUsedAt: z.number().nullable(),
  /** The extension is loaded and answering. A source whose extension is gone is listed as not installed. */
  available: z.boolean(),
});
export type SourceInfo = z.infer<typeof sourceInfoSchema>;

export const sourceCapabilitiesSchema = z.object({
  latest: z.boolean(),
  filters: z.boolean(),
  resolveUrl: z.boolean(),
});
export type SourceCapabilities = z.infer<typeof sourceCapabilitiesSchema>;

export const catalogAnimeSchema = z.object({
  animeId: z.number().int(),
  sourceId: z.string(),
  url: z.string(),
  title: z.string(),
  thumbnailUrl: z.string().nullable(),
  inLibrary: z.boolean(),
});
export type CatalogAnime = z.infer<typeof catalogAnimeSchema>;

export const animePageSchema = z.object({
  items: z.array(catalogAnimeSchema),
  hasNextPage: z.boolean(),
});
export type CatalogPage = z.infer<typeof animePageSchema>;

export const browseInputSchema = z.object({
  sourceId: z.string(),
  kind: z.enum(['popular', 'latest', 'search']),
  /** Starts at 1. */
  page: z.number().int().min(1),
  query: z.string().optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  /** Lets the renderer cancel the call (`requests.cancel`). */
  requestId: z.string().optional(),
});
export type BrowseInput = z.infer<typeof browseInputSchema>;

export const filterListSchema = z.custom<Filter[]>((value) => Array.isArray(value));
export const preferenceListSchema = z.custom<Preference[]>((value) => Array.isArray(value));

export const animeDetailSchema = z.object({
  animeId: z.number().int(),
  sourceId: z.string(),
  sourceName: z.string().nullable(),
  url: z.string(),
  title: z.string(),
  altTitles: z.array(z.string()),
  description: z.string().nullable(),
  genres: z.array(z.string()),
  studio: z.string().nullable(),
  year: z.number().nullable(),
  status: z.enum(['ongoing', 'completed', 'hiatus', 'cancelled', 'unknown']),
  type: z.enum(['tv', 'movie', 'ova', 'ona', 'special']).nullable(),
  thumbnailUrl: z.string().nullable(),
  inLibrary: z.boolean(),
  /** The library categories the anime is in. */
  categoryIds: z.array(z.number().int()),
  /** When the details were last fetched from the source; null if only the listing entry is known. */
  detailsFetchedAt: z.number().nullable(),
  webUrl: z.string().nullable(),
});
export type AnimeDetail = z.infer<typeof animeDetailSchema>;

export const episodeSchema = z.object({
  id: z.number().int(),
  animeId: z.number().int(),
  url: z.string(),
  name: z.string(),
  number: z.number().nullable(),
  variant: z.string().nullable(),
  uploadedAt: z.number().nullable(),
  /** Position in the source's list (0 = first, i.e. newest). */
  sourceOrder: z.number().int(),
  watched: z.boolean(),
  positionMs: z.number(),
  durationMs: z.number().nullable(),
  sourceMissing: z.boolean(),
});
export type EpisodeRow = z.infer<typeof episodeSchema>;

export const refreshResultSchema = z.object({ anime: animeDetailSchema, episodes: z.array(episodeSchema) });
export type RefreshResult = z.infer<typeof refreshResultSchema>;

export const preferencesStateSchema = z.object({
  preferences: preferenceListSchema,
  /** The user's values merged over each preference's default. */
  values: z.record(z.string(), z.unknown()),
});
export type PreferencesState = z.infer<typeof preferencesStateSchema>;

export const extensionLogEntrySchema = z.object({
  extensionId: z.string(),
  level: z.enum(['debug', 'info', 'warn', 'error']),
  message: z.string(),
  at: z.number(),
});
export type ExtensionLogEntry = z.infer<typeof extensionLogEntrySchema>;

export const networkStatusSchema = z.object({ online: z.boolean() });
export type NetworkStatus = z.infer<typeof networkStatusSchema>;

export const cloudflareStatusSchema = z.object({
  extensionId: z.string(),
  state: z.enum(['solving', 'visible', 'solved', 'failed']),
  url: z.string(),
});
export type CloudflareStatus = z.infer<typeof cloudflareStatusSchema>;

/** Entity tags that say what a write touched: `sources`, `extensions`, `anime:<id>`, `episodes:<animeId>`. */
export const dbChangedSchema = z.object({ tags: z.array(z.string()) });
export type DbChanged = z.infer<typeof dbChangedSchema>;
