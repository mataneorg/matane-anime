// Pure helpers: no host globals except `URL`, so they can be unit-tested directly.
import type { AnimeStatus, AnimeType } from '@matane-anime/extension-sdk';

/**
 * The identity of an anime or an episode: its path on the site ("/one-piece", "/one-piece-episode-3"), with no
 * host, query or trailing slash, so a link on a mirror and on the main domain are the same entity.
 */
export function entityPath(href: string, base: string): string {
  const { pathname } = new URL(href, `${base}/`);
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

export const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** The series path of an episode path: "/one-piece-episode-3" → "/one-piece"; null for a series path. */
export function seriesOfEpisode(path: string): string | null {
  const match = /^(\/.+?)-episode-\d+(?:\.\d+)?$/.exec(path);
  return match ? (match[1] as string) : null;
}

/** The series path of an episode path in either form: "/x-episode-3" or "/x-3". */
export const episodeSeries = (path: string): string => path.replace(/(?:-episode)?-\d+(?:\.\d+)?$/, '') || path;

export function parseStatus(text: string): AnimeStatus {
  const value = text.toLowerCase();
  if (value.includes('ongoing')) return 'ongoing';
  if (value.includes('complete') || value.includes('tamat')) return 'completed';
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

/** "21/09/26" (dd/mm/yy) → epoch ms (UTC midnight); undefined when it is not a date. */
export function parseEpisodeDate(text: string): number | undefined {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(collapse(text));
  if (!match) return undefined;
  const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
  const month = Number(match[2]) - 1;
  const day = Number(match[1]);
  if (month < 0 || month > 11 || day < 1 || day > 31) return undefined;
  const time = Date.UTC(year, month, day);
  return Number.isFinite(time) ? time : undefined;
}

export function parseYear(text: string | undefined): number | undefined {
  const year = Number(/\b(\d{4})\b/.exec(text ?? '')?.[1]);
  return year >= 1900 && year <= 2200 ? year : undefined;
}

/** The episode number of a list entry ("1159", "12.5"). */
export function parseNumber(text: string | undefined): number | undefined {
  const match = /^\s*(\d+(?:\.\d+)?)\s*$/.exec(text ?? '');
  return match ? Number.parseFloat(match[1] as string) : undefined;
}

/** The height in a server label ("pdrn 480p" → 480). */
export function labelHeight(label: string): number | undefined {
  const height = /(\d{3,4})\s*p\b/i.exec(label)?.[1];
  return height ? Number(height) : undefined;
}
