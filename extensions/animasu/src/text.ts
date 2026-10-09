// Pure helpers: no host globals except `URL`, so they can be unit-tested directly.
import type { AnimeStatus, AnimeType } from '@matane-anime/extension-sdk';

/** The identity of an anime or an episode: its path on the site, with a trailing slash and no host or query. */
export function entityPath(href: string, base: string): string {
  const { pathname } = new URL(href, `${base}/`);
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

export const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** "Sedang Tayang 🔥" / "Selesai" and the like. */
export function parseStatus(text: string): AnimeStatus {
  const value = text.toLowerCase();
  if (value.includes('sedang') || value.includes('ongoing')) return 'ongoing';
  if (value.includes('selesai') || value.includes('completed')) return 'completed';
  if (value.includes('hiatus')) return 'hiatus';
  return 'unknown';
}

/** "Serial TV", "Movie", "OVA"… */
export function parseType(text: string): AnimeType | undefined {
  const value = text.toLowerCase();
  if (value.includes('movie')) return 'movie';
  if (value.includes('ova')) return 'ova';
  if (value.includes('ona')) return 'ona';
  if (value.includes('special')) return 'special';
  if (value.includes('serial') || value === 'tv') return 'tv';
  return undefined;
}

/** The year in "Okt 1, 2026". */
export function releaseYear(text: string | undefined): number | undefined {
  const year = Number(/\b(\d{4})\b/.exec(text ?? '')?.[1]);
  return year >= 1900 && year <= 2200 ? year : undefined;
}

/** The title without the site's " Sub Indo" suffix. */
export const cleanTitle = (title: string): string => collapse(title).replace(/\s+Sub(?:title)?\s+Indo(?:nesia)?$/i, '');

/** "Episode 12" → 12, "12.5" → 12.5; "Movie" and the like have none. */
export function parseNumber(text: string): number | undefined {
  const match = /(\d+(?:\.\d+)?)/.exec(text);
  return match ? Number.parseFloat(match[1] as string) : undefined;
}
