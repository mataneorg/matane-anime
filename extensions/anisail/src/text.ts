// Pure helpers: no host globals except `URL`, so they can be unit-tested directly.
import type { AnimeStatus, AnimeType } from '@matane-anime/extension-sdk';

/** The identity of an anime or an episode: its path on the site, with a trailing slash and no host or query. */
export function entityPath(href: string, base: string): string {
  const { pathname } = new URL(href, `${base}/`);
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

export const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** "Tokyo Revengers Subtitle Indonesia" → "Tokyo Revengers". */
export const seriesTitle = (title: string): string => collapse(title).replace(/\s+Subtitle Indonesia$/i, '');

/** "Tokyo Revengers Episode 24 Subtitle Indonesia" → "Tokyo Revengers". */
export const titleOfEpisode = (title: string): string => seriesTitle(title).replace(/\s+Episode\s+\d+(?:\.\d+)?$/i, '');

/** "/tokyo-revengers-episode-24/" → "/anime/tokyo-revengers/"; null for any other path. */
export function seriesOfEpisode(path: string): string | null {
  const match = /^\/([^/]+?)-episode-\d+(?:\.\d+)?\/?$/.exec(path);
  return match ? `/anime/${match[1]}/` : null;
}

/** The number in "… Episode 24 Subtitle Indonesia". */
export function parseNumber(text: string): number | undefined {
  const match = /Episode\s+(\d+(?:\.\d+)?)/i.exec(text);
  return match ? Number.parseFloat(match[1] as string) : undefined;
}

export function parseStatus(text: string): AnimeStatus {
  const value = text.toLowerCase();
  if (value.includes('ongoing')) return 'ongoing';
  if (value.includes('completed')) return 'completed';
  if (value.includes('hiatus')) return 'hiatus';
  return 'unknown';
}

export function parseType(text: string): AnimeType | undefined {
  const value = text.trim().toLowerCase();
  if (value === 'tv') return 'tv';
  if (value === 'movie') return 'movie';
  if (value === 'ova') return 'ova';
  if (value === 'ona') return 'ona';
  if (value === 'special') return 'special';
  return undefined;
}

export function parseYear(text: string | undefined): number | undefined {
  const year = Number(/\b(\d{4})\b/.exec(text ?? '')?.[1]);
  return year >= 1900 && year <= 2200 ? year : undefined;
}

/** The height in a server label ("pixel 720p" → 720). */
export function labelHeight(label: string): number | undefined {
  const height = /(\d{3,4})\s*p\b/i.exec(label)?.[1];
  return height ? Number(height) : undefined;
}
