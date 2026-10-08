import { UPDATE_WINDOW_MS } from '@matane-anime/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from './helpers';

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(() => db.close());

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;
const sql = (statement: string, ...params: unknown[]) => db.connection.sqlite.prepare(statement).run(...params);

const episodeList = (title: string, numbers: number[]) =>
  numbers.map((number) => ({ url: `/${title}/${number}`, name: `Episode ${number}`, number }));

/** An anime in the library from `addedAt`, with `numbers` listed (fetched at `fetchedAt`). */
function anime(title: string, numbers: number[], { addedAt = 1000, fetchedAt = 500, sourceId = 'example/en' } = {}) {
  const [row] = db.anime.upsertSummaries(sourceId, [{ url: `/${title}`, title }]);
  db.episodes.sync(row!.id, episodeList(title, numbers), fetchedAt);
  db.library.add(row!.id, [], addedAt);
  return row!.id;
}

/** The episodes a later refresh found, `at` being when. */
const refresh = (id: number, title: string, numbers: number[], at: number) =>
  db.episodes.sync(id, episodeList(title, numbers), at);

const ids = (animeId: number) => db.episodes.list(animeId).map((e) => e.id);

describe('the list of new episodes (UPD-4)', () => {
  it('never shows the episodes that were there when the anime was added', () => {
    anime('Alpha', [3, 2, 1], { addedAt: 1000, fetchedAt: 500 });
    expect(db.updates.list(2000).entries).toEqual([]);
    expect(db.updates.count(2000)).toBe(0);
  });

  it('shows an episode found after the anime was added, newest first, with what the page needs', () => {
    const alpha = anime('Alpha', [1]);
    const beta = anime('Beta', [1]);
    refresh(alpha, 'Alpha', [2, 1], 3000);
    refresh(beta, 'Beta', [3, 2, 1], 4000);
    const { entries } = db.updates.list(5000);
    expect(entries.map((e) => [e.animeTitle, e.episodeNumber, e.fetchedAt])).toEqual([
      ['Beta', 3, 4000],
      ['Beta', 2, 4000],
      ['Alpha', 2, 3000],
    ]);
    expect(entries[0]).toMatchObject({
      animeId: beta,
      sourceId: 'example/en',
      sourceName: 'Example (EN)',
      episodeName: 'Episode 3',
      variant: null,
      hasLocalCover: false,
      download: null,
    });
    expect(db.updates.count(5000)).toBe(3);
  });

  it('drops an episode once it is watched (through the watch path), and by number for every variant', () => {
    const id = anime('Alpha', [1]);
    db.episodes.sync(
      id,
      [
        { url: '/a/2sub', name: 'Episode 2', number: 2, variant: 'Sub' },
        { url: '/a/2dub', name: 'Episode 2', number: 2, variant: 'Dub' },
        { url: '/Alpha/1', name: 'Episode 1', number: 1 },
      ],
      3000,
    );
    expect(db.updates.count(5000)).toBe(2);
    db.episodes.setWatched([ids(id)[0]!], true, 4000);
    expect(db.updates.count(5000)).toBe(0);
  });

  it('keeps only the last 30 days, counted from when the app saw the episode', () => {
    const id = anime('Alpha', [1]);
    refresh(id, 'Alpha', [2, 1], NOW - UPDATE_WINDOW_MS - 1);
    expect(db.updates.count(NOW)).toBe(0);
    sql('UPDATE episodes SET fetched_at = ? WHERE number = 2', NOW - UPDATE_WINDOW_MS);
    expect(db.updates.count(NOW)).toBe(1);
    expect(db.updates.count(NOW + 1)).toBe(0);
  });

  it('leaves out anime that are not in the library, and episodes the source dropped', () => {
    const id = anime('Alpha', [1]);
    refresh(id, 'Alpha', [3, 2, 1], 3000);
    expect(db.updates.count(5000)).toBe(2);
    // Episode 3 is gone from the source but kept (it has a position).
    db.episodes.saveProgress(ids(id)[0]!, 1000, null);
    refresh(id, 'Alpha', [2, 1], 3500);
    expect(db.episodes.list(id).find((e) => e.number === 3)).toMatchObject({ sourceMissing: true });
    expect(db.updates.count(5000)).toBe(1);
    db.library.remove(id);
    expect(db.updates.count(5000)).toBe(0);
  });

  it('starts again when the anime is removed and added back: what the app knew then is not news', () => {
    const id = anime('Alpha', [1]);
    refresh(id, 'Alpha', [2, 1], 3000);
    expect(db.updates.count(5000)).toBe(1);
    db.library.remove(id, 3500);
    db.library.add(id, [], 4000);
    expect(db.updates.count(5000)).toBe(0);
    refresh(id, 'Alpha', [3, 2, 1], 4500);
    expect(db.updates.list(5000).entries.map((e) => e.episodeNumber)).toEqual([3]);
  });

  it('shows the download of an entry', () => {
    const id = anime('Alpha', [1]);
    refresh(id, 'Alpha', [2, 1], 3000);
    const episode = db.episodes.list(id).find((e) => e.number === 2)!;
    sql(`INSERT INTO downloads (episode_id, status, kind, created_at) VALUES (?, 'downloading', 'hls', 1)`, episode.id);
    expect(db.updates.list(5000).entries[0]!.download).toEqual({ status: 'downloading' });
  });

  it('reports the anime the last check failed on, and the newest finished check', () => {
    const alpha = anime('Alpha', [1]);
    const beta = anime('Beta', [1]);
    expect(db.updates.list(5000)).toMatchObject({ lastCheckedAt: null, failed: [] });
    db.updates.markChecked(alpha, 3000, null);
    db.updates.markChecked(beta, 2000, 'HTTP 500');
    expect(db.updates.list(5000)).toMatchObject({
      lastCheckedAt: 3000,
      failed: [{ animeId: beta, title: 'Beta', sourceName: 'Example (EN)', error: 'HTTP 500' }],
    });
    // A failure keeps the time of the last success; the next success clears the message.
    db.updates.markChecked(alpha, 3500, 'timeout');
    expect(db.anime.get(alpha)).toMatchObject({ updateCheckedAt: 3000, updateError: 'timeout' });
    db.updates.markChecked(alpha, 4000, null);
    db.updates.markChecked(beta, 4100, null);
    expect(db.updates.list(5000)).toMatchObject({ lastCheckedAt: 4100, failed: [] });
    db.library.remove(alpha);
    expect(db.updates.list(5000).lastCheckedAt).toBe(4100);
  });

  it('never scans the episodes table for the badge: the library index, then episodes by anime and watched', () => {
    const plan = db.connection.sqlite
      .prepare(
        `EXPLAIN QUERY PLAN SELECT COUNT(*) FROM episodes e JOIN anime a ON a.id = e.anime_id
         WHERE a.in_library = 1 AND e.fetched_at > a.added_at AND e.watched = 0 AND e.source_missing = 0 AND e.fetched_at >= ?`,
      )
      .all(0) as { detail: string }[];
    const text = plan.map((row) => row.detail).join('\n');
    expect(text).toMatch(/SEARCH a USING (COVERING )?INDEX anime_library_added_idx/);
    expect(text).toMatch(/SEARCH e USING INDEX episodes_anime_watched_idx/);
    expect(text).not.toMatch(/SCAN/);
  });
});

