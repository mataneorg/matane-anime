// Pure helpers: no host globals except `URL`, so they can be unit-tested directly.

/** The identity of an anime or an episode: its path on the site, always with a trailing slash ("/anime/one-piece/"). */
export function entityPath(href: string, base: string): string {
  const { pathname } = new URL(href, `${base}/`);
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

export const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** "/one-piece-episode-1151/" → "/anime/one-piece/"; null for any other path. */
export function seriesOfEpisode(path: string): string | null {
  const match = /^\/([^/]+?)-episode-[^/]+\/$/.exec(path);
  return match ? `/anime/${match[1]}/` : null;
}

/** The number in an episode path or link text ("000", "05", "12.5"): leading zeros are dropped. */
export function parseNumber(text: string | undefined): number | undefined {
  const match = /^\s*(\d+(?:\.\d+)?)\s*$/.exec(text ?? '');
  return match ? Number.parseFloat(match[1] as string) : undefined;
}

/** The episode number at the end of an episode path ("/x-episode-05/" → 5; "/x-episode-4-5/" → 4.5). */
export function numberOfPath(path: string): number | undefined {
  const match = /-episode-(\d+)(?:-(\d+))?\/$/.exec(path);
  if (!match) return undefined;
  return Number.parseFloat(match[2] ? `${match[1]}.${match[2]}` : (match[1] as string));
}

/** A pager link `.../page/<n>/` exists for the page after `current`. */
export const hasPageLink = (hrefs: string[], current: number): boolean =>
  hrefs.some((href) => new RegExp(`/page/${current + 1}/?$`).test(href));
