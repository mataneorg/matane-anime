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