describe('the first episode list of an anime already in the library', () => {
  it('is not news: an anime added before it was ever fetched keeps its baseline', () => {
    const [row] = db.anime.upsertSummaries('example/en', [{ url: '/Alpha', title: 'Alpha' }]);
    db.library.add(row!.id, [], 1000);
    // First fetch ever, after the add: the rows are fetched later than `added_at`, but are the baseline.
    db.episodes.sync(row!.id, episodeList('Alpha', [2, 1]), 3000, 1000);
    expect(db.updates.count(5000)).toBe(0);
    expect(db.episodes.list(row!.id).every((e) => e.fetchedAt === 1000)).toBe(true);
    // The next refresh really is news.
    refresh(row!.id, 'Alpha', [3, 2, 1], 4000);
    expect(db.updates.list(5000).entries.map((e) => e.episodeNumber)).toEqual([3]);
  });
});

describe('migrating an anime to another source', () => {
  it('does not turn the episodes the new anime already has into updates', async () => {
    const { planMigration } = await import('../../library/match');
    const from = anime('Old', [2, 1], { addedAt: 1000, fetchedAt: 500, sourceId: 'example/en' });
    const [target] = db.anime.upsertSummaries('example/id', [{ url: '/New', title: 'New' }]);
    db.episodes.sync(target!.id, episodeList('New', [2, 1]), 9000);
    const plan = planMigration([], []);
    db.library.migrate(from, target!.id, plan, 9500);
    expect(db.anime.get(target!.id)).toMatchObject({ inLibrary: true, addedAt: 1000 });
    expect(db.updates.count(10_000)).toBe(0);
    refresh(target!.id, 'New', [3, 2, 1], 9800);
    expect(db.updates.count(10_000)).toBe(1);
  });
});

