// Pure helpers: no host globals except `URL`, so they can be unit-tested directly.
import type { AnimeStatus, AnimeType } from '@matane-anime/extension-sdk';

/** The identity of an anime or an episode: its path on the site, with a trailing slash and no host or query. */
export function entityPath(href: string, base: string): string {
  const { pathname } = new URL(href, `${base}/`);
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

export const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** The cover without the `?resize=246,350` thumbnail query of the image CDN. */
export const fullCover = (url: string | undefined): string | undefined => url?.replace(/\?resize=[\d,]+$/, '');

export function parseStatus(text: string): AnimeStatus {
  const value = text.toLowerCase();
  if (value.includes('ongoing')) return 'ongoing';
  if (value.includes('completed')) return 'completed';
  return 'unknown';
}

/** "Anime", "Movie", "Special", "TV Show". */
export function parseType(text: string): AnimeType | undefined {
  const value = text.trim().toLowerCase();
  if (value === 'movie') return 'movie';
  if (value === 'special') return 'special';
  if (value === 'anime' || value === 'tv show') return 'tv';
  return undefined;
}

/** The year in "Mar 19, 2026 to ?". */
export function releaseYear(text: string | undefined): number | undefined {
  const year = Number(/\b(\d{4})\b/.exec(text ?? '')?.[1]);
  return year >= 1900 && year <= 2200 ? year : undefined;
}

/** A dub is a separate series and separate episodes, named "…english-dubbed…" / "…dubbed". */
export const isDub = (path: string): boolean => /dubbed/i.test(path);

/** The episode number at the end of the text or url ("Episode 4", "…-episode-4-english-subbed/"). */
export function parseNumber(text: string): number | undefined {
  const match = /episode[\s-]+(\d+(?:\.\d+)?)/i.exec(text);
  return match ? Number.parseFloat(match[1] as string) : undefined;
}
