import { DEFAULT_SETTINGS } from '@matane-anime/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from './helpers';

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(() => db.close());

function episodesOf(title: string, count: number): number[] {
  const [row] = db.anime.upsertSummaries('example/en', [{ url: `/${title}`, title }]);
  db.episodes.sync(
    row!.id,
    Array.from({ length: count }, (_, i) => ({ url: `/${title}/${i + 1}`, name: `Episode ${i + 1}`, number: i + 1 })),
    100,
  );
  const rows = db.connection.sqlite
    .prepare('SELECT id FROM episodes WHERE anime_id = ? ORDER BY number')
    .all(row!.id) as { id: number }[];
  return rows.map((r) => r.id);
}

function insert(episodeId: number, status: string, order: number, bytes = 0): void {
  db.connection.sqlite
    .prepare(
      `INSERT INTO downloads (episode_id, status, queue_order, kind, bytes_done, created_at) VALUES (?, ?, ?, 'hls', ?, 1)`,
    )
    .run(episodeId, status, order, bytes);
}

describe('DownloadsRepository', () => {
  it('lists the queue in order, with the finished ones last, and what the page shows for each', () => {
    const [a1, a2, a3] = episodesOf('Alpha', 3) as [number, number, number];
    insert(a1, 'done', 1);
    insert(a2, 'queued', 5);
    insert(a3, 'downloading', 2);

    const items = db.downloads.list();
    expect(items.map((i) => [i.episodeId, i.status])).toEqual([
      [a3, 'downloading'],
      [a2, 'queued'],
      [a1, 'done'],
    ]);
    expect(items[0]).toMatchObject({
      animeTitle: 'Alpha',
      episodeNumber: 3,
      episodeName: 'Episode 3',
      sourceId: 'example/en',
      sourceName: 'Example (EN)',
      hasLocalCover: false,
      segmentsDone: 0,
      kind: 'hls',
    });
  });

  it('adds up what is saved, and counts by status', () => {
    const [a1, a2, a3] = episodesOf('Beta', 3) as [number, number, number];
    insert(a1, 'done', 1, 500);
    insert(a2, 'paused', 2, 120);
    insert(a3, 'error', 3, 30);
    expect(db.downloads.usedBytes()).toBe(650);
    expect(db.downloads.counts()).toEqual({ downloading: 0, queued: 0, paused: 1, error: 1, done: 1 });
  });

  it('goes away with its episode', () => {
    const [a1] = episodesOf('Gamma', 1) as [number];
    insert(a1, 'queued', 1);
    expect(db.downloads.byEpisode(a1)).toBeDefined();
    db.connection.sqlite.prepare('DELETE FROM episodes WHERE id = ?').run(a1);
    expect(db.downloads.list()).toEqual([]);
  });
});

