// Pure helpers: no host globals, so they can be unit-tested directly.
import type { AnimeStatus, AnimeType } from '@matane-anime/extension-sdk';

export const STATUSES: Record<string, AnimeStatus> = {
  currently_airing: 'ongoing',
  finished_airing: 'completed',
};

export const TYPES: Record<string, AnimeType> = {
  tv: 'tv',
  movie: 'movie',
  ona: 'ona',
  ova: 'ova',
  special: 'special',
  tv_special: 'special',
};

export interface Poster {
  sm?: string;
  hq?: string;
}

/** The site's webp posters (`.jpeg` variants are 404); `hq` for the details, `sm` for lists. */
export function posterUrl(
  base: string,
  poster: Poster | null | undefined,
  size: 'sm' | 'hq' = 'sm',
): string | undefined {
  const name = poster?.[size] ?? poster?.sm ?? poster?.hq;
  return name ? `${base}/image/poster/${name}.webp` : undefined;
}

/** "ep-4-f3a039" for episode 4 whose listing slug is "f3a039". Fractions ("1092.5") stay as they are. */
export const episodePart = (number: number | string, slug: string): string => `ep-${number}-${slug}`;

/** The episode number written in `ep-<n>-<slug>`. */
export function numberOfPart(part: string): number | undefined {
  const match = /^ep-(\d+(?:\.\d+)?)-/.exec(part);
  return match ? Number.parseFloat(match[1] as string) : undefined;
}

const ENTITIES: Record<string, string> = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", '#39': "'", '#x27': "'" };
export const unescapeHtml = (text: string): string =>
  text.replace(/&(quot|amp|lt|gt|apos|#39|#x27);/g, (_m, name: string) => ENTITIES[name] ?? _m);

/**
 * The HLS master playlist in a krussdomi player page: an Astro island whose HTML-escaped props hold
 * `"manifest":[0,"https://hls.krussdomi.com/manifest/<id>/master.m3u8"]` (VidStreaming), or a protocol-relative
 * `//bl.krussdomi.com/playlist/<id>/master.m3u8` (CatStream).
 */
export function parseManifest(page: string): string | undefined {
  const text = unescapeHtml(page).replace(/\\\//g, '/');
  const found = /"manifest"\s*:\s*\[\s*0\s*,\s*"([^"]+\.m3u8[^"]*)"/.exec(text)?.[1];
  const url =
    found ?? /(?:https:)?\/\/(?:hls|bl)\.krussdomi\.com\/(?:manifest|playlist)\/[^"'\\\s]+\.m3u8/.exec(text)?.[0];
  if (!url) return undefined;
  return url.startsWith('//') ? `https:${url}` : url;
}
