// Pure helpers: no host globals except `URL`, so they can be unit-tested directly.
import type { AnimeStatus, AnimeType } from '@matane-anime/extension-sdk';

/** The identity of a series: its path on the site, with a trailing slash and no host, query or fragment. */
export function entityPath(href: string, base: string): string {
  const { pathname } = new URL(href, `${base}/`);
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

export const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** The catalogue's `status` values (AniList names) and their labels. */
export const STATUSES: Record<string, string> = {
  RELEASING: 'Ongoing',
  FINISHED: 'Finished',
  NOT_YET_RELEASED: 'Upcoming',
};

export const FORMATS = [
  ['TV', 'TV Series'],
  ['MOVIE', 'Movie'],
  ['ONA', 'ONA'],
  ['OVA', 'OVA'],
  ['SPECIAL', 'Special'],
  ['TV_SHORT', 'TV Short'],
  ['MUSIC', 'Music'],
] as const;

export const SORTS = [
  ['', 'Popular'],
  ['updated', 'Last updated'],
  ['newest', 'Newest'],
  ['rating', 'Rating'],
  ['title', 'A-Z'],
] as const;

/** "Tamat" / "Ongoing" / "Segera tayang". */
export function parseStatus(text: string): AnimeStatus {
  const value = text.toLowerCase();
  if (value.includes('ongoing')) return 'ongoing';
  if (value.includes('tamat') || value.includes('finished') || value.includes('completed')) return 'completed';
  return 'unknown';
}

/** "TV Series", "Movie", "OVA"… */
export function parseType(text: string): AnimeType | undefined {
  const value = text.toLowerCase();
  if (value.includes('movie')) return 'movie';
  if (value.includes('ova')) return 'ova';
  if (value.includes('ona')) return 'ona';
  if (value.includes('special')) return 'special';
  if (value.includes('tv')) return 'tv';
  return undefined;
}

export function parseYear(text: string | undefined): number | undefined {
  const year = Number(/\b(\d{4})\b/.exec(text ?? '')?.[1]);
  return year >= 1900 && year <= 2200 ? year : undefined;
}

/**
 * The poster as a plain file: the card's `img@src` is `/_next/image/?url=%2Fassets%2F…%2F<hash>.jpg&w=3840&q=75`
 * (a resizing proxy asked for the biggest size); the file behind it is served as it is.
 */
export function posterUrl(base: string, src: string | undefined): string | undefined {
  if (!src) return undefined;
  const inner = /[?&]url=([^&]+)/.exec(src)?.[1];
  const path = inner ? decodeURIComponent(inner) : src;
  if (!path.startsWith('/') && !/^https?:\/\//i.test(path)) return undefined;
  return new URL(path, `${base}/`).href;
}

/** "<series path>#episode-<n>": a stable identity for an episode that has no page of its own. */
export const episodeUrl = (seriesPath: string, number: number): string => `${seriesPath}#episode-${number}`;

/** The series path and number of an episode url. */
export function splitEpisodeUrl(url: string): { series: string; number: number } | undefined {
  const match = /^(.+?)#episode-(\d+(?:\.\d+)?)$/.exec(url);
  return match ? { series: match[1] as string, number: Number.parseFloat(match[2] as string) } : undefined;
}

/** The height in a quality label ("720p" → 720). */
export function labelHeight(label: string | null | undefined): number | undefined {
  const height = /(\d{3,4})\s*p\b/i.exec(label ?? '')?.[1];
  return height ? Number(height) : undefined;
}
