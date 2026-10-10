import type { AnimeStatus, AnimeType } from '@matane-anime/extension-sdk';

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

/** Descriptions come with `\r\n`; keep paragraphs, drop the carriage returns and blank runs. */
export const cleanText = (text: string | null | undefined): string | undefined => {
  const value = (text ?? '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return value || undefined;
};

/** Episode ids are `<series slug>/<episodeNumber>`; the number is a string and may be "0" or "12.5". */
export const episodeUrl = (slug: string, number: string | number): string => `${slug}/${number}`;

export function splitEpisodeUrl(url: string): { slug: string; number: string } {
  const at = url.lastIndexOf('/');
  if (at <= 0 || at === url.length - 1) throw new Error(`Not an episode url: ${url}`);
  return { slug: url.slice(0, at), number: url.slice(at + 1) };
}

/** The year the show aired: the season name ("Fall 1999") is the true one; `releaseDate` is often a re-upload date. */
export function airYear(
  seasonName: string | undefined | null,
  releaseDate: string | undefined | null,
): number | undefined {
  const fromSeason = Number(/\b(\d{4})$/.exec(seasonName ?? '')?.[1]);
  const fromDate = new Date(releaseDate ?? '').getUTCFullYear();
  for (const year of [fromSeason, fromDate]) if (year >= 1900 && year <= 2200) return year;
  return undefined;
}

/** `releasedAt` is 1970-01-01 for old episodes; then the row's creation date is the best witness. */
export function episodeTime(
  releasedAt: string | null | undefined,
  createdAt: string | null | undefined,
): number | undefined {
  for (const value of [releasedAt, createdAt]) {
    const time = Date.parse(value ?? '');
    if (Number.isFinite(time) && new Date(time).getUTCFullYear() > 1971) return time;
  }
  return undefined;
}
