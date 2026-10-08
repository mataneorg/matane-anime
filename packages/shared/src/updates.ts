import { z } from 'zod';
import { downloadStatusSchema } from './downloads';

// New episodes and the update checker (docs/PRD.md §6.8, UPD-1…9).

/** An episode that showed up after its anime was added to the library (UPD-4), not watched yet. */
export const updateEntrySchema = z.object({
  episodeId: z.number().int(),
  animeId: z.number().int(),
  sourceId: z.string(),
  sourceName: z.string().nullable(),
  animeTitle: z.string(),
  thumbnailUrl: z.string().nullable(),
  hasLocalCover: z.boolean(),
  episodeNumber: z.number().nullable(),
  episodeName: z.string(),
  variant: z.string().nullable(),
  /** When the app first saw the episode; the list is grouped by this day. */
  fetchedAt: z.number(),
  download: z.object({ status: downloadStatusSchema }).nullable(),
});
export type UpdateEntry = z.infer<typeof updateEntrySchema>;

export const updateFailureSchema = z.object({
  animeId: z.number().int(),
  title: z.string(),
  sourceName: z.string().nullable(),
  error: z.string(),
});
export type UpdateFailure = z.infer<typeof updateFailureSchema>;

export const updatesListSchema = z.object({
  entries: z.array(updateEntrySchema),
  /** The newest finished check of any anime; null if none ran yet. */
  lastCheckedAt: z.number().nullable(),
  /** Anime the last check could not reach (UPD-2). */
  failed: z.array(updateFailureSchema),
});
export type UpdatesList = z.infer<typeof updatesListSchema>;

/** Which anime a manual check covers. Only `all` and `category` apply the skip rules (UPD-3). */
export const updateScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('category'), categoryId: z.number().int() }),
  z.object({ kind: z.literal('anime'), animeId: z.number().int() }),
]);
export type UpdateScope = z.infer<typeof updateScopeSchema>;

export const updateCheckResultSchema = z.object({
  checked: z.number().int(),
  skipped: z.number().int(),
  newEpisodes: z.number().int(),
  failed: z.number().int(),
});
export type UpdateCheckResult = z.infer<typeof updateCheckResultSchema>;

/** Progress of a running check, for the "Check now" button and the title bar. */
export const updateStatusSchema = z.object({
  checking: z.boolean(),
  done: z.number().int(),
  total: z.number().int(),
});
export type UpdateStatus = z.infer<typeof updateStatusSchema>;

/** An episode counts as new for this long after the app first saw it. */
export const UPDATE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
