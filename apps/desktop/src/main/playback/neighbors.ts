export interface EpisodeLike {
  id: number;
  number: number | null;
  variant: string | null;
  /** 0 is the first (newest) in the source's list. */
  sourceOrder: number;
}

/**
 * The episode after and before `currentId` in watching order. Episodes of other variants (the Dub of a
 * Sub) are skipped, so Next never flips between them; episodes without a number fall back to the source's
 * order (the list is newest first, so a higher `sourceOrder` is earlier).
 */
export function neighbors<T extends EpisodeLike>(
  episodes: T[],
  currentId: number,
): { next: T | null; previous: T | null } {
  const current = episodes.find((episode) => episode.id === currentId);
  if (!current) return { next: null, previous: null };
  const pool = episodes.filter((episode) => episode.variant === current.variant);
  const ordered = [...pool].sort((a, b) => {
    if (a.number !== null && b.number !== null && a.number !== b.number) return a.number - b.number;
    return b.sourceOrder - a.sourceOrder;
  });
  const at = ordered.findIndex((episode) => episode.id === currentId);
  return { next: ordered[at + 1] ?? null, previous: ordered[at - 1] ?? null };
}