describe('episodes that dropped out of the source (UPD-5)', () => {
  /** Alpha with episodes 1..4; a refresh then lists only 4 and 3, so 1 and 2 are gone. */
  function setup() {
    const id = anime('Alpha', [4, 3, 2, 1]);
    const byNumber = (n: number) => db.episodes.list(id).find((e) => e.number === n)!;
    return { id, byNumber, drop: () => refresh(id, 'Alpha', [4, 3], 3000) };
  }

  it('deletes an episode nothing hangs on', () => {
    const { id, drop } = setup();
    const result = drop();
    expect(result).toMatchObject({ missing: 0, removed: 2 });
    expect(db.episodes.list(id).map((e) => e.number)).toEqual([4, 3]);
  });

  it('keeps one that is watched, flagged', () => {
    const { id, byNumber, drop } = setup();
    db.episodes.setWatched([byNumber(1).id], true, 2000);
    expect(drop()).toMatchObject({ missing: 1, removed: 1 });
    expect(db.episodes.list(id).find((e) => e.number === 1)).toMatchObject({ sourceMissing: true, watched: true });
    expect(db.episodes.list(id).find((e) => e.number === 2)).toBeUndefined();
  });

  it('keeps one with a saved position', () => {
    const { byNumber, drop } = setup();
    db.episodes.saveProgress(byNumber(2).id, 1, null);
    drop();
    expect(db.episodes.get(byNumber(2).id)).toMatchObject({ sourceMissing: true });
  });

  it('keeps one with a download row, whatever its status', () => {
    const { byNumber, drop } = setup();
    sql(`INSERT INTO downloads (episode_id, status, kind, created_at) VALUES (?, 'error', 'hls', 1)`, byNumber(1).id);
    expect(drop()).toMatchObject({ missing: 1, removed: 1 });
    expect(db.episodes.get(byNumber(1).id)).toMatchObject({ sourceMissing: true });
  });

  it('keeps the episode in the history, and one in a watch session', () => {
    const { id, byNumber, drop } = setup();
    db.history.touch(id, byNumber(1).id, 2000);
    db.sessions.start(id, byNumber(2).id, 2000);
    expect(drop()).toMatchObject({ missing: 2, removed: 0 });
    expect(db.history.get(id)).toMatchObject({ episodeId: byNumber(1).id });
    expect(db.episodes.list(id)).toHaveLength(4);
  });

  it('does not touch history or sessions', () => {
    const { id, byNumber, drop } = setup();
    db.history.touch(id, byNumber(1).id, 2000);
    const session = db.sessions.start(id, byNumber(2).id, 2000);
    const before = db.connection.sqlite.prepare('SELECT * FROM history').all();
    drop();
    expect(db.connection.sqlite.prepare('SELECT * FROM history').all()).toEqual(before);
    expect(db.sessions.get(session)).toMatchObject({ episodeId: byNumber(2).id, activeMs: 0 });
  });

  it('deletes nothing when the source returned an empty list', () => {
    const { id } = setup();
    const result = refresh(id, 'Alpha', [], 3000);
    expect(result).toMatchObject({ added: 0, missing: 0, removed: 0 });
    expect(db.episodes.list(id)).toHaveLength(4);
    expect(db.episodes.list(id).some((e) => e.sourceMissing)).toBe(false);
  });

  it('deletes a kept episode later, once nothing hangs on it any more, and counts it as missing only once', () => {
    const { id, byNumber } = setup();
    const download = sql(
      `INSERT INTO downloads (episode_id, status, kind, created_at) VALUES (?, 'done', 'mp4', 1)`,
      byNumber(1).id,
    );
    expect(download.changes).toBe(1);
    expect(refresh(id, 'Alpha', [4, 3], 3000)).toMatchObject({ missing: 1, removed: 1 });
    expect(refresh(id, 'Alpha', [4, 3], 3100)).toMatchObject({ missing: 0, removed: 0 });
    sql('DELETE FROM downloads');
    expect(refresh(id, 'Alpha', [4, 3], 3200)).toMatchObject({ missing: 0, removed: 1 });
    expect(db.episodes.list(id).map((e) => e.number)).toEqual([4, 3]);
  });

  it('un-flags an episode that comes back', () => {
    const { id, byNumber } = setup();
    db.episodes.setWatched([byNumber(1).id], true, 2000);
    refresh(id, 'Alpha', [4, 3], 3000);
    refresh(id, 'Alpha', [4, 3, 1], 3100);
    expect(db.episodes.get(byNumber(1).id)).toMatchObject({ sourceMissing: false });
  });

  it('returns the ids of the new unwatched episodes only', () => {
    const { id, byNumber } = setup();
    db.episodes.setWatched([byNumber(4).id], true, 2000);
    const result = db.episodes.sync(
      id,
      [
        { url: '/a/5', name: 'E5', number: 5 },
        { url: '/a/4dub', name: 'E4 dub', number: 4, variant: 'Dub' },
        ...episodeList('Alpha', [4, 3, 2, 1]),
      ],
      3000,
    );
    expect(result.added).toBe(2);
    expect(result.addedIds).toHaveLength(1);
    expect(db.episodes.get(result.addedIds[0]!)).toMatchObject({ number: 5 });
  });
});

