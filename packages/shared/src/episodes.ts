// Episode counting, shared by main (the library list) and the renderer (the detail page), so a card and the
// page it opens always agree.

export interface CountableEpisode {
  id: number;
  number: number | null;
  watched: boolean;
  sourceMissing: boolean;
}

/**
 * Episode counts per **number**, not per row (PRG-5): Sub and Dub of episode 3 are one episode, and an
 * episode without a number counts on its own. Episodes the source no longer lists are not counted.
 */
export function countEpisodes(episodes: CountableEpisode[]): { total: number; unwatched: number } {
  const total = new Set<number | string>();
  const unwatched = new Set<number | string>();
  for (const episode of episodes) {
    if (episode.sourceMissing) continue;
    const key = episode.number ?? `row-${episode.id}`;
    total.add(key);
    if (!episode.watched) unwatched.add(key);
  }
  return { total: total.size, unwatched: unwatched.size };
}
