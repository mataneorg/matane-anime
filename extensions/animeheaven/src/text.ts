// Pure helpers: no host globals except `URL`, so they can be unit-tested directly.

export const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** The identity of an anime: "/anime.php?<id>" (the id is a 5-character slug). */
export function animePath(href: string, base: string): string | undefined {
  const url = new URL(href, `${base}/`);
  if (!/\/anime\.php$/.test(url.pathname)) return undefined;
  const id = /^\?([a-z0-9]+)/i.exec(url.search)?.[1];
  return id ? `/anime.php?${id}` : undefined;
}

/** An episode is identified by the 32-hex key the site sets as the `key` cookie. */
export const isEpisodeKey = (text: string): boolean => /^[0-9a-f]{32}$/i.test(text);

/** "11 d ago", "3 h ago", "18 min ago", "2 mo ago", "1 y ago" in milliseconds; undefined when not understood. */
export function parseAge(text: string): number | undefined {
  const match = /(\d+)\s*(s|sec|min|m|h|hr|d|w|mo|y)\w*\s+ago/i.exec(text.trim());
  if (!match) return undefined;
  const n = Number(match[1]);
  const unit = (match[2] as string).toLowerCase();
  const minute = 60_000;
  const table: Record<string, number> = {
    s: 1000,
    sec: 1000,
    min: minute,
    m: minute,
    h: 60 * minute,
    hr: 60 * minute,
    d: 24 * 60 * minute,
    w: 7 * 24 * 60 * minute,
    mo: 30 * 24 * 60 * minute,
    y: 365 * 24 * 60 * minute,
  };
  const unitMs = table[unit];
  return unitMs === undefined ? undefined : n * unitMs;
}

/** "12", "01", "1150.5" -> number. "2raw" or other text -> undefined. */
export function parseNumber(text: string): number | undefined {
  const value = text.trim();
  return /^\d+(?:\.\d+)?$/.test(value) ? Number.parseFloat(value) : undefined;
}

/** "Episodes: 12 Year: 2025 Score: 8.7/10" values ("1999-?" gives 1999). */
export function readYear(text: string): number | undefined {
  const year = Number(/\b(\d{4})\b/.exec(text)?.[1]);
  return year >= 1900 && year <= 2200 ? year : undefined;
}

const ADULT = /^(?:hentai|erotica|adult|porn|xxx|18\+|uncensored)$/i;
/** Adult tags are never shown or offered. */
export const isAdultTag = (tag: string): boolean => ADULT.test(tag.trim());

/** The first `video/mp4` source that is not one of the `&error` fallbacks. */
export function pickSource(page: string): string | undefined {
  for (const m of page.matchAll(/<source\b[^>]*>/gi)) {
    const tag = m[0];
    const src = /\bsrc=(?:'([^']*)'|"([^"]*)")/i.exec(tag);
    const url = src?.[1] ?? src?.[2];
    if (!url || !/type=['"]video\/mp4['"]/i.test(tag) || /[?&]error\d*(?:&|$)/.test(url)) continue;
    if (/^https:\/\/[^/]+\/video\.mp4\?/.test(url)) return url.replace(/&amp;/g, '&');
  }
  return undefined;
}
