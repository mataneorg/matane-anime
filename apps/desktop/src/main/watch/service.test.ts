import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '../db/__tests__/helpers';
import { WatchService } from './service';

let db: TestDb;
let clock: number;
let incognito: boolean;
let service: WatchService;

const DURATION = 1_440_000;

beforeEach(async () => {
  db = await createTestDb();
  clock = 1_000_000;
  incognito = false;
  service = build();
});
afterEach(() => db.close());

function build(): WatchService {
  return new WatchService({
    episodes: db.episodes,
    anime: db.anime,
    history: db.history,
    sessions: db.sessions,
    settings: db.settings,
    changes: db.changes,
    isIncognito: () => incognito,
    now: () => clock,
  });
}

/** An anime in the library with episodes 1..n (optionally with Sub and Dub). */
function seed(count: number, variants: (string | null)[] = [null]): { animeId: number; ids: Record<string, number> } {
  const [row] = db.anime.upsertSummaries('example/en', [{ url: '/show', title: 'Show' }]);
  const animeId = row!.id;
  const list = Array.from({ length: count }, (_, i) => count - i).flatMap((number) =>
    variants.map((variant) => ({
      url: `/show/${number}${variant ?? ''}`,
      name: `Episode ${number}`,
      number,
      ...(variant && { variant }),
    })),
  );
  db.episodes.sync(animeId, list, 100);
  db.library.add(animeId, [], 100);
  const ids: Record<string, number> = {};
  for (const episode of db.episodes.list(animeId)) ids[`${episode.number}${episode.variant ?? ''}`] = episode.id;
  return { animeId, ids };
}

const report = (
  playbackId: string,
  episodeId: number,
  positionMs: number,
  reason: 'play' | 'heartbeat' | 'pause' | 'seek' | 'ended' | 'close',
  advance = 0,
) => {
  clock += advance;
  return service.progress({ playbackId, episodeId, positionMs, durationMs: DURATION, reason });
};

describe('progress and the watched threshold (PRG-1…3)', () => {
  it('stores the position and the duration, and marks the episode watched at the threshold', () => {
    const { ids } = seed(2);
    report('p', ids['1']!, 0, 'play');
    expect(report('p', ids['1']!, 600_000, 'heartbeat', 5000)).toEqual({ watched: false });
    expect(db.episodes.get(ids['1']!)).toMatchObject({ positionMs: 600_000, durationMs: DURATION, watched: false });
    expect(report('p', ids['1']!, 0.85 * DURATION, 'heartbeat', 5000)).toEqual({ watched: true });
    expect(db.episodes.get(ids['1']!)).toMatchObject({ watched: true, watchedAt: clock });
  });

  it('uses the threshold from the settings, and 100% only at the end', () => {
    const { ids } = seed(2);
    db.settings.updateAppSettings({ playerWatchedThreshold: 50 });
    expect(report('p', ids['1']!, DURATION / 2, 'heartbeat').watched).toBe(true);
    db.settings.updateAppSettings({ playerWatchedThreshold: 100 });
    expect(report('q', ids['2']!, DURATION - 1000, 'heartbeat').watched).toBe(false);
    expect(report('q', ids['2']!, DURATION, 'ended', 1000).watched).toBe(true);
    expect(db.episodes.get(ids['2']!)).toMatchObject({ positionMs: DURATION, watched: true });
  });

  it('does not undo watched when the position moves back (PRG-3)', () => {
    const { ids } = seed(1);
    report('p', ids['1']!, 0.9 * DURATION, 'heartbeat');
    report('p', ids['1']!, 60_000, 'seek', 5000);
    expect(db.episodes.get(ids['1']!)).toMatchObject({ watched: true, positionMs: 60_000 });
  });

  it('marks every variant of the number watched, and a variant that appears later inherits it (PRG-5)', () => {
    const { animeId, ids } = seed(2, ['Sub', 'Dub']);
    report('p', ids['1Sub']!, 0.9 * DURATION, 'heartbeat');
    expect(db.episodes.get(ids['1Dub']!)?.watched).toBe(true);
    expect(db.episodes.get(ids['2Sub']!)?.watched).toBe(false);
    db.episodes.sync(
      animeId,
      [
        { url: '/show/1BD', name: 'Episode 1', number: 1, variant: 'BD' },
        { url: '/show/2Sub', name: 'Episode 2', number: 2, variant: 'Sub' },
      ],
      200,
    );
    const bd = db.episodes.list(animeId).find((e) => e.variant === 'BD')!;
    expect(bd.watched).toBe(true);
  });

  it('tells the player an unknown episode does not exist', () => {
    expect(() => report('p', 424242, 0, 'play')).toThrow(/No episode/);
  });
});

