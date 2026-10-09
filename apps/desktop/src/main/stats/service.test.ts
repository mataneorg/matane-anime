import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '../db/__tests__/helpers';
import { StatsService, streaks } from './service';

const HOUR = 3_600_000;
const NOW = new Date(2026, 9, 9, 12).getTime();
const daysAgo = (days: number, hour = 12): number => new Date(2026, 9, 9 - days, hour).getTime();
const dayKey = (days: number): string => {
  const date = new Date(2026, 9, 9 - days);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
};

let db: TestDb;
let service: StatsService;

beforeEach(async () => {
  db = await createTestDb();
  service = new StatsService(db.connection.sqlite, () => NOW);
});
afterEach(() => db.close());

/** An anime with `count` episodes; genres and library membership as given. */
function seed(url: string, title: string, genres: string[], count = 3): { animeId: number; ids: number[] } {
  const [row] = db.anime.upsertSummaries('example/en', [{ url, title }]);
  const animeId = row!.id;
  db.connection.sqlite.prepare('UPDATE anime SET genres_json = ? WHERE id = ?').run(JSON.stringify(genres), animeId);
  db.episodes.sync(
    animeId,
    Array.from({ length: count }, (_, i) => ({
      url: `${url}/${count - i}`,
      name: `Ep ${count - i}`,
      number: count - i,
    })),
    100,
  );
  db.library.add(animeId, [], 100);
  return { animeId, ids: db.episodes.list(animeId).map((e) => e.id) };
}

function session(animeId: number, episodeId: number, startedAt: number, activeMs: number): void {
  db.connection.sqlite
    .prepare(
      'INSERT INTO watch_sessions (anime_id, episode_id, started_at, ended_at, active_ms) VALUES (?, ?, ?, ?, ?)',
    )
    .run(animeId, episodeId, startedAt, startedAt + activeMs, activeMs);
}

function finish(episodeId: number, watchedAt: number): void {
  db.connection.sqlite
    .prepare('UPDATE episodes SET watched = 1, watched_at = ? WHERE id = ?')
    .run(watchedAt, episodeId);
}

describe('streaks', () => {
  it('counts consecutive days ending today, or yesterday when today is still empty', () => {
    expect(streaks(new Set([dayKey(0), dayKey(1), dayKey(2), dayKey(5)]), NOW)).toEqual({ current: 3, best: 3 });
    expect(streaks(new Set([dayKey(1), dayKey(2)]), NOW)).toEqual({ current: 2, best: 2 });
    expect(streaks(new Set([dayKey(3)]), NOW)).toEqual({ current: 0, best: 1 });
  });

  it('keeps the longest run even when it is over', () => {
    expect(streaks(new Set([dayKey(10), dayKey(9), dayKey(8), dayKey(7), dayKey(0)]), NOW)).toEqual({
      current: 1,
      best: 4,
    });
  });
});

