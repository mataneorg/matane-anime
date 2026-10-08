import type { DownloadItem, EpisodeRow } from '@matane-anime/shared';

export type DownloadScope = 'next' | 'unwatched' | 'all';

/** How many episodes "next" asks for. */
export const NEXT_COUNT = 5;

/** The download of an episode, unless it failed: a failed one can be queued again. */
export const isTaken = (item: DownloadItem | undefined): boolean => item !== undefined && item.status !== 'error';

/**
 * Which episodes a "Download" choice means: not the ones the source removed, nor those already downloaded or
 * waiting. The list is newest first, so "next" takes the oldest unwatched ones.
 */
export function pickEpisodes(
  episodes: readonly EpisodeRow[],
  scope: DownloadScope,
  downloads: ReadonlyMap<number, DownloadItem>,
): number[] {
  const wanted = episodes.filter(
    (episode) => !episode.sourceMissing && !isTaken(downloads.get(episode.id)) && (scope === 'all' || !episode.watched),
  );
  const ids = wanted.map((episode) => episode.id);
  return scope === 'next' ? ids.reverse().slice(0, NEXT_COUNT) : ids;
}
