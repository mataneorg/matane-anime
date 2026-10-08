import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { purgeBrowseRows } from '../housekeeping';
import { seedLibrary } from '../seed';
import { type TestDb, createTestDb } from './helpers';

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(() => db.close());

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;

/** An anime row last touched `ageDays` ago, with `episodeCount` episodes. */
function browse(title: string, ageDays: number, episodeCount = 2): number {
  const [row] = db.anime.upsertSummaries('example/en', [{ url: `/${title}`, title }], NOW - ageDays * DAY);
  db.episodes.sync(
    row!.id,
    Array.from({ length: episodeCount }, (_, i) => ({ url: `/${title}/${i}`, name: `Ep ${i}`, number: i + 1 })),
    1,
  );
  return row!.id;
}
const ids = () =>
  (db.connection.sqlite.prepare('SELECT title FROM anime ORDER BY title').all() as { title: string }[]).map(
    (r) => r.title,
  );

describe('purgeBrowseRows', () => {
  it('drops listing rows nobody kept once they are old enough, with their episodes and search entries', () => {
    browse('Old', 20);
    browse('Recent', 3);
    const result = purgeBrowseRows(db.connection.sqlite, NOW);
    expect(result.deleted).toBe(1);
    expect(ids()).toEqual(['Recent']);
    expect(db.connection.sqlite.prepare('SELECT COUNT(*) AS n FROM episodes').get()).toEqual({ n: 2 });
    expect(
      db.connection.sqlite.prepare("SELECT COUNT(*) AS n FROM anime_fts WHERE anime_fts MATCH 'old'").get(),
    ).toEqual({ n: 0 });
  });

  it('never touches the library', () => {
    const id = browse('Kept', 90);
    db.library.add(id, [], NOW - 90 * DAY);
    db.connection.sqlite.prepare('UPDATE anime SET updated_at = ? WHERE id = ?').run(NOW - 90 * DAY, id);
    expect(purgeBrowseRows(db.connection.sqlite, NOW).deleted).toBe(0);
  });

  it('keeps anything the user did: history, a watched or started episode, a watch session', () => {
    const history = browse('InHistory', 30);
    db.history.touch(history, db.episodes.list(history)[0]!.id, NOW - 30 * DAY);
    const watched = browse('Watched', 30);
    db.episodes.setWatched([db.episodes.list(watched)[0]!.id], true);
    const started = browse('Started', 30);
    db.episodes.saveProgress(db.episodes.list(started)[0]!.id, 4000, 100_000);
    const session = browse('Session', 30);
    db.sessions.start(session, db.episodes.list(session)[0]!.id, NOW - 30 * DAY);
    browse('Untouched', 30);
    // The progress writes above updated the rows' timestamps; the purge looks at age only.
    db.connection.sqlite.prepare('UPDATE anime SET updated_at = ?').run(NOW - 30 * DAY);
    expect(purgeBrowseRows(db.connection.sqlite, NOW).deleted).toBe(1);
    expect(ids()).toEqual(['InHistory', 'Session', 'Started', 'Watched']);
  });

  it('keeps an anime that has a download, whatever its status', () => {
    const downloaded = browse('Downloaded', 30);
    db.connection.sqlite
      .prepare(
        `INSERT INTO downloads (episode_id, status, queue_order, kind, created_at) VALUES (?, 'queued', 1, 'hls', 1)`,
      )
      .run(db.episodes.list(downloaded)[0]!.id);
    browse('Plain', 30);
    db.connection.sqlite.prepare('UPDATE anime SET updated_at = ?').run(NOW - 30 * DAY);
    expect(purgeBrowseRows(db.connection.sqlite, NOW).deleted).toBe(1);
    expect(ids()).toEqual(['Downloaded']);
    expect(db.downloads.list()).toHaveLength(1);
  });

  it('reports the covers of what it deleted, and does nothing when there is nothing to do', () => {
    const id = browse('WithCover', 40);
    db.anime.setCoverPath(id, '/tmp/cover.jpg');
    db.connection.sqlite.prepare('UPDATE anime SET updated_at = ? WHERE id = ?').run(NOW - 40 * DAY, id);
    expect(purgeBrowseRows(db.connection.sqlite, NOW)).toEqual({ deleted: 1, coverPaths: ['/tmp/cover.jpg'] });
    expect(purgeBrowseRows(db.connection.sqlite, NOW)).toEqual({ deleted: 0, coverPaths: [] });
  });
});

describe('seedLibrary', () => {
  it('fills the library with the requested amount, half with history', () => {
    seedLibrary(db.connection.sqlite, 10, 8);
    expect(db.library.count()).toBe(10);
    expect(db.connection.sqlite.prepare('SELECT COUNT(*) AS n FROM episodes').get()).toEqual({ n: 80 });
    expect(db.connection.sqlite.prepare('SELECT COUNT(*) AS n FROM history').get()).toEqual({ n: 5 });
    seedLibrary(db.connection.sqlite, 5, 2);
    expect(db.library.count()).toBe(15);
  });
});