describe('StatsService.overview', () => {
  it('is empty without sessions, with a bucket per day of the week', () => {
    const overview = service.overview('week');
    expect(overview.series).toHaveLength(7);
    expect(overview.unit).toBe('day');
    expect(overview).toMatchObject({ episodesWatched: 0, watchMs: 0, topAnime: [], genres: [], sources: [] });
    expect(overview.streak).toEqual({ current: 0, best: 0 });
  });

  it('adds watch time per day and counts finished episodes that were opened in a session', () => {
    const a = seed('/a', 'A', ['Action', 'Drama']);
    session(a.animeId, a.ids[0]!, daysAgo(0), HOUR);
    session(a.animeId, a.ids[1]!, daysAgo(2), 2 * HOUR);
    finish(a.ids[0]!, daysAgo(0));
    // Marked watched from the list, never opened: not counted.
    finish(a.ids[2]!, daysAgo(0));

    const overview = service.overview('week');
    expect(overview.watchMs).toBe(3 * HOUR);
    expect(overview.episodesWatched).toBe(1);
    expect(overview.series.at(-1)).toMatchObject({ episodes: 1, ms: HOUR });
    expect(overview.series.at(-3)).toMatchObject({ episodes: 0, ms: 2 * HOUR });
    expect(overview.streak.best).toBe(1);
  });

  it('keeps out what is older than the range', () => {
    const a = seed('/a', 'A', ['Action']);
    session(a.animeId, a.ids[0]!, daysAgo(10), HOUR);
    finish(a.ids[0]!, daysAgo(10));
    expect(service.overview('week').watchMs).toBe(0);
    expect(service.overview('month')).toMatchObject({ watchMs: HOUR, episodesWatched: 1, unit: 'day' });
    expect(service.overview('month').series).toHaveLength(30);
  });

  it('ranks anime by watch time and groups genres (top five plus the rest) and sources', () => {
    const a = seed('/a', 'A', ['Action', 'Drama']);
    const b = seed('/b', 'B', ['Action']);
    session(a.animeId, a.ids[0]!, daysAgo(1), HOUR);
    session(b.animeId, b.ids[0]!, daysAgo(1), 3 * HOUR);
    session(b.animeId, b.ids[1]!, daysAgo(1), HOUR);
    finish(a.ids[0]!, daysAgo(1));
    finish(b.ids[0]!, daysAgo(1));
    finish(b.ids[1]!, daysAgo(1));

    const overview = service.overview('month');
    expect(overview.topAnime.map((row) => [row.title, row.episodes, row.ms])).toEqual([
      ['B', 2, 4 * HOUR],
      ['A', 1, HOUR],
    ]);
    expect(overview.genres).toEqual([
      { name: 'Action', episodes: 3 },
      { name: 'Drama', episodes: 1 },
    ]);
    expect(overview.otherGenreEpisodes).toBe(0);
    expect(overview.sources).toEqual([{ sourceId: 'example/en', name: 'Example (EN)', episodes: 3 }]);
  });

  it('folds genres beyond the fifth into "other"', () => {
    const a = seed('/a', 'A', ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7']);
    session(a.animeId, a.ids[0]!, daysAgo(0), HOUR);
    finish(a.ids[0]!, daysAgo(0));
    const overview = service.overview('week');
    expect(overview.genres).toHaveLength(5);
    expect(overview.otherGenreEpisodes).toBe(2);
  });

  it('buckets the year per month and "all" from the first session', () => {
    const a = seed('/a', 'A', []);
    session(a.animeId, a.ids[0]!, new Date(2026, 6, 15).getTime(), HOUR);
    const year = service.overview('year');
    expect(year.unit).toBe('month');
    expect(year.series).toHaveLength(12);
    const all = service.overview('all');
    expect(all.from).toBeNull();
    expect(all.series).toHaveLength(4);
    expect(all.series[0]).toMatchObject({ start: new Date(2026, 6, 1).getTime(), ms: HOUR });
  });

  it('counts the library and the anime being watched', () => {
    const a = seed('/a', 'A', []);
    seed('/b', 'B', []);
    db.history.touch(a.animeId, a.ids[0]!, daysAgo(0));
    expect(service.overview('week').library).toEqual({ total: 2, watching: 1 });
  });

  it('survives clearing the history, and clear() forgets the sessions only', () => {
    const a = seed('/a', 'A', ['Action']);
    session(a.animeId, a.ids[0]!, daysAgo(0), HOUR);
    db.history.touch(a.animeId, a.ids[0]!, daysAgo(0));
    db.history.clear();
    expect(service.overview('week').watchMs).toBe(HOUR);

    finish(a.ids[0]!, daysAgo(0));
    service.clear();
    expect(service.overview('week')).toMatchObject({ watchMs: 0, topAnime: [] });
    expect(db.episodes.list(a.animeId).some((e) => e.watched)).toBe(true);
  });

  it('ignores sessions and finished episodes dated in the future, in the totals, the series and the streak', () => {
    const a = seed('/a', 'A', ['Action']);
    session(a.animeId, a.ids[0]!, daysAgo(0), HOUR);
    finish(a.ids[0]!, daysAgo(0));
    session(a.animeId, a.ids[1]!, daysAgo(-2), 5 * HOUR);
    finish(a.ids[1]!, daysAgo(-2));
    for (const range of ['week', 'month', 'year', 'all'] as const) {
      const overview = service.overview(range);
      expect(overview.watchMs).toBe(HOUR);
      expect(overview.episodesWatched).toBe(1);
      expect(overview.series.reduce((sum, bucket) => sum + bucket.ms, 0)).toBe(HOUR);
      expect(overview.series.reduce((sum, bucket) => sum + bucket.episodes, 0)).toBe(1);
      expect(overview.streak).toEqual({ current: 1, best: 1 });
    }
  });

  it('says whether anything was ever recorded, whatever the period shows', () => {
    expect(service.overview('week').hasData).toBe(false);
    const a = seed('/a', 'A', []);
    session(a.animeId, a.ids[0]!, daysAgo(200), HOUR);
    expect(service.overview('week')).toMatchObject({ hasData: true, watchMs: 0 });
    expect(service.overview('all').hasData).toBe(true);
  });

  it('drops the sessions of an anime that was deleted', () => {
    const a = seed('/a', 'A', ['Action']);
    const b = seed('/b', 'B', ['Drama']);
    session(a.animeId, a.ids[0]!, daysAgo(0), HOUR);
    session(b.animeId, b.ids[0]!, daysAgo(0), 2 * HOUR);
    finish(a.ids[0]!, daysAgo(0));
    db.connection.sqlite.prepare('DELETE FROM anime WHERE id = ?').run(a.animeId);
    const overview = service.overview('week');
    expect(overview.watchMs).toBe(2 * HOUR);
    expect(overview.topAnime.map((row) => row.title)).toEqual(['B']);
    expect(overview.genres).toEqual([]);
  });

  it('counts a day once however many sessions it has', () => {
    const a = seed('/a', 'A', []);
    session(a.animeId, a.ids[0]!, daysAgo(0, 8), HOUR);
    session(a.animeId, a.ids[1]!, daysAgo(0, 9), HOUR);
    session(a.animeId, a.ids[2]!, daysAgo(1), HOUR);
    expect(service.overview('week').streak).toEqual({ current: 2, best: 2 });
  });
});
