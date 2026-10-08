import { writeFileSync } from 'node:fs';
import type { LibrarySort } from '@matane-anime/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { autoDownloadAllowed } from '../../updates/rules';
import { type TestDb, createTestDb } from './helpers';

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(() => db.close());

/** An anime with `numbers` episodes (newest first), added to the library. */
function seed(
  title: string,
  numbers: number[],
  options: { sourceId?: string; variants?: string[]; inLibrary?: boolean; status?: string } = {},
): number {
  const [row] = db.anime.upsertSummaries(options.sourceId ?? 'example/en', [{ url: `/${title}`, title }]);
  const id = row!.id;
  const list = numbers.flatMap((number) =>
    (options.variants ?? [null]).map((variant) => ({
      url: `/${title}/${number}${variant ?? ''}`,
      name: `Episode ${number}`,
      number,
      ...(variant && { variant }),
    })),
  );
  db.episodes.sync(id, list, 100);
  if (options.status) db.connection.sqlite.prepare('UPDATE anime SET status = ? WHERE id = ?').run(options.status, id);
  if (options.inLibrary !== false) db.library.add(id, [], 500);
  return id;
}

const list = (query: Partial<Parameters<typeof db.library.list>[0]> = {}, threshold = 85) =>
  db.library.list({ sort: 'title', ...query }, threshold);

describe('categories (LIB-1)', () => {
  it('creates, renames, orders and deletes', () => {
    const a = db.library.createCategory('  Watching ');
    const b = db.library.createCategory('Plan   to watch');
    expect([a.name, b.name]).toEqual(['Watching', 'Plan to watch']);
    expect(db.library.listCategories().map((c) => c.name)).toEqual(['Watching', 'Plan to watch']);

    db.library.reorderCategories([b.id, a.id]);
    expect(db.library.listCategories().map((c) => c.id)).toEqual([b.id, a.id]);
    // A partial list keeps the others after it, in their previous order.
    const c = db.library.createCategory('Completed');
    db.library.reorderCategories([c.id]);
    expect(db.library.listCategories().map((x) => x.id)).toEqual([c.id, b.id, a.id]);

    db.library.renameCategory(a.id, 'Now');
    expect(db.library.listCategories().find((x) => x.id === a.id)?.name).toBe('Now');
    db.library.deleteCategory(a.id);
    expect(db.library.listCategories()).toHaveLength(2);
    expect(() => db.library.createCategory('   ')).toThrow(/needs a name/);
  });

  it('marks a category for auto-download, keeps its other settings and emits the change (DL-11)', () => {
    const a = db.library.createCategory('A');
    const mark = (): unknown => db.library.listCategories().find((c) => c.id === a.id)?.autoDownload;
    const row = () =>
      db.connection.sqlite.prepare('SELECT settings_json AS json FROM categories WHERE id = ?').get(a.id) as {
        json: string | null;
      };
    expect(a.autoDownload).toBeNull();
    expect(mark()).toBeNull();

    db.connection.sqlite.prepare('UPDATE categories SET settings_json = ? WHERE id = ?').run('{"other":1}', a.id);
    db.emitted.length = 0;
    db.library.setCategoryAutoDownload(a.id, 'include');
    expect(mark()).toBe('include');
    expect(JSON.parse(row().json!)).toEqual({ other: 1, autoDownload: 'include' });
    expect(db.emitted.flat()).toContain('categories');

    db.library.setCategoryAutoDownload(a.id, 'exclude');
    expect(mark()).toBe('exclude');
    db.library.setCategoryAutoDownload(a.id, null);
    expect(mark()).toBeNull();
    expect(JSON.parse(row().json!)).toEqual({ other: 1 });

    // With nothing else stored the column goes back to NULL; a damaged value is replaced; an unknown id is ignored.
    db.connection.sqlite.prepare('UPDATE categories SET settings_json = ? WHERE id = ?').run('not json', a.id);
    expect(mark()).toBeNull();
    db.library.setCategoryAutoDownload(a.id, 'include');
    expect(JSON.parse(row().json!)).toEqual({ autoDownload: 'include' });
    db.library.setCategoryAutoDownload(a.id, null);
    expect(row().json).toBeNull();
    expect(() => db.library.setCategoryAutoDownload(9999, 'include')).not.toThrow();
  });

  it('writes the marks the update checker reads (DL-11)', () => {
    const a = db.library.createCategory('A');
    const b = db.library.createCategory('B');
    const c = db.library.createCategory('C');
    db.library.setCategoryAutoDownload(a.id, 'include');
    db.library.setCategoryAutoDownload(b.id, 'exclude');
    db.library.setCategoryAutoDownload(c.id, 'include');
    db.library.setCategoryAutoDownload(c.id, null);
    const modes = db.updates.autoDownloadModes();
    expect(modes).toEqual(
      new Map([
        [a.id, 'include'],
        [b.id, 'exclude'],
      ]),
    );
    // What the list shows is what the checker decides on.
    for (const category of db.library.listCategories())
      expect(modes.get(category.id) ?? null).toBe(category.autoDownload);
    expect(autoDownloadAllowed([a.id], modes)).toBe(true);
    expect(autoDownloadAllowed([a.id, b.id], modes)).toBe(false);
    expect(autoDownloadAllowed([c.id], modes)).toBe(false);
  });

  it('counts only anime in the library, and an anime can be in several categories', () => {
    const watching = db.library.createCategory('Watching');
    const later = db.library.createCategory('Later');
    const one = seed('One', [1]);
    const two = seed('Two', [1]);
    db.library.setCategories([one, two], [watching.id, later.id]);
    expect(db.library.listCategories().map((c) => c.count)).toEqual([2, 2]);
    db.library.remove(two);
    expect(db.library.listCategories().map((c) => c.count)).toEqual([1, 1]);
    expect(list({ category: watching.id }).map((i) => i.title)).toEqual(['One']);
    expect(list({ category: later.id }).map((i) => i.categoryIds.sort())).toEqual([[watching.id, later.id].sort()]);
  });

  it('deleting a category leaves the anime in the library', () => {
    const category = db.library.createCategory('Gone');
    const id = seed('One', [1]);
    db.library.setCategories([id], [category.id]);
    db.library.deleteCategory(category.id);
    expect(list()).toHaveLength(1);
    expect(list()[0]!.categoryIds).toEqual([]);
  });
});