describe('DownloadsRepository writes (the engine)', () => {
  it('queues at the end, takes the next in order, and says what it touched', () => {
    const [a1, a2, a3] = episodesOf('Delta', 3) as [number, number, number];
    db.emitted.length = 0;
    const first = db.downloads.insert({ episodeId: a1, kind: 'hls', sizeBytes: 500, now: 10 });
    const second = db.downloads.insert({ episodeId: a2, kind: 'mp4', sizeBytes: null, now: 11 });
    db.downloads.insert({ episodeId: a3, kind: 'hls', sizeBytes: null, now: 12 });
    expect(db.emitted.flat()).toEqual(['downloads', 'downloads', 'downloads']);
    expect(db.downloads.get(first)).toMatchObject({ status: 'queued', queueOrder: 1, sizeBytes: 500, createdAt: 10 });
    expect(db.downloads.nextQueued()?.id).toBe(first);
    db.downloads.update(first, { status: 'done' });
    expect(db.downloads.nextQueued()?.id).toBe(second);
    expect(db.downloads.all().map((r) => r.id)).toEqual([first, second, second + 1]);
  });

  it('saves progress without telling the renderer, and status changes with it', () => {
    const [a1] = episodesOf('Epsilon', 1) as [number];
    const id = db.downloads.insert({ episodeId: a1, kind: 'hls', sizeBytes: null, now: 1 });
    db.emitted.length = 0;
    db.downloads.update(id, { segmentsDone: 4, bytesDone: 400 }, { silent: true });
    expect(db.emitted).toEqual([]);
    db.downloads.update(id, { status: 'error', error: 'http_404' });
    expect(db.emitted).toEqual([['downloads']]);
    expect(db.downloads.get(id)).toMatchObject({ segmentsDone: 4, bytesDone: 400, status: 'error', error: 'http_404' });
    db.downloads.update(id, {});
    expect(db.emitted).toHaveLength(1);
  });

  it('puts what was running back in the queue after a crash', () => {
    const [a1, a2, a3] = episodesOf('Zeta', 3) as [number, number, number];
    insert(a1, 'downloading', 1);
    insert(a2, 'paused', 2);
    insert(a3, 'error', 3);
    expect(db.downloads.recoverInterrupted()).toBe(1);
    expect(db.downloads.list().map((i) => i.status)).toEqual(['queued', 'paused', 'error']);
    expect(db.downloads.recoverInterrupted()).toBe(0);
  });

  it('reorders the given ones in the places they held, leaving the others alone', () => {
    const ids = episodesOf('Eta', 4).map((episodeId, i) =>
      db.downloads.insert({ episodeId, kind: 'hls', sizeBytes: null, now: i }),
    );
    const [a, b, c, d] = ids as [number, number, number, number];
    db.downloads.reorder([d, b]);
    expect(db.downloads.all().map((r) => r.id)).toEqual([a, d, c, b]);
    db.downloads.reorder([c, 999, a]);
    expect(db.downloads.all().map((r) => r.id)).toEqual([c, d, a, b]);
  });

  it('adds up what is saved and what is still to come, for the size limit', () => {
    const [a1, a2, a3, a4] = episodesOf('Theta', 4) as [number, number, number, number];
    const done = db.downloads.insert({ episodeId: a1, kind: 'hls', sizeBytes: 900, now: 1 });
    db.downloads.update(done, { status: 'done', bytesDone: 1000 });
    const running = db.downloads.insert({ episodeId: a2, kind: 'hls', sizeBytes: 5000, now: 1 });
    db.downloads.update(running, { status: 'downloading', bytesDone: 2000 });
    db.downloads.insert({ episodeId: a3, kind: 'hls', sizeBytes: 300, now: 1 });
    db.downloads.insert({ episodeId: a4, kind: 'hls', sizeBytes: null, now: 1 });
    expect(db.downloads.committedBytes()).toBe(1000 + 5000 + 300);
    // `usedBytes` is only what is on disk.
    expect(db.downloads.usedBytes()).toBe(3000);
  });

  it('deletes rows and rewrites paths together', () => {
    const [a1, a2] = episodesOf('Iota', 2) as [number, number];
    const x = db.downloads.insert({ episodeId: a1, kind: 'hls', sizeBytes: null, now: 1 });
    const y = db.downloads.insert({ episodeId: a2, kind: 'hls', sizeBytes: null, now: 1 });
    db.downloads.rewritePaths([
      { id: x, path: '/new/x' },
      { id: y, path: '/new/y' },
    ]);
    expect([db.downloads.get(x)?.path, db.downloads.get(y)?.path]).toEqual(['/new/x', '/new/y']);
    db.downloads.delete([x]);
    db.downloads.delete([]);
    expect(db.downloads.get(x)).toBeUndefined();
    expect(db.downloads.get(y)).toBeDefined();
  });
});

describe('update check columns and the new settings', () => {
  it('starts an anime without a check or an error', () => {
    const [row] = db.anime.upsertSummaries('example/en', [{ url: '/x', title: 'X' }]);
    const stored = db.connection.sqlite
      .prepare('SELECT update_checked_at AS checkedAt, update_error AS error FROM anime WHERE id = ?')
      .get(row!.id);
    expect(stored).toEqual({ checkedAt: null, error: null });
  });

  it('reads and writes the download and update settings, falling back to the defaults', () => {
    expect(db.settings.getAppSettings()).toMatchObject({
      downloadFolder: null,
      downloadParallelSegments: 6,
      updateIntervalHours: 12,
      updateSkipUnwatchedOver: 10,
      autoDownload: false,
    });
    db.settings.updateAppSettings({ updateIntervalHours: 48, updateSkipUnwatchedOver: null, downloadFolder: '/tmp/x' });
    expect(db.settings.getAppSettings()).toMatchObject({
      ...DEFAULT_SETTINGS,
      updateIntervalHours: 48,
      updateSkipUnwatchedOver: null,
      downloadFolder: '/tmp/x',
    });
  });
});
