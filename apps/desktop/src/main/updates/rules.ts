// The rules of the update checker as plain functions, so they can be tested without a database
// (docs/PRD.md UPD-3, DL-11).

import { type CountableEpisode, countEpisodes } from '@matane-anime/shared';

export interface SkipRules {
  updateSkipCompleted: boolean;
  updateSkipNotStarted: boolean;
  /** Null turns the rule off. */
  updateSkipUnwatchedOver: number | null;
}

export interface SkipSubject {
  status: string;
  hasHistory: boolean;
  hasSession: boolean;
  episodes: (CountableEpisode & { positionMs: number })[];
}

export type SkipReason = 'completed' | 'not_started' | 'too_many_unwatched';

/**
 * Why a library or category check leaves this anime out, or null if it is checked (UPD-3). A check of a single
 * anime never asks: the user named it.
 */
export function skipReason(subject: SkipSubject, rules: SkipRules): SkipReason | null {
  if (rules.updateSkipCompleted && subject.status === 'completed') return 'completed';
  if (rules.updateSkipNotStarted && !hasStarted(subject)) return 'not_started';
  if (
    rules.updateSkipUnwatchedOver !== null &&
    countEpisodes(subject.episodes).unwatched > rules.updateSkipUnwatchedOver
  ) {
    return 'too_many_unwatched';
  }
  return null;
}

/** Watched, started, in the history or ever played: any of them means the user has begun this anime. */
function hasStarted(subject: SkipSubject): boolean {
  return (
    subject.hasHistory ||
    subject.hasSession ||
    subject.episodes.some((episode) => episode.watched || episode.positionMs > 0)
  );
}

export type AutoDownloadMode = 'include' | 'exclude';

/**
 * Whether new episodes of an anime may be downloaded on their own (DL-11), given the include/exclude marks of
 * categories. **Exclude always wins.** With no category marked `include` everything not excluded is allowed
 * (the setting is simply "on"); once any category is marked `include`, only anime in an included category are
 * (an anime in no category is then not).
 */
export function autoDownloadAllowed(categoryIds: number[], modes: ReadonlyMap<number, AutoDownloadMode>): boolean {
  if (categoryIds.some((id) => modes.get(id) === 'exclude')) return false;
  const anyIncluded = [...modes.values()].includes('include');
  return !anyIncluded || categoryIds.some((id) => modes.get(id) === 'include');
}

export interface NumberedEpisode {
  episodeId: number;
  animeId: number;
  number: number | null;
  sourceOrder: number;
}

/**
 * One episode per anime and number: Sub and Dub of episode 5 are one episode to the user (PRG-5), so the
 * checker counts it once and downloads one copy, the variant the source lists first. An episode without a
 * number stands alone.
 */
export function onePerNumber<T extends NumberedEpisode>(episodes: T[]): T[] {
  const best = new Map<string, T>();
  for (const episode of episodes) {
    const key = episode.number === null ? `row-${episode.episodeId}` : `${episode.animeId}:${episode.number}`;
    const current = best.get(key);
    if (!current || episode.sourceOrder < current.sourceOrder) best.set(key, episode);
  }
  return [...best.values()];
}