describe('membership', () => {
  it('keeps added_at from the first time, clears it on removal, and ignores unknown categories', () => {
    const id = seed('One', [1], { inLibrary: false });
    db.library.add(id, [999], 1000);
    db.library.add(id, [], 2000);
    expect(db.anime.get(id)).toMatchObject({ inLibrary: true, addedAt: 1000 });
    db.library.remove(id, 3000);
    expect(db.anime.get(id)).toMatchObject({ inLibrary: false, addedAt: null });
    expect(list()).toHaveLength(0);
    expect(() => db.library.add(12345, [])).toThrow(/No anime/);
  });

  it('only shows what is in the library, and tags what changed', () => {
    seed('In', [1]);
    seed('Out', [1], { inLibrary: false });
    expect(list().map((i) => i.title)).toEqual(['In']);
    expect(db.emitted.flat()).toEqual(expect.arrayContaining(['library', 'categories']));
  });
});

describe('library list (LIB-2…4)', () => {
  it('counts episodes per number and reports the last watched one', () => {
    const id = seed('Show', [3, 2, 1], { variants: ['Sub', 'Dub'] });
    expect(list()[0]).toMatchObject({
      total: 3,
      unwatched: 3,
      lastEpisode: null,
      continue: { number: 1, reason: 'first' },
    });
    const episode = db.episodes.list(id).find((e) => e.number === 1 && e.variant === 'Sub')!;
    db.episodes.setWatched([episode.id], true, 900);
    db.history.touch(id, episode.id, 900);
    // Marking one variant marks the Dub too, so the number is watched.
    expect(list()[0]).toMatchObject({
      total: 3,
      unwatched: 2,
      lastWatchedAt: 900,
      lastEpisode: { number: 1, watched: true },
      continue: { number: 2, reason: 'next' },
    });
  });

  it('shows the unfinished episode as the one to continue, with a resume position', () => {
    const id = seed('Show', [2, 1]);
    const first = db.episodes.list(id).find((e) => e.number === 1)!;
    db.episodes.saveProgress(first.id, 600_000, 1_440_000);
    db.history.touch(id, first.id, 1000);
    expect(list()[0]!.continue).toMatchObject({ episodeId: first.id, reason: 'resume', resumeMs: 597_000 });
  });

  it('filters by category, search (titles and alternative titles), status, source and progress', () => {
    const a = seed('Sky Harbor', [2, 1], { status: 'ongoing' });
    seed('Quiet Orchard', [1], { sourceId: 'example/id', status: 'completed' });
    db.connection.sqlite.prepare('UPDATE anime SET alt_titles_json = \'["Sora no Minato"]\' WHERE id = ?').run(a);
    expect(list({ search: 'sky' }).map((i) => i.title)).toEqual(['Sky Harbor']);
    expect(list({ search: 'sora min' }).map((i) => i.title)).toEqual(['Sky Harbor']);
    expect(list({ search: 'SKY har' }).map((i) => i.title)).toEqual(['Sky Harbor']);
    expect(list({ search: 'nothing' })).toEqual([]);
    expect(list({ search: '"; DROP TABLE anime; --' })).toEqual([]);
    expect(list({ status: 'completed' }).map((i) => i.title)).toEqual(['Quiet Orchard']);
    expect(list({ sourceId: 'example/id' }).map((i) => i.title)).toEqual(['Quiet Orchard']);

    expect(list({ startedOnly: true })).toEqual([]);
    const episode = db.episodes.list(a)[0]!;
    db.episodes.saveProgress(episode.id, 5000, 100_000);
    expect(list({ startedOnly: true }).map((i) => i.title)).toEqual(['Sky Harbor']);
    db.episodes.setWatched(
      db.episodes.list(a).map((e) => e.id),
      true,
    );
    expect(list({ unwatchedOnly: true }).map((i) => i.title)).toEqual(['Quiet Orchard']);
  });

  it('follows a title change in the search index', () => {
    const id = seed('Old Name', [1]);
    db.connection.sqlite.prepare("UPDATE anime SET title = 'New Name' WHERE id = ?").run(id);
    expect(list({ search: 'old' })).toEqual([]);
    expect(list({ search: 'new' })).toHaveLength(1);
  });

  it('sorts by title (naturally), last watched, latest episode, date added and unwatched', () => {
    const ten = seed('Show 10', [1]);
    const two = seed('Show 2', [3, 2, 1]);
    const one = seed('Show 1', [1]);
    db.connection.sqlite.prepare('UPDATE anime SET added_at = ?, latest_episode_at = ? WHERE id = ?').run(30, 300, ten);
    db.connection.sqlite.prepare('UPDATE anime SET added_at = ?, latest_episode_at = ? WHERE id = ?').run(10, 100, two);
    db.connection.sqlite
      .prepare('UPDATE anime SET added_at = ?, latest_episode_at = ? WHERE id = ?')
      .run(20, null, one);
    db.history.touch(two, db.episodes.list(two)[0]!.id, 5000);
    const titles = (sort: LibrarySort, descending?: boolean) => list({ sort, descending }).map((i) => i.title);
    expect(titles('title')).toEqual(['Show 1', 'Show 2', 'Show 10']);
    expect(titles('title', true)).toEqual(['Show 10', 'Show 2', 'Show 1']);
    expect(titles('added')).toEqual(['Show 10', 'Show 1', 'Show 2']);
    expect(titles('latestEpisode')[0]).toBe('Show 10');
    expect(titles('lastWatched')[0]).toBe('Show 2');
    expect(titles('unwatched')[0]).toBe('Show 2');
  });
});

