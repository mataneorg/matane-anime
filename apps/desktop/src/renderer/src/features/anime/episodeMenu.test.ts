import type { DownloadItem, EpisodeRow } from '@matane-anime/shared';
import { describe, expect, it } from 'vitest';
import { episodeMenu, menuTargetIds } from './episodeMenu';

const episode = (id: number, over: Partial<EpisodeRow> = {}): EpisodeRow => ({
  id,
  animeId: 1,
  url: '',
  name: `Ep ${id}`,
  number: id,
  variant: null,
  uploadedAt: null,
  sourceOrder: id,
  watched: false,
  positionMs: 0,
  durationMs: null,
  sourceMissing: false,
  ...over,
});
// A download's id is its episode's id plus 100, so the two cannot be mixed up.
const download = (episodeId: number, status: DownloadItem['status']): [number, DownloadItem] => [
  episodeId,
  { id: episodeId + 100, episodeId, status } as DownloadItem,
];
const none = new Map<number, DownloadItem>();

describe('menuTargetIds', () => {
  const order = [5, 4, 3, 2, 1];
  it('acts on the row alone when it is not in the selection', () => {
    expect(menuTargetIds(new Set([4, 2]), order, 3)).toEqual([3]);
    expect(menuTargetIds(new Set(), order, 3)).toEqual([3]);
  });
  it('acts on the whole selection, in list order, when the row is part of it', () => {
    expect(menuTargetIds(new Set([2, 4, 1]), order, 2)).toEqual([4, 2, 1]);
  });
});

describe('episodeMenu', () => {
  it('offers play, "previous" and the watched toggle for a single unwatched episode', () => {
    const menu = episodeMenu([episode(1)], none, false);
    expect(menu).toMatchObject({ play: true, markPrevious: true, markWatched: true, markUnwatched: false });
    expect(menu.select).toBe('select');
  });
  it('offers "not watched" for a watched episode, and a reset only where there is progress', () => {
    expect(episodeMenu([episode(1, { watched: true })], none, false)).toMatchObject({
      markWatched: false,
      markUnwatched: true,
      reset: [1],
    });
    expect(episodeMenu([episode(1, { positionMs: 5000 })], none, false).reset).toEqual([1]);
    expect(episodeMenu([episode(1), episode(2, { positionMs: 5000 })], none, false).reset).toEqual([2]);
    expect(episodeMenu([episode(1)], none, false).reset).toEqual([]);
  });
  it('drops play and "previous" for several episodes, and offers each watched toggle that applies to one of them', () => {
    const menu = episodeMenu([episode(1), episode(2, { watched: true })], none, true);
    expect(menu).toMatchObject({ play: false, markPrevious: false, markWatched: true, markUnwatched: true });
    expect(menu.select).toBe('deselect');
  });
  it('offers a download for an episode with none, unless its source lost the episode', () => {
    expect(episodeMenu([episode(1)], none, false).download).toEqual([1]);
    expect(episodeMenu([episode(1, { sourceMissing: true })], none, false).download).toEqual([]);
  });
  it('follows the state of the download', () => {
    const downloads = new Map([
      download(1, 'queued'),
      download(2, 'downloading'),
      download(3, 'paused'),
      download(4, 'error'),
      download(5, 'done'),
    ]);
    const targets = [1, 2, 3, 4, 5, 6].map((id) => episode(id));
    expect(episodeMenu(targets, downloads, false)).toMatchObject({
      download: [6],
      cancel: [101, 102, 103],
      retry: [104],
      remove: [105],
    });
    expect(episodeMenu([episode(5)], downloads, false)).toMatchObject({
      download: [],
      cancel: [],
      retry: [],
      remove: [105],
    });
  });
  it('keeps a missing episode that still has a download', () => {
    const downloads = new Map([download(1, 'done')]);
    expect(episodeMenu([episode(1, { sourceMissing: true })], downloads, false)).toMatchObject({
      download: [],
      remove: [101],
    });
  });
});
