import { type OrderedEpisode, type Progress, resumePosition, watchOrder } from './rules';

export interface ContinueEpisode extends OrderedEpisode, Progress {
  sourceMissing: boolean;
}

export type ContinueReason = 'resume' | 'next' | 'first';

export interface ContinueTarget<T extends ContinueEpisode> {
  episode: T;
  reason: ContinueReason;
  /** Where to start playing. */
  resumeMs: number;
}

/**
 * "Continue watching" (PRG-6):
 * 1. the last episode that was opened, if it is not finished: carry on;
 * 2. if it is finished: the next unwatched episode by number (in the same variant, so Sub does not flip to Dub);
 *    when nothing is left after it, the earliest one that was skipped; when everything is watched, nothing;
 * 3. never watched: the first episode.
 * Episodes the source no longer lists cannot be played and are skipped.
 */
export function continueTarget<T extends ContinueEpisode>(
  episodes: T[],
  lastEpisodeId: number | null,
  thresholdPercent: number,
): ContinueTarget<T> | null {
  const playable = episodes.filter((episode) => !episode.sourceMissing);
  const opened = lastEpisodeId === null ? undefined : playable.find((episode) => episode.id === lastEpisodeId);

  if (opened && !opened.watched) {
    return { episode: opened, reason: 'resume', resumeMs: resumePosition(opened, thresholdPercent) };
  }
  // Where "next" is counted from: the last opened episode, or, when the history does not have it (it was
  // dropped by the source, or only marked watched), the latest episode that is watched.
  const anchor =
    opened ??
    [...playable]
      .filter((episode) => episode.watched)
      .sort(watchOrder)
      .at(-1);
  if (anchor) {
    const pool = playable.filter((episode) => episode.variant === anchor.variant && !episode.watched).sort(watchOrder);
    const next = pool.find((episode) => watchOrder(episode, anchor) > 0) ?? pool[0];
    return next ? { episode: next, reason: 'next', resumeMs: resumePosition(next, thresholdPercent) } : null;
  }
  const first = [...playable].sort(watchOrder)[0];
  return first ? { episode: first, reason: 'first', resumeMs: resumePosition(first, thresholdPercent) } : null;
}
