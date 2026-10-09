import type { DownloadItem, DownloadProgress } from '@matane-anime/shared';
import { describe, expect, it } from 'vitest';
import {
  applyReorder,
  groupByAnime,
  groupDownloads,
  mergeProgress,
  moveId,
  moveWithinAnime,
  pendingCount,
  stepWithinAnime,
  totalSpeed,
  withProgress,
} from './progress';

const tick = (id: number, over: Partial<DownloadProgress> = {}): DownloadProgress => ({
  id,
  episodeId: id * 10,
  status: 'downloading',
  segmentsDone: 1,
  segmentsTotal: 10,
  bytesDone: 100,
  sizeBytes: 1000,
  bytesPerSecond: 50,
  etaSeconds: 18,
  ...over,
});

const item = (id: number, status: DownloadItem['status'], over: Partial<DownloadItem> = {}): DownloadItem => ({
  id,
  episodeId: id * 10,
  animeId: 1,
  sourceId: 's',
  sourceName: 'S',
  animeTitle: 'Anime',
  thumbnailUrl: null,
  hasLocalCover: false,
  episodeNumber: id,
  episodeName: `Ep ${id}`,
  status,
  queueOrder: id,
  kind: 'hls',
  segmentsDone: 0,
  segmentsTotal: null,
  bytesDone: 0,
  sizeBytes: null,
  quality: null,
  server: null,
  error: null,
  createdAt: 0,
  completedAt: null,
  ...over,
});

describe('mergeProgress', () => {
  it('keeps the latest tick of each running download', () => {
    const first = mergeProgress({}, [tick(1), tick(2)]);
    const next = mergeProgress(first, [tick(1, { segmentsDone: 4 })]);
    expect(next[1]?.segmentsDone).toBe(4);
    expect(next[2]).toEqual(tick(2));
  });
  it('drops a download once its last tick says it is no longer running', () => {
    const running = mergeProgress({}, [tick(1), tick(2)]);
    const next = mergeProgress(running, [tick(1, { status: 'done' }), tick(2, { status: 'paused' })]);
    expect(next).toEqual({});
  });
  it('returns the same object for an empty batch, so nothing re-renders', () => {
    const current = mergeProgress({}, [tick(1)]);
    expect(mergeProgress(current, [])).toBe(current);
  });
  it('does not touch what it was given', () => {
    const current = mergeProgress({}, [tick(1)]);
    mergeProgress(current, [tick(1, { status: 'error' })]);
    expect(current[1]).toBeDefined();
  });
});

describe('withProgress', () => {
  it('shows live numbers and treats a ticking queued row as downloading', () => {
    const merged = withProgress(item(1, 'queued'), tick(1, { segmentsDone: 7, bytesDone: 700 }));
    expect(merged).toMatchObject({ status: 'downloading', segmentsDone: 7, bytesDone: 700, segmentsTotal: 10 });
  });
  it('ignores a late tick for a paused, failed or finished row', () => {
    for (const status of ['paused', 'error', 'done'] as const) {
      const row = item(1, status);
      expect(withProgress(row, tick(1))).toBe(row);
    }
  });
});

describe('groupDownloads', () => {
  it('splits the list into the page sections and keeps the order', () => {
    const groups = groupDownloads(
      [
        item(1, 'downloading'),
        item(2, 'queued'),
        item(3, 'queued'),
        item(4, 'paused'),
        item(5, 'error'),
        item(6, 'done'),
        item(7, 'queued'),
      ],
      { 7: tick(7) },
    );
    expect(groups.active.map((row) => row.id)).toEqual([1, 7]);
    expect(groups.queued.map((row) => row.id)).toEqual([2, 3]);
    expect(groups.paused.map((row) => row.id)).toEqual([4]);
    expect(groups.failed.map((row) => row.id)).toEqual([5]);
    expect(groups.done.map((row) => row.id)).toEqual([6]);
  });
});

describe('pendingCount and totalSpeed', () => {
  it('counts the running and waiting ones, and adds the speeds', () => {
    expect(
      pendingCount([item(1, 'downloading'), item(2, 'queued'), item(3, 'paused'), item(4, 'error'), item(5, 'done')]),
    ).toBe(2);
    expect(totalSpeed({ 1: tick(1, { bytesPerSecond: 10 }), 2: tick(2, { bytesPerSecond: 32 }) })).toBe(42);
    expect(totalSpeed({})).toBe(0);
  });
});

