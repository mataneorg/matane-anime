// Pure helpers: no host globals, so they can be unit-tested directly.
import type { AnimeStatus, AnimeType } from '@matane-anime/extension-sdk';

/** The identity of an anime or an episode: its path on the site, with no trailing slash, host or query. */
export function entityPath(href: string, base: string): string {
  const { pathname } = new URL(href, `${base}/`);
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

export const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

const ENTITIES: Record<string, string> = {
  quot: '"',
  amp: '&',
  lt: '<',
  gt: '>',
  apos: "'",
  '#039': "'",
  '#39': "'",
  '#x27': "'",
};
export const unescapeHtml = (text: string): string =>
  text.replace(/&(quot|amp|lt|gt|apos|#0?39|#x27);/g, (all, name: string) => ENTITIES[name] ?? all);

/** Undoes the escapes of a JS string literal (`"`, `\\`, `\/`…), which is how the pages embed their JSON. */
export function unescapeJs(text: string): string {
  return text.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_all, code: string) => {
    if (code.length > 1) return String.fromCharCode(parseInt(code.slice(1), 16));
    return code === 'n' ? '\n' : code === 't' ? '\t' : code === 'r' ? '\r' : code;
  });
}

/** The end (index of the closing quote) of a single-quoted JS string whose first character is at `from`, or -1. */
function endOfLiteral(text: string, from: number): number {
  let at = from;
  for (;;) {
    at = text.indexOf("'", at);
    if (at < 0) return -1;
    let slashes = 0;
    while (text[at - 1 - slashes] === '\\') slashes++;
    if (slashes % 2 === 0) return at;
    at++;
  }
}

/**
 * The value of `<key>: JSON.parse('…')` (an Alpine `x-data` property) in a page, parsed. The page is searched
 * with `indexOf` because some literals are tens of KB; undefined when the key is not there.
 */
export function readJson<T>(page: string, key: string): T | undefined {
  const needle = `${key}: JSON.parse('`;
  const start = page.indexOf(needle);
  if (start < 0) return undefined;
  const from = start + needle.length;
  const end = endOfLiteral(page, from);
  if (end < 0) return undefined;
  try {
    return JSON.parse(unescapeJs(unescapeHtml(page.slice(from, end)))) as T;
  } catch {
    return undefined;
  }
}

/** `vidstackPlayer(JSON.parse('{…}'))` of an episode page. */
export function readPlayer(page: string): { src?: string } | undefined {
  const needle = "vidstackPlayer(JSON.parse('";
  const start = page.indexOf(needle);
  if (start < 0) return undefined;
  const from = start + needle.length;
  const end = endOfLiteral(page, from);
  if (end < 0) return undefined;
  try {
    return JSON.parse(unescapeJs(unescapeHtml(page.slice(from, end)))) as { src?: string };
  } catch {
    return undefined;
  }
}

/** `nextCursor: '…', hasMore: true` that follows a list in a page. */
export function readPaging(page: string): { nextCursor: string | null; hasMore: boolean } {
  const cursor = /nextCursor:\s*(?:'([^']*)'|null)/.exec(page)?.[1] ?? null;
  const hasMore = /hasMore:\s*(true|false)/.exec(page)?.[1] === 'true';
  return { nextCursor: cursor, hasMore: hasMore && cursor !== null };
}

export interface Titles {
  [key: string]: string | undefined;
}

/** The site keys its titles by language id: "1" is English, "5" romaji, "8" Japanese. */
export function bestTitle(titles: Titles | null | undefined, fallback?: string | null): string {
  return (titles?.['1'] || titles?.['5'] || fallback || Object.values(titles ?? {})[0] || '').trim();
}

export function altTitles(titles: Titles | null | undefined, title: string): string[] {
  return Object.values(titles ?? {})
    .map((name) => (name ?? '').trim())
    .filter((name, i, all) => name && name !== title && all.indexOf(name) === i);
}

export function parseType(text: string): AnimeType | undefined {
  const value = text.trim().toLowerCase();
  if (value === 'tv series' || value === 'web') return 'tv';
  if (value === 'movie') return 'movie';
  if (value === 'ova') return 'ova';
  if (value === 'tv special' || value === 'special') return 'special';
  return undefined;
}

export function parseStatus(text: string): AnimeStatus {
  const value = text.trim().toLowerCase();
  return value === 'ongoing' ? 'ongoing' : value === 'completed' ? 'completed' : 'unknown';
}

/** "2026-10-12" → epoch ms (UTC midnight). */
export function parseAirDate(text: string | null | undefined): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text ?? '');
  if (!match) return undefined;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(time) ? time : undefined;
}

/** A cursor the site made, as an object (`{"sort":24,"id":1041,"_pointsToNextItems":true}`); undefined otherwise. */
export function decodeCursor(cursor: string, decode: (text: string) => string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(decode(cursor)) as unknown;
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
