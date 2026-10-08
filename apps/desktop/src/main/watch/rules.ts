// The rules of watching, as plain functions so they can be tested without a database (docs/PRD.md §6.6).

export { type CountableEpisode, countEpisodes } from '@matane-anime/shared';

export const DEFAULT_THRESHOLD = 85;
/** A saved position at or below this counts as "not started" (PRG-4). */
export const RESUME_MIN_MS = 10_000;
/** Resuming goes back a little so the scene before is not lost (PRG-4). */
export const RESUME_REWIND_MS = 3000;
/** Playing for less than this does not put an anime in the history (a mis-click is not watching). */
export const HISTORY_MIN_ACTIVE_MS = 5000;
/** Between two progress reports at most this much counts as playing time (a stall must not inflate it). */
export const MAX_ACTIVE_STEP_MS = 15_000;

/**
 * Whether an episode counts as watched (PRG-3). `thresholdPercent` is 50–100; 100 means only when the video
 * ends. A finished video is always watched.
 */
export function reachedThreshold(
  positionMs: number,
  durationMs: number | null,
  thresholdPercent: number,
  ended: boolean,
): boolean {
  if (ended) return true;
  if (durationMs === null || durationMs <= 0 || thresholdPercent >= 100) return false;
  return (positionMs / durationMs) * 100 >= thresholdPercent;
}

export interface Progress {
  positionMs: number;
  durationMs: number | null;
  watched: boolean;
}

/**
 * Where playback starts for an episode (PRG-4): three seconds before the saved position, if it is more than
 * ten seconds in and short of the watched threshold; otherwise the beginning.
 */
export function resumePosition(progress: Progress, thresholdPercent: number): number {
  if (progress.watched || progress.positionMs <= RESUME_MIN_MS) return 0;
  if (reachedThreshold(progress.positionMs, progress.durationMs, thresholdPercent, false)) return 0;
  return Math.max(0, progress.positionMs - RESUME_REWIND_MS);
}

export interface OrderedEpisode {
  id: number;
  number: number | null;
  variant: string | null;
  /** 0 is the first (newest) in the source's list. */
  sourceOrder: number;
}

/** Watching order: by number; episodes without one fall back to the source's order (newest first, so higher is earlier). */
export function watchOrder(a: OrderedEpisode, b: OrderedEpisode): number {
  if (a.number !== null && b.number !== null && a.number !== b.number) return a.number - b.number;
  return b.sourceOrder - a.sourceOrder;
}