describe('history and watch sessions (PRG-8, PRG-10)', () => {
  it('puts an anime in the history only after five seconds of actual playing', () => {
    const { animeId, ids } = seed(2);
    report('p', ids['1']!, 0, 'play');
    report('p', ids['1']!, 2000, 'heartbeat', 2000);
    expect(db.history.get(animeId)).toBeUndefined();
    report('p', ids['1']!, 5000, 'heartbeat', 3000);
    expect(db.history.get(animeId)).toMatchObject({ episodeId: ids['1'], watchedAt: clock });
    report('p', ids['2']!, 0, 'play'); // another playback of the next episode
    report('p2', ids['2']!, 6000, 'heartbeat', 6000);
    expect(db.history.get(animeId)?.episodeId).toBe(ids['2']);
  });

  it('counts playing time only while playing, and caps a stall', () => {
    const { ids } = seed(1);
    report('p', ids['1']!, 0, 'play');
    report('p', ids['1']!, 5000, 'heartbeat', 5000); // +5 s
    report('p', ids['1']!, 10_000, 'pause', 5000); // +5 s, then paused
    report('p', ids['1']!, 10_000, 'heartbeat', 600_000); // a long pause is not playing time: nothing counted before this report
    report('p', ids['1']!, 15_000, 'heartbeat', 5000); // +5 s
    report('p', ids['1']!, 15_000, 'close', 60_000); // a stall of a minute counts as 15 s at most
    const [session] = db.connection.sqlite.prepare('SELECT * FROM watch_sessions').all() as {
      active_ms: number;
      ended_at: number | null;
      started_at: number;
    }[];
    expect(session!.active_ms).toBe(5000 + 5000 + 5000 + 15_000);
    expect(session!.ended_at).toBe(clock);
  });

  it('keeps one session per playback, and closes sessions a crash left open', () => {
    const { ids } = seed(2);
    report('a', ids['1']!, 0, 'play');
    report('a', ids['1']!, 5000, 'heartbeat', 5000);
    report('b', ids['2']!, 0, 'play');
    expect(db.connection.sqlite.prepare('SELECT COUNT(*) AS n FROM watch_sessions').get()).toEqual({ n: 2 });
    service = build(); // the app starts again; neither session was closed
    const open = db.connection.sqlite
      .prepare('SELECT started_at, active_ms, ended_at FROM watch_sessions ORDER BY id')
      .all() as { started_at: number; active_ms: number; ended_at: number | null }[];
    expect(open.map((s) => s.ended_at)).toEqual([open[0]!.started_at + 5000, open[1]!.started_at]);
  });

  it('clearing the history leaves progress and sessions alone (PRG-10)', () => {
    const { animeId, ids } = seed(1);
    report('p', ids['1']!, 0, 'play');
    report('p', ids['1']!, 30_000, 'heartbeat', 30_000);
    expect(service.listHistory()).toHaveLength(1);
    service.clearHistory();
    expect(service.listHistory()).toEqual([]);
    expect(db.episodes.get(ids['1']!)?.positionMs).toBe(30_000);
    expect(db.connection.sqlite.prepare('SELECT COUNT(*) AS n FROM watch_sessions').get()).toEqual({ n: 1 });
    expect(db.anime.get(animeId)?.inLibrary).toBe(true);
  });

  it('lists the history newest first with what to play next', () => {
    const a = seed(2);
    report('p', a.ids['1']!, 0, 'play');
    report('p', a.ids['1']!, 0.9 * DURATION, 'heartbeat', 20_000);
    const [entry] = service.listHistory();
    expect(entry).toMatchObject({
      title: 'Show',
      episodeNumber: 1,
      watched: true,
      next: { reason: 'next', number: 2 },
    });
    service.deleteHistory(a.animeId);
    expect(service.listHistory()).toEqual([]);
  });
});