describe('moveId', () => {
  it('moves one id and leaves the rest in order', () => {
    expect(moveId([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
    expect(moveId([1, 2, 3, 4], 3, 1)).toEqual([1, 4, 2, 3]);
  });
  it('ignores moves that go nowhere', () => {
    expect(moveId([1, 2, 3], 1, 1)).toEqual([1, 2, 3]);
    expect(moveId([1, 2, 3], 0, 3)).toEqual([1, 2, 3]);
    expect(moveId([1, 2, 3], -1, 1)).toEqual([1, 2, 3]);
  });
});

describe('applyReorder', () => {
  it('puts the listed rows in the new order, in the places they held', () => {
    const items = [item(1, 'downloading'), item(2, 'queued'), item(3, 'queued'), item(4, 'queued'), item(5, 'error')];
    const next = applyReorder(items, [4, 2, 3]);
    expect(next.map((row) => row.id)).toEqual([1, 4, 2, 3, 5]);
    expect(next.map((row) => row.queueOrder)).toEqual([1, 2, 3, 4, 5]);
  });
  it('ignores ids that are not in the list', () => {
    const items = [item(1, 'queued'), item(2, 'queued')];
    expect(applyReorder(items, [2, 99, 1]).map((row) => row.id)).toEqual([2, 1]);
  });
});

describe('groupByAnime', () => {
  it("makes one group per anime, in order of first appearance, keeping each anime's order", () => {
    const items = [
      item(1, 'queued', { animeId: 20, animeTitle: 'B' }),
      item(2, 'queued', { animeId: 10, animeTitle: 'A' }),
      item(3, 'error', { animeId: 20, animeTitle: 'B' }),
    ];
    const groups = groupByAnime(items);
    expect(groups.map((group) => [group.animeId, group.title])).toEqual([
      [20, 'B'],
      [10, 'A'],
    ]);
    expect(groups[0]?.items.map((row) => row.id)).toEqual([1, 3]);
  });
  it('is empty for no downloads', () => {
    expect(groupByAnime([])).toEqual([]);
  });
});

describe('moveWithinAnime and stepWithinAnime', () => {
  // Queue order: A1 B2 A3 B4 A5 (the page shows A's rows 1, 3, 5 and B's rows 2, 4).
  const queued = [
    item(1, 'queued', { animeId: 1 }),
    item(2, 'queued', { animeId: 2 }),
    item(3, 'queued', { animeId: 1 }),
    item(4, 'queued', { animeId: 2 }),
    item(5, 'queued', { animeId: 1 }),
  ];
  it('moves a row to the place of another row of the same anime', () => {
    expect(moveWithinAnime(queued, 1, 5)).toEqual([2, 3, 4, 5, 1]);
    expect(moveWithinAnime(queued, 5, 3)).toEqual([1, 2, 5, 3, 4]);
  });
  it('refuses a drop on another anime, on itself, or on a row that is not queued', () => {
    expect(moveWithinAnime(queued, 1, 2)).toBeNull();
    expect(moveWithinAnime(queued, 1, 1)).toBeNull();
    expect(moveWithinAnime(queued, 1, 99)).toBeNull();
    expect(moveWithinAnime(queued, 99, 1)).toBeNull();
  });
  it('steps past the other anime rows to the neighbour the page shows', () => {
    expect(stepWithinAnime(queued, 3, -1)).toEqual([3, 1, 2, 4, 5]);
    expect(stepWithinAnime(queued, 3, 1)).toEqual([1, 2, 4, 5, 3]);
    expect(stepWithinAnime(queued, 2, 1)).toEqual([1, 3, 4, 2, 5]);
  });
  it('does nothing at the ends of an anime', () => {
    expect(stepWithinAnime(queued, 1, -1)).toBeNull();
    expect(stepWithinAnime(queued, 5, 1)).toBeNull();
    expect(stepWithinAnime(queued, 99, 1)).toBeNull();
  });
});