describe('what the checker reads', () => {
  it('targets: the library, a category, one anime (even outside the library)', () => {
    const alpha = anime('Alpha', [1]);
    const beta = anime('Beta', [1]);
    const [loose] = db.anime.upsertSummaries('example/en', [{ url: '/Loose', title: 'Loose' }]);
    const category = db.library.createCategory('Watching');
    db.library.setCategories([beta], [category.id]);
    expect(db.updates.targets({ kind: 'all' }).map((t) => t.animeId)).toEqual([alpha, beta]);
    expect(db.updates.targets({ kind: 'category', categoryId: category.id }).map((t) => t.animeId)).toEqual([beta]);
    expect(db.updates.targets({ kind: 'anime', animeId: loose!.id }).map((t) => t.title)).toEqual(['Loose']);
    expect(db.updates.targets({ kind: 'anime', animeId: 999 })).toEqual([]);
  });

  it('facts: history, sessions and episodes per anime', () => {
    const alpha = anime('Alpha', [2, 1]);
    const beta = anime('Beta', [1]);
    const episode = db.episodes.list(alpha)[0]!;
    db.history.touch(alpha, episode.id, 2000);
    db.sessions.start(beta, db.episodes.list(beta)[0]!.id, 2000);
    db.episodes.saveProgress(episode.id, 30_000, null);
    const facts = db.updates.facts([alpha, beta]);
    expect(facts.get(alpha)).toMatchObject({ hasHistory: true, hasSession: false });
    expect(facts.get(alpha)!.episodes.find((e) => e.id === episode.id)).toMatchObject({ positionMs: 30_000 });
    expect(facts.get(beta)).toMatchObject({ hasHistory: false, hasSession: true });
    expect(db.updates.facts([])).toEqual(new Map());
  });

  it('reads the include/exclude marks of categories and ignores damaged ones', () => {
    const a = db.library.createCategory('A');
    const b = db.library.createCategory('B');
    const c = db.library.createCategory('C');
    const d = db.library.createCategory('D');
    sql('UPDATE categories SET settings_json = ? WHERE id = ?', '{"autoDownload":"include"}', a.id);
    sql('UPDATE categories SET settings_json = ? WHERE id = ?', '{"autoDownload":"exclude"}', b.id);
    sql('UPDATE categories SET settings_json = ? WHERE id = ?', '{"autoDownload":"maybe"}', c.id);
    sql('UPDATE categories SET settings_json = ? WHERE id = ?', 'not json', d.id);
    expect(db.updates.autoDownloadModes()).toEqual(
      new Map([
        [a.id, 'include'],
        [b.id, 'exclude'],
      ]),
    );
  });

  it('describes episodes and finds the ones without a download', () => {
    const alpha = anime('Alpha', [2, 1]);
    const [two, one] = ids(alpha) as [number, number];
    sql(`INSERT INTO downloads (episode_id, status, kind, created_at) VALUES (?, 'queued', 'hls', 1)`, two);
    expect(db.updates.withoutDownload([one, two])).toEqual([one]);
    expect(db.updates.describeEpisodes([one, two]).map((e) => [e.episodeId, e.animeTitle, e.number])).toEqual([
      [two, 'Alpha', 2],
      [one, 'Alpha', 1],
    ]);
    expect(db.updates.describeEpisodes([])).toEqual([]);
  });

  it('covers anime that are only in the history or have downloads, but not browse-only cache', () => {
    const inLibrary = anime('Alpha', [2, 1]);
    // Left the library, still in the history.
    const [watched] = db.anime.upsertSummaries('example/en', [{ url: '/Watched', title: 'Watched' }]);
    db.episodes.sync(watched!.id, episodeList('Watched', [1]), 500);
    db.history.touch(watched!.id, ids(watched!.id)[0]!, 600);
    // Not in the library nor the history, but an episode is on disk.
    const [offline] = db.anime.upsertSummaries('example/id', [{ url: '/Offline', title: 'Offline' }]);
    db.episodes.sync(offline!.id, episodeList('Offline', [1]), 500);
    db.downloads.insert({ episodeId: ids(offline!.id)[0]!, kind: 'mp4', sizeBytes: 1, now: 700 });
    // Only seen in a listing: cache.
    const [cached] = db.anime.upsertSummaries('example/en', [{ url: '/Cached', title: 'Cached' }]);
    db.episodes.sync(cached!.id, episodeList('Cached', [1]), 500);

    const urls = db.updates.urlsOfExtension('example');
    expect(urls.anime.map((a) => a.url).sort()).toEqual(['/Alpha', '/Offline', '/Watched']);
    expect(urls.episodes.map((e) => e.url).sort()).toEqual(['/Alpha/1', '/Alpha/2', '/Offline/1', '/Watched/1']);
    expect(urls.anime.find((a) => a.id === inLibrary)?.sourceId).toBe('example/en');
    expect(db.updates.urlsOfExtension('other')).toEqual({ anime: [], episodes: [] });
  });

  it('rewrites stored urls, and refuses one that is taken', () => {
    const alpha = anime('Alpha', [2, 1]);
    const beta = anime('Beta', [1], { sourceId: 'example/id' });
    const urls = db.updates.urlsOfExtension('example');
    expect(urls.anime.map((a) => a.url).sort()).toEqual(['/Alpha', '/Beta']);
    expect(urls.episodes).toHaveLength(3);
    expect(db.updates.rewriteUrl('anime', alpha, '/alpha-new')).toBe(true);
    expect(db.anime.get(alpha)!.url).toBe('/alpha-new');
    db.anime.upsertSummaries('example/id', [{ url: '/taken', title: 'Taken' }]);
    expect(db.updates.rewriteUrl('anime', beta, '/taken')).toBe(false);
    expect(db.anime.get(beta)!.url).toBe('/Beta');
    const [first, second] = ids(alpha) as [number, number];
    expect(db.updates.rewriteUrl('episode', first, db.episodes.get(second)!.url)).toBe(false);
  });
});
