import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '../db/__tests__/helpers';
import { WatchService } from '../watch/service';
import { type RuleEpisode, WatchDownloads, selectAhead, selectDeletable } from './watch-hooks';

const ep = (id: number, number: number | null, extra: Partial<RuleEpisode> = {}): RuleEpisode => ({
  id,
  number,
  variant: null,
  sourceOrder: 100 - id,
  watched: false,
  sourceMissing: false,
  ...extra,
});
const none = () => false;

describe('selectAhead', () => {
  const list = [ep(1, 1), ep(2, 2), ep(3, 3), ep(4, 4), ep(5, 5)];

  it('takes the next N episode numbers after the playing one', () => {
    expect(selectAhead(list, 2, 2, none)).toEqual([3, 4]);
    expect(selectAhead(list, 5, 2, none)).toEqual([]);
    expect(selectAhead(list, 4, 3, none)).toEqual([5]);
  });

  it('skips watched, downloaded and queued episodes without widening the window', () => {
    const watched = [ep(1, 1), ep(2, 2), ep(3, 3, { watched: true }), ep(4, 4), ep(5, 5)];
    expect(selectAhead(watched, 2, 2, none)).toEqual([4]);
    expect(selectAhead(list, 1, 2, (id) => id === 2)).toEqual([3]);
  });

  it('follows episode numbers over gaps and halves, and ignores episodes the source dropped', () => {
    const odd = [ep(1, 1), ep(2, 2), ep(3, 2.5), ep(4, 4), ep(5, 5, { sourceMissing: true }), ep(6, 6)];
    expect(selectAhead(odd, 2, 2, none)).toEqual([3, 4]);
    expect(selectAhead(odd, 4, 2, none)).toEqual([6]);
  });

  it('downloads one copy per number: the playing variant, else the source first', () => {
    const variants = [
      ep(1, 1, { variant: 'Dub', sourceOrder: 5 }),
      ep(2, 1, { variant: 'Sub', sourceOrder: 4 }),
      ep(3, 2, { variant: 'Sub', sourceOrder: 3 }),
      ep(4, 2, { variant: 'Dub', sourceOrder: 2 }),
      ep(5, 3, { variant: 'BD', sourceOrder: 1 }),
      ep(6, 3, { variant: 'Sub', sourceOrder: 0 }),
    ];
    expect(selectAhead(variants, 1, 2, none)).toEqual([4, 6]); // Dub of 2; 3 has no Dub, so the one the source lists first
    expect(selectAhead(variants, 2, 1, none)).toEqual([3]);
    // Another variant of a number is already downloaded: that number is done.
    expect(selectAhead(variants, 1, 1, (id) => id === 3)).toEqual([]);
  });

  it('has nothing to follow for an unnumbered or unknown episode, or a count of 0', () => {
    expect(selectAhead([ep(1, null), ep(2, 2)], 1, 2, none)).toEqual([]);
    expect(selectAhead(list, 99, 2, none)).toEqual([]);
    expect(selectAhead(list, 1, 0, none)).toEqual([]);
  });
});

