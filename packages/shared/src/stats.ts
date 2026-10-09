import { z } from 'zod';

/** Statistics periods: the last 7 or 30 days, the last 12 months, or everything. */
export const STATS_RANGES = ['week', 'month', 'year', 'all'] as const;
export const statsRangeSchema = z.enum(STATS_RANGES);
export type StatsRange = z.infer<typeof statsRangeSchema>;

/**
 * The statistics page. "Episodes watched" are episodes marked watched that were also opened in a watch session, so
 * marking a whole list watched does not count; incognito never records a session, so it is never counted.
 */
export const statsOverviewSchema = z.object({
  range: statsRangeSchema,
  /** Start of the period (ms), null for all time. */
  from: z.number().nullable(),
  /** Days in the period (for the daily average). */
  days: z.number(),
  /** Any watch time recorded at all (in any period): tells an empty app from an empty period. */
  hasData: z.boolean(),
  episodesWatched: z.number(),
  watchMs: z.number(),
  library: z.object({ total: z.number(), watching: z.number() }),
  /** Consecutive days with watching, up to today (or yesterday), and the longest run ever. */
  streak: z.object({ current: z.number(), best: z.number() }),
  /** Per day (week, month) or per month (year, all), oldest first; `start` is local midnight. */
  unit: z.enum(['day', 'month']),
  series: z.array(z.object({ start: z.number(), episodes: z.number(), ms: z.number() })),
  /** Genres of the episodes watched, most first (top 5), and the episodes in the other genres. */
  genres: z.array(z.object({ name: z.string(), episodes: z.number() })),
  otherGenreEpisodes: z.number(),
  /** Most watched anime by watch time (top 5). */
  topAnime: z.array(
    z.object({
      animeId: z.number(),
      title: z.string(),
      sourceId: z.string(),
      thumbnailUrl: z.string().nullable(),
      hasLocalCover: z.boolean(),
      studio: z.string().nullable(),
      genres: z.array(z.string()),
      episodes: z.number(),
      ms: z.number(),
    }),
  ),
  /** Episodes watched per source, most first. */
  sources: z.array(z.object({ sourceId: z.string(), name: z.string(), episodes: z.number() })),
});
export type StatsOverview = z.infer<typeof statsOverviewSchema>;