describe('explicit actions (PRG-7)', () => {
  it('marks watched and unwatched, forgetting the position when unmarked', () => {
    const { ids } = seed(3);
    service.markWatched([ids['2']!], true);
    expect(db.episodes.get(ids['2']!)?.watched).toBe(true);
    db.episodes.saveProgress(ids['2']!, 300_000, DURATION);
    service.markWatched([ids['2']!], false);
    expect(db.episodes.get(ids['2']!)).toMatchObject({ watched: false, watchedAt: null, positionMs: 0 });
  });

  it('marks everything before an episode as watched, and nothing after', () => {
    const { ids } = seed(5);
    service.markPrevious(ids['4']!);
    expect([1, 2, 3, 4, 5].map((n) => db.episodes.get(ids[String(n)]!)!.watched)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it('resets progress', () => {
    const { ids } = seed(1);
    report('p', ids['1']!, 0.9 * DURATION, 'heartbeat');
    service.resetProgress(ids['1']!);
    expect(db.episodes.get(ids['1']!)).toMatchObject({ watched: false, positionMs: 0 });
  });
});

describe('continue and resume', () => {
  it('follows the last opened episode, then the next one', () => {
    const { animeId, ids } = seed(3);
    expect(service.continueTarget(animeId)).toMatchObject({ episodeId: ids['1'], reason: 'first' });
    report('p', ids['1']!, 0, 'play');
    report('p', ids['1']!, 300_000, 'heartbeat', 10_000);
    expect(service.continueTarget(animeId)).toMatchObject({ episodeId: ids['1'], reason: 'resume', resumeMs: 297_000 });
    report('p', ids['1']!, 0.9 * DURATION, 'heartbeat', 10_000);
    expect(service.continueTarget(animeId)).toMatchObject({ episodeId: ids['2'], reason: 'next' });
    expect(service.resumeFor(db.episodes.get(ids['1']!)!)).toBe(0);
  });
});

describe('incognito (PRG-11)', () => {
  it('records nothing automatically, but explicit marks still apply', () => {
    const { animeId, ids } = seed(2);
    incognito = true;
    expect(report('p', ids['1']!, 0.9 * DURATION, 'heartbeat', 10_000)).toEqual({ watched: false });
    expect(db.episodes.get(ids['1']!)).toMatchObject({ positionMs: 0, watched: false });
    expect(db.history.get(animeId)).toBeUndefined();
    expect(db.connection.sqlite.prepare('SELECT COUNT(*) AS n FROM watch_sessions').get()).toEqual({ n: 0 });
    service.markWatched([ids['1']!], true);
    expect(db.episodes.get(ids['1']!)?.watched).toBe(true);
  });
});

describe('notifications', () => {
  it('tags what a report changed, and stays quiet for routine heartbeats', () => {
    const { animeId, ids } = seed(1);
    report('p', ids['1']!, 0, 'play');
    report('p', ids['1']!, 6000, 'heartbeat', 6000);
    db.emitted.length = 0;
    report('p', ids['1']!, 11_000, 'heartbeat', 5000);
    expect(db.emitted).toEqual([]);
    report('p', ids['1']!, 11_000, 'pause', 100);
    expect(db.emitted.flat()).toEqual(expect.arrayContaining([`episodes:${animeId}`, 'library']));
  });
});
