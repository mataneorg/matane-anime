// Pure helpers: no host globals, so they can be unit-tested directly.
import type { AnimeStatus, AnimeType } from '@matane-anime/extension-sdk';

export const STATUSES: Record<string, AnimeStatus> = {
  RELEASING: 'ongoing',
  FINISHED: 'completed',
  HIATUS: 'hiatus',
  CANCELLED: 'cancelled',
};

export const TYPES: Record<string, AnimeType> = {
  TV: 'tv',
  TV_SHORT: 'tv',
  MOVIE: 'movie',
  ONA: 'ona',
  OVA: 'ova',
  SPECIAL: 'special',
};

/** The AniList images are objects; the site's names are shifted by one size, so the biggest is used. */
export function coverOf(image: unknown): string | undefined {
  if (typeof image === 'string') return image || undefined;
  const sizes = image as { extraLarge?: string; large?: string; medium?: string } | null | undefined;
  return sizes?.extraLarge || sizes?.large || sizes?.medium || undefined;
}

/** The synopsis has `<br>` and light HTML. */
export function cleanDescription(text: string | null | undefined): string | undefined {
  const plain = (text ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&rsquo;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return plain || undefined;
}

/** "<anime id>/<number>/sub" or ".../dub": a stable identity for each variant of an episode. */
export const episodeUrl = (id: string, number: number | string, type: 'sub' | 'dub'): string =>
  `${id}/${number}/${type}`;

export function splitEpisodeUrl(url: string): { id: string; number: string; type: 'sub' | 'dub' } | undefined {
  const match = /^([^/]+)\/(\d+(?:\.\d+)?)\/(sub|dub)$/.exec(url);
  return match ? { id: match[1] as string, number: match[2] as string, type: match[3] as 'sub' | 'dub' } : undefined;
}
