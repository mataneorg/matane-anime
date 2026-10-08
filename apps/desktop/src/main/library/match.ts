export interface MatchEpisode {
  id: number;
  number: number | null;
  variant: string | null;
  name: string;
  /** 0 is the first (newest) in the source's list. */
  sourceOrder: number;
}

export interface WatchState {
  watched: boolean;
  watchedAt: number | null;
  positionMs: number;
  durationMs: number | null;
}

export type OldEpisode = MatchEpisode & WatchState;

/** Whether an episode has anything worth carrying over: it was watched or started. */
export const hasProgress = (episode: WatchState): boolean => episode.watched || episode.positionMs > 0;

export interface MigrationPair {
  from: number;
  to: number;
}

export interface MigrationPlan {
  /** One per new episode that receives progress, with the best state among the old episodes that map to it. */
  transfers: { to: number; state: WatchState; from: number[] }[];
  /** Old episodes with progress that no new episode corresponds to. */
  unmatched: OldEpisode[];
}

const normalized = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** The new episode an old one corresponds to: same number (same variant first), else the same name when there is no number. */
function counterpart(old: MatchEpisode, candidates: MatchEpisode[]): MatchEpisode | undefined {
  if (old.number !== null) {
    const sameNumber = candidates.filter((candidate) => candidate.number === old.number);
    return (
      sameNumber.find((candidate) => candidate.variant === old.variant) ??
      [...sameNumber].sort((a, b) => a.sourceOrder - b.sourceOrder)[0]
    );
  }
  return candidates.find(
    (candidate) => candidate.number === null && normalized(candidate.name) === normalized(old.name),
  );
}

/** Which of two states is further along: watched beats started, and a later position beats an earlier one. */
function furtherAlong(a: WatchState, b: WatchState): WatchState {
  if (a.watched !== b.watched) return a.watched ? a : b;
  return a.positionMs >= b.positionMs ? a : b;
}

/**
 * Plans moving progress from one source's episodes to another's, by episode **number** (docs/PRD.md BRW-8).
 * Variants of the same number map to the same new episode when the new source has fewer of them; the state that
 * is further along wins. Only episodes with progress matter: the rest has nothing to carry.
 */
export function planMigration(oldEpisodes: OldEpisode[], newEpisodes: MatchEpisode[]): MigrationPlan {
  const byTarget = new Map<number, { state: WatchState; from: number[] }>();
  const unmatched: OldEpisode[] = [];
  for (const old of oldEpisodes.filter(hasProgress)) {
    const target = counterpart(old, newEpisodes);
    if (!target) {
      unmatched.push(old);
      continue;
    }
    const state: WatchState = {
      watched: old.watched,
      watchedAt: old.watchedAt,
      positionMs: old.positionMs,
      durationMs: old.durationMs,
    };
    const existing = byTarget.get(target.id);
    if (existing) {
      byTarget.set(target.id, { state: furtherAlong(existing.state, state), from: [...existing.from, old.id] });
    } else {
      byTarget.set(target.id, { state, from: [old.id] });
    }
  }
  return {
    transfers: [...byTarget].map(([to, { state, from }]) => ({ to, state, from })),
    unmatched,
  };
}
