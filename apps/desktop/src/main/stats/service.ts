import type { StatsOverview, StatsRange } from '@matane-anime/shared';
import type Database from 'better-sqlite3';

const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_GENRES = 5;
const TOP_ANIME = 5;

/** Local midnight of the day `ms` falls in. */
export function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function startOfMonth(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

function addDays(ms: number, days: number): number {
  const date = new Date(ms);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

function addMonths(ms: number, months: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth() + months, 1).getTime();
}

/** The local day ("2026-10-1") of a time, for streaks. */
const dayKey = (ms: number): string => {
  const date = new Date(ms);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
};

/**
 * Consecutive watching days ending today, or yesterday when nothing was watched yet today (the streak is still
 * alive), and the longest run.
 */
export function streaks(days: Set<string>, now: number): { current: number; best: number } {
  let current = 0;
  let cursor = startOfDay(now);
  if (!days.has(dayKey(cursor))) cursor = addDays(cursor, -1);
  while (days.has(dayKey(cursor))) {
    current++;
    cursor = addDays(cursor, -1);
  }
  const sorted = [...days]
    .map((key) => {
      const [y, m, d] = key.split('-').map(Number);
      return new Date(y!, m! - 1, d!).getTime();
    })
    .sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let previous: number | null = null;
  for (const day of sorted) {
    run = previous !== null && addDays(previous, 1) === day ? run + 1 : 1;
    best = Math.max(best, run);
    previous = day;
  }
  return { current, best };
}

interface SessionRow {
  animeId: number;
  startedAt: number;
  activeMs: number;
}

interface WatchedRow {
  animeId: number;
  watchedAt: number;
}

interface AnimeRow {
  id: number;
  title: string;
  studio: string | null;
  genresJson: string;
  sourceId: string;
  thumbnailUrl: string | null;
  hasLocalCover: number;
}

const genresOf = (row: AnimeRow | undefined): string[] => {
  try {
    const parsed: unknown = JSON.parse(row?.genresJson ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((g): g is string => typeof g === 'string') : [];
  } catch {
    return [];
  }
};

/**
 * Watching statistics, from `watch_sessions` (time) and the episodes finished in the player (watched, with a
 * session). The sessions survive clearing the history. Queries are bounded by the indexed `started_at`; the rest
 * is counted here.
 */
export class StatsService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly now: () => number = Date.now,
  ) {}

  overview(range: StatsRange): StatsOverview {
    const now = this.now();
    const today = startOfDay(now);
    const from =
      range === 'week'
        ? addDays(today, -6)
        : range === 'month'
          ? addDays(today, -29)
          : range === 'year'
            ? addMonths(startOfMonth(now), -11)
            : null;

    const sessions = this.sqlite
      .prepare(
        `SELECT anime_id AS animeId, started_at AS startedAt, active_ms AS activeMs FROM watch_sessions
         WHERE started_at >= ? AND started_at <= ? AND active_ms > 0`,
      )
      .all(from ?? 0, now) as SessionRow[];
    const watched = this.sqlite
      .prepare(
        `SELECT e.anime_id AS animeId, e.watched_at AS watchedAt FROM episodes e
         WHERE e.watched = 1 AND e.watched_at IS NOT NULL AND e.watched_at >= ? AND e.watched_at <= ?
           AND EXISTS (SELECT 1 FROM watch_sessions w WHERE w.episode_id = e.id)`,
      )
      .all(from ?? 0, now) as WatchedRow[];

    // Buckets: days for a week or a month, months for a year or everything.
    const unit = range === 'week' || range === 'month' ? 'day' : 'month';
    // All time starts at the month of the first session (a loop: there can be many rows).
    let earliest = now;
    for (const session of sessions) earliest = Math.min(earliest, session.startedAt);
    for (const row of watched) earliest = Math.min(earliest, row.watchedAt);
    const first = from ?? startOfMonth(earliest);
    const starts: number[] = [];
    for (let start = first; start <= now; start = unit === 'day' ? addDays(start, 1) : addMonths(start, 1)) {
      starts.push(start);
    }
    const series = starts.map((start) => ({ start, episodes: 0, ms: 0 }));
    const index = new Map(starts.map((start, i) => [start, i]));
    const bucketOf = (ms: number) => series[index.get(unit === 'day' ? startOfDay(ms) : startOfMonth(ms)) ?? -1];
    for (const session of sessions) {
      const bucket = bucketOf(session.startedAt);
      if (bucket) bucket.ms += session.activeMs;
    }
    for (const row of watched) {
      const bucket = bucketOf(row.watchedAt);
      if (bucket) bucket.episodes++;
    }

    // Per anime: time and episodes; then genres and sources from the anime rows.
    const perAnime = new Map<number, { ms: number; episodes: number }>();
    const of = (id: number) => {
      let entry = perAnime.get(id);
      if (!entry) perAnime.set(id, (entry = { ms: 0, episodes: 0 }));
      return entry;
    };
    for (const session of sessions) of(session.animeId).ms += session.activeMs;
    for (const row of watched) of(row.animeId).episodes++;
    const ids = [...perAnime.keys()];
    const rows = new Map<number, AnimeRow>();
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const found = this.sqlite
        .prepare(
          `SELECT id, title, studio, genres_json AS genresJson, source_id AS sourceId, thumbnail_url AS thumbnailUrl,
                  cover_path IS NOT NULL AS hasLocalCover
           FROM anime WHERE id IN (${chunk.map(() => '?').join(',')})`,
        )
        .all(...chunk) as AnimeRow[];
      for (const row of found) rows.set(row.id, row);
    }

    const genreCounts = new Map<string, number>();
    const sourceCounts = new Map<string, number>();
    for (const [id, entry] of perAnime) {
      if (entry.episodes === 0) continue;
      const row = rows.get(id);
      for (const genre of genresOf(row)) genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + entry.episodes);
      if (row) sourceCounts.set(row.sourceId, (sourceCounts.get(row.sourceId) ?? 0) + entry.episodes);
    }
    const genres = [...genreCounts]
      .map(([name, episodes]) => ({ name, episodes }))
      .sort((a, b) => b.episodes - a.episodes || a.name.localeCompare(b.name));
    const sourceNames = new Map(
      (this.sqlite.prepare('SELECT id, name FROM sources').all() as { id: string; name: string }[]).map((s) => [
        s.id,
        s.name,
      ]),
    );

    const topAnime = [...perAnime]
      .filter(([id]) => rows.has(id))
      .sort(([, a], [, b]) => b.ms - a.ms || b.episodes - a.episodes)
      .slice(0, TOP_ANIME)
      .map(([id, entry]) => {
        const row = rows.get(id)!;
        return {
          animeId: id,
          title: row.title,
          sourceId: row.sourceId,
          thumbnailUrl: row.thumbnailUrl,
          hasLocalCover: row.hasLocalCover === 1,
          studio: row.studio,
          genres: genresOf(row).slice(0, 2),
          episodes: entry.episodes,
          ms: entry.ms,
        };
      });

    const library = this.sqlite
      .prepare(
        `SELECT count(*) AS total,
                coalesce(sum(EXISTS (SELECT 1 FROM history h WHERE h.anime_id = a.id)
                         AND EXISTS (SELECT 1 FROM episodes e WHERE e.anime_id = a.id AND e.watched = 0)), 0) AS watching
         FROM anime a WHERE a.in_library = 1`,
      )
      .get() as { total: number; watching: number };
    // One row per day with watching (grouped by SQLite), not one per session: a long history stays cheap.
    const allDays = new Set(
      (
        this.sqlite
          .prepare(
            `SELECT DISTINCT strftime('%Y-%m-%d', started_at / 1000, 'unixepoch', 'localtime') AS day
             FROM watch_sessions WHERE active_ms > 0 AND started_at <= ?`,
          )
          .all(now) as { day: string }[]
      ).map((row) => {
        const [y, m, d] = row.day.split('-').map(Number);
        return `${y}-${m}-${d}`;
      }),
    );
    const hasData = this.sqlite
      .prepare('SELECT EXISTS (SELECT 1 FROM watch_sessions WHERE active_ms > 0 AND started_at <= ?) AS has')
      .get(now) as {
      has: number;
    };

    return {
      range,
      from,
      days: Math.max(1, Math.round((startOfDay(now) - startOfDay(first)) / DAY_MS) + 1),
      hasData: hasData.has === 1,
      episodesWatched: watched.length,
      watchMs: sessions.reduce((sum, s) => sum + s.activeMs, 0),
      library,
      streak: streaks(allDays, now),
      unit,
      series,
      genres: genres.slice(0, TOP_GENRES),
      otherGenreEpisodes: genres.slice(TOP_GENRES).reduce((sum, g) => sum + g.episodes, 0),
      topAnime,
      sources: [...sourceCounts]
        .map(([sourceId, episodes]) => ({ sourceId, name: sourceNames.get(sourceId) ?? sourceId, episodes }))
        .sort((a, b) => b.episodes - a.episodes),
    };
  }

  /**
   * Forgets every watch session (Settings → Data). Progress, watched marks and history stay.
   *
   * Side effect: sessions are also what keeps an episode row from being dropped when the source stops listing it, what
   * keeps a browsed (not library) anime from being purged, and what makes the update checker treat an anime as
   * "started" (`hasSession`). Those anime then fall back on their history and watched marks alone.
   */
  clear(): void {
    this.sqlite.prepare('DELETE FROM watch_sessions').run();
  }
}
