import type { DownloadItem, EpisodeRow } from '@matane-anime/shared';

/**
 * The episodes a right-click acts on: the whole selection when the row is part of it, otherwise just that row
 * (the selection is left alone). `selected` holds only listed ids, and `order` is the list as shown.
 */
export function menuTargetIds(selected: ReadonlySet<number>, order: readonly number[], episodeId: number): number[] {
  if (!selected.has(episodeId)) return [episodeId];
  return order.filter((id) => selected.has(id));
}

/** What the context menu of an episode row offers for its targets. The id lists are what each action applies to. */
export interface EpisodeMenu {
  /** Only for one episode. */
  play: boolean;
  markWatched: boolean;
  markUnwatched: boolean;
  /** Only for one episode: "everything before this one". */
  markPrevious: boolean;
  /** Targets with progress to lose; the reset item is shown always, and off when this is empty. */
  reset: number[];
  /** Episodes with no download yet. */
  download: number[];
  /** Downloads that failed. */
  retry: number[];
  /** Downloads that are queued, running or paused. */
  cancel: number[];
  /** Finished downloads: their files go. */
  remove: number[];
  /** The row's own select toggle. */
  select: 'select' | 'deselect';
}

/**
 * The menu for `targets`, in the same terms as the row buttons: the download button shows for an episode with no
 * download (unless its source lost it), retry for a failed one, and a finished one is deleted with its files.
 * With several targets an action shows when it applies to at least one of them.
 */
export function episodeMenu(
  targets: readonly EpisodeRow[],
  downloads: ReadonlyMap<number, DownloadItem>,
  rowSelected: boolean,
): EpisodeMenu {
  const single = targets.length === 1;
  const downloadsOf = (statuses: readonly DownloadItem['status'][]): number[] =>
    targets.flatMap((episode) => {
      const item = downloads.get(episode.id);
      return item && statuses.includes(item.status) ? [item.id] : [];
    });
  return {
    play: single,
    markWatched: targets.some((episode) => !episode.watched),
    markUnwatched: targets.some((episode) => episode.watched),
    markPrevious: single,
    reset: targets.filter((episode) => episode.positionMs > 0 || episode.watched).map(({ id }) => id),
    download: targets.filter((episode) => !downloads.has(episode.id) && !episode.sourceMissing).map(({ id }) => id),
    retry: downloadsOf(['error']),
    cancel: downloadsOf(['queued', 'downloading', 'paused']),
    remove: downloadsOf(['done']),
    select: rowSelected ? 'deselect' : 'select',
  };
}
