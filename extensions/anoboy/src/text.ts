// Pure helpers: no host globals except `URL`, so they can be unit-tested directly.
import type { AnimeStatus, AnimeType } from '@matane-anime/extension-sdk';

/**
 * The identity of an anime or an episode: its path on the site, with a trailing slash and no host or query,
 * so a link on another domain of the site and on the main one are the same entity.
 */
export function entityPath(href: string, base: string): string {
  const { pathname } = new URL(href, `${base}/`);
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

export const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

export const STATUSES: Record<string, AnimeStatus> = {
  ongoing: 'ongoing',
  completed: 'completed',
  hiatus: 'hiatus',
};

export const TYPES: Record<string, AnimeType> = {
  tv: 'tv',
  bd: 'tv',
  movie: 'movie',
  ova: 'ova',
  ona: 'ona',
  special: 'special',
};

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** "February 16, 2024" → epoch ms (UTC midnight); undefined when it is not a date we know. */
export function parseEpisodeDate(text: string): number | undefined {
  const match = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(collapse(text));
  const month = match ? MONTHS.indexOf((match[1] as string).toLowerCase()) : -1;
  if (!match || month < 0) return undefined;
  const time = Date.UTC(Number(match[3]), month, Number(match[2]));
  return Number.isFinite(time) && time >= 0 ? time : undefined;
}

/** "Rating 8.72" is not used by the SDK; the year comes from "Released: 1999". */
export function releaseYear(text: string | undefined): number | undefined {
  const year = Number(/\b(\d{4})\b/.exec(text ?? '')?.[1]);
  return year >= 1900 && year <= 2200 ? year : undefined;
}

/** The cover without the `?resize=247,350` thumbnail query: the image proxy serves the full size without it. */
export const fullCover = (url: string | undefined): string | undefined => url?.replace(/\?resize=[\d,]+$/, '');

/** "One Piece Episode 1180 Subtitle Indonesia" → "Episode 1180". Falls back to the cleaned text. */
export function episodeName(title: string, num: string): string {
  const text = collapse(title).replace(/\s*Subtitle Indonesia\s*$/i, '');
  const tail = /\b(?:Special|OVA|Movie)\b.*$|\bEpisode\s+\d+(?:\.\d+)?.*$/i.exec(text);
  return tail ? tail[0] : /^\d+(?:\.\d+)?$/.test(num) ? `Episode ${num}` : text || num;
}

/** Episode number from the list's number cell ("1180", "12.5"); "Movie" and the like have none. */
export function parseNumber(text: string): number | undefined {
  const match = /^\s*(\d+(?:\.\d+)?)\s*$/.exec(text);
  return match ? Number.parseFloat(match[1] as string) : undefined;
}

/** Index of the `"` or `'` that closes a JS string starting right after `start`, or -1. */
function closingQuote(source: string, start: number, quote: string): number {
  for (let at = start; at < source.length; at++) {
    const char = source[at];
    if (char === '\\') at++;
    else if (char === quote) return at;
  }
  return -1;
}

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Unpacks Dean Edwards' `eval(function(p,a,c,k,e,d){…}('payload',radix,count,'dict'.split('|')))` without
 * running it: the payload is plain text with words replaced by dictionary entries. Returns null when the
 * page has no such script. Scans by hand instead of with one big regex, because the payload is tens of KB.
 */
export function unpackPacked(source: string): string | null {
  const start = source.indexOf('eval(function(p,a,c,k,e,d)');
  if (start < 0) return null;
  const args = source.indexOf("}('", start);
  if (args < 0) return null;
  const payloadEnd = closingQuote(source, args + 3, "'");
  if (payloadEnd < 0) return null;
  const numbers = /^,(\d+),(\d+),'/.exec(source.slice(payloadEnd + 1, payloadEnd + 40));
  if (!numbers) return null;
  const dictStart = payloadEnd + 1 + numbers[0].length;
  const dictEnd = closingQuote(source, dictStart, "'");
  if (dictEnd < 0 || !source.startsWith(".split('|')", dictEnd + 1)) return null;

  const payload = source
    .slice(args + 3, payloadEnd)
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
  const radix = Number(numbers[1]);
  const count = Number(numbers[2]);
  const dictionary = source.slice(dictStart, dictEnd).split('|');
  if (radix < 2 || radix > DIGITS.length) return null;

  const encode = (n: number): string => (n < radix ? '' : encode(Math.floor(n / radix))) + DIGITS[n % radix];
  const words = new Map<string, string>();
  for (let i = 0; i < count; i++) words.set(encode(i), dictionary[i] || encode(i));
  return payload.replace(/\b\w+\b/g, (word) => words.get(word) ?? word);
}