describe('selectDeletable', () => {
  const all = () => true;
  const watchedUpTo = (n: number) => Array.from({ length: 5 }, (_, i) => ep(i + 1, i + 1, { watched: i + 1 <= n }));

  it('delay 0 releases an episode as soon as it is watched', () => {
    expect(selectDeletable(watchedUpTo(3), 0, all)).toEqual([1, 2, 3]);
  });

  it('delay 1 ("after 1 more") releases an episode once the next one is watched too', () => {
    expect(selectDeletable(watchedUpTo(1), 1, all)).toEqual([]);
    expect(selectDeletable(watchedUpTo(2), 1, all)).toEqual([1]);
    expect(selectDeletable(watchedUpTo(3), 1, all)).toEqual([1, 2]);
    expect(selectDeletable(watchedUpTo(3), 2, all)).toEqual([1]);
  });

  it('counts steps between episode numbers, so gaps and halves are one step', () => {
    const odd = [ep(1, 1, { watched: true }), ep(2, 2.5, { watched: true }), ep(3, 7), ep(4, 9)];
    expect(selectDeletable(odd, 1, all)).toEqual([1]);
    const skipped = [ep(1, 1, { watched: true }), ep(2, 2), ep(3, 3, { watched: true })];
    expect(selectDeletable(skipped, 2, all)).toEqual([1]);
  });

  it('never lists unwatched episodes or episodes without a download', () => {
    const list = [ep(1, 1, { watched: true }), ep(2, 2), ep(3, 3, { watched: true }), ep(4, 4)];
    expect(selectDeletable(list, 0, (id) => id !== 1)).toEqual([3]);
    expect(selectDeletable(list, 0, (id) => id === 2 || id === 4)).toEqual([]);
  });

  it('treats the variants of a number as one step', () => {
    const list = [
      ep(1, 1, { watched: true, variant: 'Sub' }),
      ep(2, 1, { watched: true, variant: 'Dub' }),
      ep(3, 2, { watched: true, variant: 'Sub' }),
      ep(4, 2, { watched: true, variant: 'Dub' }),
    ];
    expect(selectDeletable(list, 1, all)).toEqual([1, 2]);
  });

  it('releases an unnumbered episode only with delay 0', () => {
    const list = [ep(1, null, { watched: true }), ep(2, 2, { watched: true }), ep(3, 3, { watched: true })];
    expect(selectDeletable(list, 1, all)).toEqual([2]);
    expect(selectDeletable(list, 0, all)).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------- wired to the real services

let db: TestDb;
let clock: number;
let watch: WatchService;
let hooks: WatchDownloads;
let enqueued: number[][];
let removed: number[];
const DURATION = 1_440_000;

beforeEach(async () => {
  db = await createTestDb();
  clock = 1_000_000;
  enqueued = [];
  removed = [];
  watch = new WatchService({
    episodes: db.episodes,
    anime: db.anime,
    history: db.history,
    sessions: db.sessions,
    settings: db.settings,
    changes: db.changes,
    now: () => clock,
  });
  hooks = new WatchDownloads({
    settings: db.settings,
    episodes: db.episodes,
    anime: db.anime,
    downloads: db.downloads,
    categoryIdsOf: (animeId) => db.library.categoryIdsOf(animeId),
    enqueueAhead: async (ids) => {
      enqueued.push(ids);
      for (const id of ids) db.downloads.insert({ episodeId: id, kind: 'hls', sizeBytes: null, now: clock });
    },
    removeDownload: async (id) => {
      removed.push(id);
      db.downloads.delete([id]);
    },
  });
  hooks.attach(watch);
});
afterEach(() => db.close());

/** Anime with episodes 1..count (library by default), numbers mapped to episode ids. */
function seed(count: number, options: { library?: boolean; categories?: number[]; title?: string } = {}) {
  const [row] = db.anime.upsertSummaries('example/en', [{ url: `/${options.title ?? 'show'}`, title: 'Show' }]);
  const animeId = row!.id;
  db.episodes.sync(
    animeId,
    Array.from({ length: count }, (_, i) => count - i).map((number) => ({
      url: `/${options.title ?? 'show'}/${number}`,
      name: `Episode ${number}`,
      number,
    })),
    100,
  );
  if (options.library !== false) db.library.add(animeId, options.categories ?? [], 100);
  const ids: Record<number, number> = {};
  for (const episode of db.episodes.list(animeId)) ids[episode.number!] = episode.id;
  return { animeId, ids };
}

const play = (
  playbackId: string,
  episodeId: number,
  positionMs = 0,
  reason: 'play' | 'heartbeat' | 'close' = 'play',
) => {
  clock += 1000;
  return watch.progress({ playbackId, episodeId, positionMs, durationMs: DURATION, reason });
};
const download = (episodeId: number) => db.downloads.insert({ episodeId, kind: 'hls', sizeBytes: null, now: clock });

describe('download ahead (DL-12)', () => {
  it('does nothing while the setting is off', async () => {
    const { ids } = seed(5);
    play('p', ids[1]!);
    await hooks.idle();
    expect(enqueued).toEqual([]);
  });

  it('queues the next N episodes of a library anime when playback starts', async () => {
    const { ids } = seed(5);
    db.settings.updateAppSettings({ downloadAhead: true, downloadAheadCount: 2 });
    play('p', ids[2]!);
    await hooks.idle();
    expect(enqueued).toEqual([[ids[3], ids[4]]]);
  });

  it('does not queue again on heartbeats, pauses or a second report of the same playback', async () => {
    const { ids } = seed(5);
    db.settings.updateAppSettings({ downloadAhead: true });
    play('p', ids[1]!);
    play('p', ids[1]!, 5000, 'heartbeat');
    play('p', ids[1]!, 10_000, 'heartbeat');
    play('p', ids[1]!, 10_000, 'play');
    await hooks.idle();
    expect(enqueued).toHaveLength(1);
  });

  it('queues only what is still missing when the same episode is opened again', async () => {
    const { ids } = seed(5);
    db.settings.updateAppSettings({ downloadAhead: true, downloadAheadCount: 3 });
    download(ids[2]!);
    play('p', ids[1]!);
    play('p', ids[1]!, 0, 'close');
    play('q', ids[1]!);
    await hooks.idle();
    expect(enqueued).toEqual([[ids[3], ids[4]]]);
  });

  it('is only for anime in the library', async () => {
    const { ids } = seed(5, { library: false });
    db.settings.updateAppSettings({ downloadAhead: true });
    play('p', ids[1]!);
    await hooks.idle();
    expect(enqueued).toEqual([]);
  });

  it('survives a failing download service', async () => {
    const { ids } = seed(3);
    db.settings.updateAppSettings({ downloadAhead: true });
    const logged: string[] = [];
    const failing = new WatchDownloads({
      settings: db.settings,
      episodes: db.episodes,
      anime: db.anime,
      downloads: db.downloads,
      categoryIdsOf: () => [],
      enqueueAhead: () => Promise.reject(new Error('down')),
      removeDownload: async () => undefined,
      log: (message) => logged.push(message),
    });
    failing.playStarted({ playbackId: 'x', episodeId: ids[1]! });
    await failing.idle();
    expect(logged).toHaveLength(1);
  });
});

describe('delete after watched (DL-13)', () => {
  const finish = (episodeId: number) => play(`w${episodeId}`, episodeId, 0.9 * DURATION, 'heartbeat');

  it('does nothing while the setting is off', async () => {
    const { ids } = seed(3);
    download(ids[1]!);
    finish(ids[1]!);
    finish(ids[2]!);
    await hooks.idle();
    expect(removed).toEqual([]);
  });

  it('with a delay of 1, removes an episode once the next one is watched too, and keeps the episode rows', async () => {
    const { animeId, ids } = seed(4);
    db.settings.updateAppSettings({ deleteAfterWatched: true, deleteAfterWatchedDelay: 1 });
    const rows = [1, 2, 3].map((n) => download(ids[n]!));
    finish(ids[1]!);
    await hooks.idle();
    expect(removed).toEqual([]);
    finish(ids[2]!);
    await hooks.idle();
    expect(removed).toEqual([rows[0]]);
    expect(db.downloads.byEpisode(ids[1]!)).toBeUndefined();
    expect(db.downloads.byEpisode(ids[2]!)).toBeDefined();
    expect(db.downloads.byEpisode(ids[3]!)).toBeDefined(); // not watched: untouched
    expect(db.episodes.list(animeId)).toHaveLength(4);
  });

  it('with a delay of 0, removes the episode right when it is watched', async () => {
    const { ids } = seed(3);
    db.settings.updateAppSettings({ deleteAfterWatched: true, deleteAfterWatchedDelay: 0 });
    download(ids[1]!);
    download(ids[2]!);
    finish(ids[1]!);
    await hooks.idle();
    expect(db.downloads.byEpisode(ids[1]!)).toBeUndefined();
    expect(db.downloads.byEpisode(ids[2]!)).toBeDefined();
  });

  it('waits until playback closes before deleting the file that is being played', async () => {
    const { ids } = seed(2);
    db.settings.updateAppSettings({ deleteAfterWatched: true, deleteAfterWatchedDelay: 0 });
    download(ids[1]!);
    play('p', ids[1]!);
    play('p', ids[1]!, 0.9 * DURATION, 'heartbeat');
    await hooks.idle();
    expect(removed).toEqual([]);
    play('p', ids[1]!, 0.95 * DURATION, 'close');
    await hooks.idle();
    expect(db.downloads.byEpisode(ids[1]!)).toBeUndefined();
  });

  it('keeps the downloads of anime in an excluded category', async () => {
    const keep = db.library.createCategory('Keep');
    const other = db.library.createCategory('Other');
    const kept = seed(3, { categories: [keep.id], title: 'a' });
    const gone = seed(3, { categories: [other.id], title: 'b' });
    db.settings.updateAppSettings({
      deleteAfterWatched: true,
      deleteAfterWatchedDelay: 0,
      deleteAfterWatchedExcludedCategories: [keep.id],
    });
    download(kept.ids[1]!);
    download(gone.ids[1]!);
    finish(kept.ids[1]!);
    finish(gone.ids[1]!);
    await hooks.idle();
    expect(db.downloads.byEpisode(kept.ids[1]!)).toBeDefined();
    expect(db.downloads.byEpisode(gone.ids[1]!)).toBeUndefined();
  });

  it('reacts to marking by hand, and releases every variant of a number', async () => {
    const [row] = db.anime.upsertSummaries('example/en', [{ url: '/v', title: 'V' }]);
    db.episodes.sync(
      row!.id,
      [3, 2, 1].flatMap((number) =>
        ['Sub', 'Dub'].map((variant) => ({ url: `/v/${number}${variant}`, name: `E${number}`, number, variant })),
      ),
      100,
    );
    const byKey = new Map(db.episodes.list(row!.id).map((e) => [`${e.number}${e.variant}`, e.id]));
    db.settings.updateAppSettings({ deleteAfterWatched: true, deleteAfterWatchedDelay: 1 });
    download(byKey.get('1Sub')!);
    download(byKey.get('2Dub')!);
    watch.markWatched([byKey.get('1Sub')!], true);
    watch.markWatched([byKey.get('2Sub')!], true);
    await hooks.idle();
    expect(db.downloads.byEpisode(byKey.get('1Sub')!)).toBeUndefined();
    expect(db.downloads.byEpisode(byKey.get('2Dub')!)).toBeDefined();
    watch.markPrevious(byKey.get('3Sub')!); // 1 and 2 were already watched: nothing new, no sweep needed
    watch.markWatched([byKey.get('3Dub')!], true);
    await hooks.idle();
    expect(db.downloads.byEpisode(byKey.get('2Dub')!)).toBeUndefined();
  });
});