describe('query plans (indexes from migration 0002)', () => {
  const plan = (sql: string) =>
    (db.connection.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[])
      .map((row) => row.detail)
      .join('\n');

  it('the library filter and the episode lookups use indexes, not scans', () => {
    expect(plan('SELECT * FROM anime WHERE in_library = 1 ORDER BY added_at')).toMatch(
      /anime_(library_added|in_library)_idx/,
    );
    expect(plan('SELECT * FROM episodes WHERE anime_id = 1 AND watched = 0')).toMatch(/USING (COVERING )?INDEX/);
    expect(plan('SELECT * FROM history ORDER BY watched_at DESC')).toMatch(/history_watched_at_idx/);
    expect(plan('SELECT id FROM episodes WHERE anime_id IN (SELECT id FROM anime WHERE in_library = 1)')).not.toMatch(
      /SCAN episodes/,
    );
  });
});

describe('1,000 anime and 50,000 episodes (docs/PRD.md §10.1)', () => {
  it('lists the whole library fast enough', () => {
    const sqlite = db.connection.sqlite;
    const insertAnime = sqlite.prepare(
      "INSERT INTO anime (source_id, url, title, in_library, added_at, status, created_at, updated_at) VALUES ('example/en', ?, ?, 1, ?, 'ongoing', 1, 1)",
    );
    const insertEpisode = sqlite.prepare(
      'INSERT INTO episodes (anime_id, url, name, number, variant, source_order, fetched_at, watched, position_ms, duration_ms) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 1440000)',
    );
    sqlite.transaction(() => {
      for (let a = 0; a < 1000; a++) {
        const id = Number(insertAnime.run(`/a${a}`, `Anime number ${a}`, a).lastInsertRowid);
        for (let e = 0; e < 50; e++)
          insertEpisode.run(id, `/a${a}/${e}`, `Episode ${e}`, 50 - e, null, e, e > 25 ? 1 : 0, e === 25 ? 300_000 : 0);
        if (a % 2 === 0)
          sqlite
            .prepare(
              'INSERT INTO history (anime_id, episode_id, watched_at) VALUES (?, (SELECT id FROM episodes WHERE anime_id = ? AND number = 25), ?)',
            )
            .run(id, id, a);
      }
    })();

    const timings: number[] = [];
    let items = 0;
    for (let run = 0; run < 5; run++) {
      const started = performance.now();
      items = list({ sort: 'lastWatched' }).length;
      timings.push(performance.now() - started);
    }
    const median = [...timings].sort((a, b) => a - b)[2]!;
    expect(items).toBe(1000);
    // The target is 100 ms (PRD §10.1). CI machines are slower and noisier, so the hard limit is looser.
    const report = `library.list, 1000 anime / 50000 episodes: median ${median.toFixed(0)} ms (${timings.map((t) => t.toFixed(0)).join(', ')})`;
    if (process.env['PERF_OUT']) writeFileSync(process.env['PERF_OUT'], report);
    expect(median).toBeLessThan(400);
    expect(list({ sort: 'title', search: 'number 99' }).length).toBeGreaterThan(0);
  }, 60_000);
});

