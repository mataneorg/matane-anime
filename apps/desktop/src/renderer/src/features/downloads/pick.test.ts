import type { DownloadItem, EpisodeRow } from '@matane-anime/shared';
import { describe, expect, it } from 'vitest';
import { pickEpisodes } from './pick';

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
const download = (status: DownloadItem['status']): DownloadItem => ({ status }) as DownloadItem;

// Newest first, as the list arrives.
const list = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((id) => episode(id, { watched: id <= 3 }));

describe('pickEpisodes', () => {
  it('takes the oldest unwatched episodes for "next"', () => {
    expect(pickEpisodes(list, 'next', new Map())).toEqual([4, 5, 6, 7, 8]);
  });
  it('takes every unwatched one, or every one', () => {
    expect(pickEpisodes(list, 'unwatched', new Map())).toEqual([10, 9, 8, 7, 6, 5, 4]);
    expect(pickEpisodes(list, 'all', new Map())).toHaveLength(10);
  });
  it('leaves out what the source removed and what is downloaded or queued', () => {
    const rows = [episode(3), episode(2, { sourceMissing: true }), episode(1)];
    const downloads = new Map([
      [3, download('done')],
      [1, download('error')],
    ]);
    expect(pickEpisodes(rows, 'all', downloads)).toEqual([1]);
    expect(pickEpisodes(rows, 'all', new Map([[1, download('queued')]]))).toEqual([3]);
  });
});
