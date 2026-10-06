// The fake site's catalog. Deterministic, so tests can name titles and episode counts.

export type StreamKind = 'hls' | 'mp4' | 'expiring' | 'none';

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
  base({ slug: 'empty-shelf', title: 'Empty Shelf', genres: ['comedy'], episodes: 0, year: 2018 }),
  base({ slug: 'one-shot-movie', title: 'One Shot Movie', genres: ['drama'], type: 'movie', episodes: 1, year: 2017 }),
];

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

export const CATALOG: CatalogEntry[] = [...FEATURED, ...FILLER];
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

/** Newest first, like a real listing. */
export function episodesOf(entry: CatalogEntry): FakeEpisode[] {
  const out: FakeEpisode[] = [];
  for (let number = entry.episodes; number >= 1; number--) {
    for (const variant of [...entry.variants].reverse()) {
      out.push({
        id: `${entry.slug}-${number}-${variant.toLowerCase()}`,
        number,
        title: `Episode ${number}`,
        variant,
        uploadedAt: Date.UTC(2024, 0, 1) + number * 86_400_000,
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
