// The fake site's catalog. Deterministic, so tests can name titles and episode counts.

/**
 * - `hls`, `mp4`: work. `long` is a 40 second file, for resume tests.
 * - `expiring`: both servers' links die after their first segment, for good.
 * - `refreshing`: Server A's first link dies after one segment, but asking the embed again gives a fresh,
 *   working one (a token that was renewed); Server B works.
 * - `fallback`: Server A's link always dies after one segment, Server B works.
 * - `none`: no servers at all.
 * - `hls-*`: both servers serve that fixture of apps/desktop/e2e/fixtures/media (see STREAM_FIXTURES), for the
 *   download engine's tests: AES-128, absolute URIs, a separate audio rendition, a 24 segment episode, byte
 *   ranges, a rotating key, and a live playlist (no `EXT-X-ENDLIST`).
 */
export type StreamKind =
  | 'hls'
  | 'mp4'
  | 'long'
  | 'expiring'
  | 'refreshing'
  | 'fallback'
  | 'none'
  | 'hls-aes'
  | 'hls-abs'
  | 'hls-audio'
  | 'hls-long'
  | 'hls-byterange'
  | 'hls-keyrot'
  | 'hls-live';

/** Where each `hls-*` kind's playlist lives on the media host. */
export const STREAM_FIXTURES: Partial<Record<StreamKind, string>> = {
  'hls-aes': '/media/hls-aes/index.m3u8',
  'hls-abs': '/media/hls-abs/index.m3u8',
  'hls-audio': '/media/hls-audio/master.m3u8',
  'hls-long': '/media/hls-long/index.m3u8',
  'hls-byterange': '/media/hls-byterange/index.m3u8',
  'hls-keyrot': '/media/hls-keyrot/index.m3u8',
  'hls-live': '/media/hls-live/index.m3u8',
};

export interface CatalogEntry {
  slug: string;
  title: string;
  alt: string[];
  description: string;
  genres: string[];
  status: 'ongoing' | 'completed';
  type: 'tv' | 'movie' | 'ova';
  year: number;
  studio: string;
  episodes: number;
  /** "Sub" and "Dub" episodes share numbers. */
  variants: string[];
  streams: StreamKind;
  /** Left out of /popular and /latest (so listing tests keep their counts); /search?q= still finds it. */
  hidden?: boolean;
}

const base = (entry: Partial<CatalogEntry> & Pick<CatalogEntry, 'slug' | 'title'>): CatalogEntry => ({
  alt: [],
  description: `${entry.title} is a made-up series for tests.`,
  genres: ['action'],
  status: 'completed',
  type: 'tv',
  year: 2020,
  studio: 'Studio Mikan',
  episodes: 12,
  variants: ['Sub'],
  streams: 'hls',
  ...entry,
});

const FEATURED: CatalogEntry[] = [
  base({
    slug: 'sky-harbor',
    title: 'Sky Harbor',
    alt: ['Sora no Minato', 'Hafen im Himmel'],
    genres: ['action', 'adventure'],
    status: 'ongoing',
    year: 2024,
    episodes: 12,
  }),
  base({
    slug: 'quiet-orchard',
    title: 'Quiet Orchard',
    genres: ['slice-of-life'],
    episodes: 3,
    streams: 'mp4',
    year: 2022,
  }),
  base({
    slug: 'long-runner',
    title: 'Long Runner',
    genres: ['action', 'comedy'],
    episodes: 120,
    status: 'ongoing',
    year: 2015,
  }),
  base({
    slug: 'two-voices',
    title: 'Two Voices',
    genres: ['drama'],
    episodes: 6,
    variants: ['Sub', 'Dub'],
    year: 2023,
  }),
  base({ slug: 'no-streams', title: 'No Streams', genres: ['mystery'], episodes: 2, streams: 'none', year: 2021 }),
  base({
    slug: 'expiring-tide',
    title: 'Expiring Tide',
    genres: ['adventure'],
    episodes: 2,
    streams: 'expiring',
    year: 2019,
  }),
  base({
    slug: 'token-tide',
    title: 'Token Tide',
    genres: ['adventure'],
    episodes: 2,
    streams: 'refreshing',
    year: 2016,
  }),
  base({ slug: 'long-night', title: 'Long Night', genres: ['drama'], episodes: 3, streams: 'long', year: 2013 }),
  base({ slug: 'bad-server', title: 'Bad Server', genres: ['comedy'], episodes: 2, streams: 'fallback', year: 2014 }),
  base({ slug: 'empty-shelf', title: 'Empty Shelf', genres: ['comedy'], episodes: 0, year: 2018 }),
  base({ slug: 'one-shot-movie', title: 'One Shot Movie', genres: ['drama'], type: 'movie', episodes: 1, year: 2017 }),
];

