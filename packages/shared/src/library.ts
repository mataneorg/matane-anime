import { z } from 'zod';

// The library, categories, watch progress and history as they cross IPC (docs/PRD.md §6.5, §6.6).

export const LIBRARY_SORTS = ['title', 'lastWatched', 'latestEpisode', 'added', 'unwatched'] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];

export const categorySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  sortOrder: z.number().int(),
  /** Anime of the library in this category. */
  count: z.number().int(),
});
export type Category = z.infer<typeof categorySchema>;

export const continueReasonSchema = z.enum(['resume', 'next', 'first']);

/** What "Continue" would play for an anime, and from where (PRG-6). */
export const continueTargetSchema = z.object({
  episodeId: z.number().int(),
  number: z.number().nullable(),
  name: z.string(),
  reason: continueReasonSchema,
  resumeMs: z.number(),
});
export type ContinueTarget = z.infer<typeof continueTargetSchema>;

export const libraryQuerySchema = z.object({
  /** Absent means "All". */
  category: z.number().int().optional(),
  /** Matches titles and alternative titles (FTS5), by word prefix. */
  search: z.string().optional(),
  sort: z.enum(LIBRARY_SORTS),
  descending: z.boolean().optional(),
  unwatchedOnly: z.boolean().optional(),
  /** Only anime that were started (some episode watched or in progress). */
  startedOnly: z.boolean().optional(),
  status: z.enum(['ongoing', 'completed', 'hiatus', 'cancelled', 'unknown']).optional(),
  sourceId: z.string().optional(),
});
export type LibraryQuery = z.infer<typeof libraryQuerySchema>;

export const libraryItemSchema = z.object({
  animeId: z.number().int(),
  sourceId: z.string(),
  lang: z.string().nullable(),
  title: z.string(),
  thumbnailUrl: z.string().nullable(),
  /** The cover is on disk (LIB-7): `anime://cover/library/<animeId>`. */
  hasLocalCover: z.boolean(),
  categoryIds: z.array(z.number().int()),
  /** Distinct episode numbers, and how many of them are not watched yet (PRG-5). */
  total: z.number().int(),
  unwatched: z.number().int(),
  lastEpisode: z
    .object({
      episodeId: z.number().int(),
      number: z.number().nullable(),
      name: z.string(),
      positionMs: z.number(),
      durationMs: z.number().nullable(),
      watched: z.boolean(),
    })
    .nullable(),
  lastWatchedAt: z.number().nullable(),
  latestEpisodeAt: z.number().nullable(),
  addedAt: z.number().nullable(),
  continue: continueTargetSchema.nullable(),
});
export type LibraryItem = z.infer<typeof libraryItemSchema>;

export const progressReasonSchema = z.enum(['play', 'heartbeat', 'pause', 'seek', 'ended', 'close']);
export type ProgressReason = z.infer<typeof progressReasonSchema>;

export const progressInputSchema = z.object({
  /** Which playback this report belongs to: one watch session per playback. */
  playbackId: z.string(),
  episodeId: z.number().int(),
  positionMs: z.number().min(0),
  durationMs: z.number().min(0).nullable(),
  reason: progressReasonSchema,
});
export type ProgressInput = z.infer<typeof progressInputSchema>;

export const historyEntrySchema = z.object({
  animeId: z.number().int(),
  sourceId: z.string(),
  sourceName: z.string().nullable(),
  title: z.string(),
  thumbnailUrl: z.string().nullable(),
  hasLocalCover: z.boolean(),
  episodeId: z.number().int(),
  episodeNumber: z.number().nullable(),
  episodeName: z.string(),
  positionMs: z.number(),
  durationMs: z.number().nullable(),
  watched: z.boolean(),
  watchedAt: z.number(),
  /** What "Continue" or "Play next" would open from here. */
  next: continueTargetSchema.nullable(),
});
export type HistoryEntry = z.infer<typeof historyEntrySchema>;