describe('migrate (BRW-8)', () => {
  it('moves membership, categories, history and progress to the other anime', async () => {
    const { planMigration } = await import('../../library/match');
    const category = db.library.createCategory('Watching');
    const from = seed('Old Source', [3, 2, 1]);
    const to = seed('New Source', [3, 2, 1], { sourceId: 'example/id', inLibrary: false });
    db.library.setCategories([from], [category.id]);
    db.connection.sqlite.prepare('UPDATE anime SET added_at = 777 WHERE id = ?').run(from);
    const old = db.episodes.list(from);
    const one = old.find((e) => e.number === 1)!;
    const two = old.find((e) => e.number === 2)!;
    db.episodes.setWatched([one.id], true, 900);
    db.episodes.saveProgress(two.id, 600_000, 1_440_000);
    db.history.touch(from, two.id, 950);
    const session = db.sessions.start(from, two.id, 940);

    const plan = planMigration(
      db.episodes.list(from).map((e) => ({
        id: e.id,
        number: e.number,
        variant: e.variant,
        name: e.name,
        sourceOrder: e.sourceOrder,
        watched: e.watched,
        watchedAt: e.watchedAt,
        positionMs: e.positionMs,
        durationMs: e.durationMs,
      })),
      db.episodes
        .list(to)
        .map((e) => ({ id: e.id, number: e.number, variant: e.variant, name: e.name, sourceOrder: e.sourceOrder })),
    );
    expect(db.library.migrate(from, to, plan, 2000)).toBe(2);

    const items = list();
    expect(items.map((i) => i.title)).toEqual(['New Source']);
    expect(items[0]).toMatchObject({ categoryIds: [category.id], total: 3, unwatched: 2 });
    const target = db.episodes.list(to);
    expect(target.find((e) => e.number === 1)).toMatchObject({ watched: true, watchedAt: 900 });
    expect(target.find((e) => e.number === 2)).toMatchObject({
      watched: false,
      positionMs: 600_000,
      durationMs: 1_440_000,
    });
    expect(db.anime.get(to)).toMatchObject({ inLibrary: true, addedAt: 777 });
    expect(db.anime.get(from)).toMatchObject({ inLibrary: false, addedAt: null });
    expect(db.library.categoryIdsOf(from)).toEqual([]);
    // History follows to the matching episode, and the old anime keeps its watch session (statistics).
    expect(db.history.get(from)).toBeUndefined();
    expect(db.history.get(to)).toMatchObject({ episodeId: target.find((e) => e.number === 2)!.id, watchedAt: 950 });
    expect(db.sessions.get(session)).toBeDefined();
    expect(items[0]!.continue).toMatchObject({ reason: 'resume', number: 2 });
  });
});