/** Series for the download engine's tests: three episodes each, one stream shape each. */
const DOWNLOAD_SERIES: CatalogEntry[] = (
  [
    ['dl-aes', 'Cipher Coast', 'hls-aes'],
    ['dl-abs', 'Far Shore', 'hls-abs'],
    ['dl-audio', 'Two Tracks', 'hls-audio'],
    ['dl-long', 'Long Wave', 'hls-long'],
    ['dl-byterange', 'Single File', 'hls-byterange'],
    ['dl-keyrot', 'Turning Keys', 'hls-keyrot'],
    ['dl-live', 'Always On', 'hls-live'],
  ] as const
).map(([slug, title, streams]) => base({ slug, title, streams, episodes: 3, hidden: true, year: 2025 }));

const GENRES = ['action', 'adventure', 'comedy', 'drama', 'mystery', 'slice-of-life'];

const FILLER: CatalogEntry[] = Array.from({ length: 24 }, (_, index) => {
  const n = String(index + 1).padStart(2, '0');
  return base({
    slug: `filler-${n}`,
    title: `Filler Series ${n}`,
    genres: [GENRES[index % GENRES.length] as string],
    status: index % 3 === 0 ? 'ongoing' : 'completed',
    year: 2000 + index,
    episodes: 4 + (index % 5),
  });
});

export const CATALOG: CatalogEntry[] = [...FEATURED, ...FILLER, ...DOWNLOAD_SERIES];
export const PAGE_SIZE = 12;
export const GENRE_LIST = GENRES;

export function findAnime(slug: string): CatalogEntry | undefined {
  return CATALOG.find((entry) => entry.slug === slug);
}

export interface FakeEpisode {
  id: string;
  number: number;
  title: string;
  variant: string;
  uploadedAt: number;
}

export interface EpisodesOptions {
  /** More (or fewer) episodes than the catalog says. */
  count?: number;
  /** When the episodes past the catalog's own count were "uploaded": now, not in January 2024. */
  extraUploadedAt?: number;
}

/** Newest first, like a real listing. */
export function episodesOf(entry: CatalogEntry, options: EpisodesOptions = {}): FakeEpisode[] {
  const out: FakeEpisode[] = [];
  for (let number = options.count ?? entry.episodes; number >= 1; number--) {
    for (const variant of [...entry.variants].reverse()) {
      out.push({
        id: `${entry.slug}-${number}-${variant.toLowerCase()}`,
        number,
        title: `Episode ${number}`,
        variant,
        uploadedAt:
          number > entry.episodes && options.extraUploadedAt !== undefined
            ? options.extraUploadedAt
            : Date.UTC(2024, 0, 1) + number * 86_400_000,
      });
    }
  }
  return out;
}

export interface Query {
  q?: string;
  status?: string;
  /** Comma list; a leading "-" excludes. */
  genre?: string;
  sort?: 'title' | 'year' | 'popular';
  dir?: 'asc' | 'desc';
  page: number;
}

export function query(list: CatalogEntry[], params: Query): { items: CatalogEntry[]; hasNext: boolean } {
  let items = [...list];
  if (params.q)
    items = items.filter((e) => [e.title, ...e.alt].some((t) => t.toLowerCase().includes(params.q!.toLowerCase())));
  if (params.status) items = items.filter((e) => e.status === params.status);
  for (const raw of (params.genre ?? '').split(',').filter(Boolean)) {
    const exclude = raw.startsWith('-');
    const genre = exclude ? raw.slice(1) : raw;
    items = items.filter((e) => e.genres.includes(genre) !== exclude);
  }
  if (params.sort === 'title') items.sort((a, b) => a.title.localeCompare(b.title));
  if (params.sort === 'year') items.sort((a, b) => a.year - b.year);
  if (params.dir === 'desc') items.reverse();
  const start = (params.page - 1) * PAGE_SIZE;
  return { items: items.slice(start, start + PAGE_SIZE), hasNext: start + PAGE_SIZE < items.length };
}
