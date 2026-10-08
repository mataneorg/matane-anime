// Pure helpers: no host globals except `URL`, so they can be unit-tested directly.

/**
 * The identity of an anime or an episode: its path on the site, with a trailing slash and no host or query,
 * so `https://otakudesu.blog/anime/x/`, `/anime/x` and a link on another domain are the same entity.
 * Every `url` the extension returns goes through here.
 */
export function entityPath(href: string, base: string): string {
  const { pathname } = new URL(href, `${base}/`);
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** "Oni no Hanayome (Episode 1 – 12) Subtitle Indonesia" → "Oni no Hanayome". */
export function cleanTitle(text: string): string {
  return collapse(text)
    .replace(/\s*(?:\(Episode[^)]*\)\s*)?(?:Subtitle Indonesia|Sub Indo)(?:\s*\+\s*Special)?\s*$/i, '')
    .trim();
}

const MONTHS: Record<string, number> = {
  januari: 0,
  februari: 1,
  maret: 2,
  april: 3,
  mei: 4,
  juni: 5,
  juli: 6,
  agustus: 7,
  september: 8,
  oktober: 9,
  november: 10,
  desember: 11,
};

/** "20 September,2026" → epoch ms (midnight in WIB, UTC+7); undefined when it is not a date we know. */
export function parseEpisodeDate(text: string): number | undefined {
  const match = /^(\d{1,2})\s+([A-Za-z]+)\s*,\s*(\d{4})$/.exec(collapse(text));
  const month = match ? MONTHS[(match[2] as string).toLowerCase()] : undefined;
  if (!match || month === undefined) return undefined;
  const time = Date.UTC(Number(match[3]), month, Number(match[1])) - 7 * 3_600_000;
  return Number.isFinite(time) && time >= 0 ? time : undefined;
}

export interface EpisodeLabel {
  number?: number;
  variant?: string;
}

/**
 * Number and variant from an episode link text. "Special" goes first: "S2 Special Episode 1" and
 * "One Punch Man Special 6" must not take the place of a regular episode with that number. A BD release
 * (a film) has no number. "Episode 0" is a real episode, so a falsy check is wrong here.
 */
export function parseEpisodeLabel(text: string): EpisodeLabel {
  if (/\bSpecial\b/i.test(text)) return { variant: 'Special' };
  const match = /\bEpisode\s+(\d+(?:\.\d+)?)\b/i.exec(text);
  if (match) return { number: Number.parseFloat(match[1] as string) };
  if (/\bBD\b/.test(text)) return { variant: 'BD' };
  return {};
}

/** The part of an episode link that tells it apart: "Episode 12 (End)", "Special 6", "BD". */
export function episodeName(linkText: string, animeTitle: string | undefined): string {
  const full = cleanTitle(linkText);
  if (animeTitle && full.toLowerCase().startsWith(animeTitle.toLowerCase())) {
    const rest = full.slice(animeTitle.length).trim();
    if (rest) return rest;
  }
  const tail = /\b(?:Special(?:\s+Episode)?(?:\s+\d+)?|Episode\s+\d+(?:\.\d+)?(?:\s*\(End\))?|BD)$/i.exec(full);
  return tail ? tail[0] : full;
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
