import '@matane-anime/extension-sdk/globals';
import {
  type AnimeDetails,
  type AnimePage,
  type AnimeSummary,
  type Episode,
  type Filter,
  type FilterState,
  type HtmlElement,
  NotFoundError,
  ParseError,
  defineExtension,
} from '@matane-anime/extension-sdk';
import { DEFAULT_BASE_URL, base, fetchPage } from './site';
import { getStreams } from './streams';
import {
  FORMATS,
  SORTS,
  STATUSES,
  collapse,
  entityPath,
  episodeUrl,
  parseStatus,
  parseType,
  parseYear,
  posterUrl,
} from './text';

// nimegami.id: a Next.js site (React Server Components) that is fully server-rendered, Indonesian subtitles. The
// catalogue is `/anime/?q=&genre=&status=&format=&year=&sort=&page=N` (24 a page). A series page (`/<slug>-sub-indo/`)
// carries, in its RSC payload, every episode of the series with every host and quality; the episode list and the
// streams of an episode are both read from that one page. Entity urls are the series path, and
// "<series path>#episode-<n>" for an episode.

const EMPTY: AnimePage = { items: [], hasNextPage: false };

/** The genres of the catalogue filter, without the explicit ones (the manifest is not nsfw). */
const GENRES = [
  'Action',
  'Adult Cast',
  'Adventure',
  'Boys Love',
  'Comedy',
  'Crossdressing',
  'Demons',
  'Detective',
  'Drama',
  'Ecchi',
  'Fantasy',
  'Gore',
  'Gourmet',
  'Harem',
  'High Stakes Game',
  'Historical',
  'Horror',
  'Isekai',
  'Iyashikei',
  'Josei',
  'Love Polygon',
  'Magic',
  'Mahou Shoujo',
  'Mecha',
  'Medical',
  'Military',
  'Music',
  'Mystery',
  'Mythology',
  'Parody',
  'Performing Arts',
  'Psychological',
  'Reincarnation',
  'Romance',
  'School',
  'School life',
  'Sci-Fi',
  'Seinen',
  'Shoujo',
  'Shounen',
  'Shounen Ai',
  'Slice Of Life',
  'Slice of Life',
  'Space',
  'Sports',
  'Strategy Game',
  'Super Power',
  'Supernatural',
  'Survival',
  'Suspense',
  'Team Sports',
  'Thriller',
  'Time Travel',
  'Villainess',
  'Yaoi',
];

const YEARS = Array.from({ length: new Date().getFullYear() + 1 - 1980 + 1 }, (_, i) =>
  String(new Date().getFullYear() + 1 - i),
);

const pick = <T extends string>(value: unknown, allowed: readonly T[]): T | '' =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : '';

async function fetchDoc(path: string): Promise<{ doc: HtmlElement; url: string; text: string }> {
  const url = `${base()}${path}`;
  const text = (await fetchPage(url)).text;
  return { doc: html.load(text, { baseUrl: url }), url, text };
}

/** Reads `article.anime-card`. */
function readCards(doc: HtmlElement, baseUrl: string): AnimeSummary[] {
  const items: AnimeSummary[] = [];
  const seen = new Set<string>();
  for (const card of doc.select('article.anime-card')) {
    const link = card.selectFirst('a.poster-link') ?? card.selectFirst('a');
    const href = link?.attr('href');
    const title = collapse(
      card.selectFirst('.card-title')?.text() ?? link?.attr('aria-label')?.replace(/^Lihat\s+/, '') ?? '',
    );
    if (!href || !title) throw new ParseError('A card has no link or title: the site layout changed');
    const url = entityPath(href, baseUrl);
    if (seen.has(url)) continue;
    seen.add(url);
    const thumbnailUrl = posterUrl(baseUrl, card.selectFirst('img')?.attr('src'));
    items.push({ url, title, ...(thumbnailUrl && { thumbnailUrl }) });
  }
  return items;
}

async function catalogue(params: Record<string, string | string[]>, page: number): Promise<AnimePage> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const v of Array.isArray(value) ? value : [value]) if (v) query.append(key, v);
  }
  if (page > 1) query.set('page', String(Math.floor(page)));
  const qs = query.toString();
  let loaded;
  try {
    loaded = await fetchDoc(`/anime/${qs ? `?${qs}` : ''}`);
  } catch (error) {
    if (page > 1 && error instanceof NotFoundError) return EMPTY;
    throw error;
  }
  const items = readCards(loaded.doc, loaded.url);
  if (items.length === 0 && !loaded.doc.selectFirst('nav.pagination, .filter-choice-list, footer')) {
    throw new ParseError('The catalogue has no cards and no page frame: the site layout changed');
  }
  return { items, hasNextPage: loaded.doc.selectFirst('a.page-arrow[aria-label*="berikutnya"]') !== null };
}

async function seriesPage(anime: AnimeSummary): Promise<{ doc: HtmlElement }> {
  const path = anime.url.split('#')[0] as string;
  const { doc } = await fetchDoc(path);
  if (!doc.selectFirst('h1')) throw new ParseError('The series page has no title: the site layout changed');
  return { doc };
}

/** `<div><dt>Label</dt><dd>value</dd></div>` rows of the info block. */
function readInfo(doc: HtmlElement): (label: string) => string | undefined {
  const rows = new Map<string, string>();
  for (const row of doc.select('.anime-info dl > div')) {
    const label = collapse(row.selectFirst('dt')?.text() ?? '').toLowerCase();
    const value = collapse(row.selectFirst('dd')?.text() ?? '');
    if (label && value) rows.set(label, value);
  }
  return (label) => {
    const value = rows.get(label.toLowerCase());
    return value && !/^(?:\?|-|unknown)$/i.test(value) ? value : undefined;
  };
}

export default defineExtension({
  preferences: () => [
    {
      type: 'text',
      key: 'baseUrl',
      label: 'Site address',
      description: 'nimegami.com redirects to nimegami.id. Libraries store paths, so they survive a change of domain.',
      default: DEFAULT_BASE_URL,
    },
  ],

  createSource: () => ({
    get baseUrl() {
      return base();
    },

    /** The site's default order is "Terpopuler" (most popular). */
    getPopular: (page) => catalogue({}, page),

    /** Ordered by the last update of the series. */
    getLatest: (page) => catalogue({ sort: 'updated' }, page),

    search(query: string, page: number, filters: FilterState): Promise<AnimePage> {
      const genre = pick(filters['genre'], GENRES);
      return catalogue(
        {
          q: query.trim(),
          genre,
          status: pick(filters['status'], Object.keys(STATUSES)),
          format: pick(
            filters['format'],
            FORMATS.map(([v]) => v),
          ),
          year: pick(filters['year'], YEARS),
          sort: pick(
            filters['sort'],
            SORTS.map(([v]) => v),
          ),
        },
        page,
      );
    },

    getFilters: (): Filter[] => [
      {
        type: 'select',
        id: 'genre',
        label: 'Genre',
        options: [{ value: '', label: 'Any' }, ...GENRES.map((g) => ({ value: g, label: g }))],
        default: '',
      },
      {
        type: 'select',
        id: 'status',
        label: 'Status',
        options: [{ value: '', label: 'Any' }, ...Object.entries(STATUSES).map(([value, label]) => ({ value, label }))],
        default: '',
      },
      {
        type: 'select',
        id: 'format',
        label: 'Format',
        options: [{ value: '', label: 'Any' }, ...FORMATS.map(([value, label]) => ({ value, label }))],
        default: '',
      },
      {
        type: 'select',
        id: 'year',
        label: 'Year',
        options: [{ value: '', label: 'Any' }, ...YEARS.map((y) => ({ value: y, label: y }))],
        default: '',
      },
      {
        type: 'select',
        id: 'sort',
        label: 'Order by',
        options: SORTS.map(([value, label]) => ({ value, label })),
        default: '',
      },
    ],

    async getAnimeDetails(anime: AnimeSummary): Promise<AnimeDetails> {
      const { doc } = await seriesPage(anime);
      const info = readInfo(doc);
      const title = collapse(doc.selectFirst('h1')?.text() ?? '');
      if (!title) throw new ParseError('The series page has no title');
      const alt = [
        doc.selectFirst('p.english-title')?.text(),
        info('Judul asli'),
        ...(info('Judul alternatif') ?? '').split(','),
      ]
        .map((name) => collapse(name ?? ''))
        .filter((name, i, all) => name && name.toLowerCase() !== title.toLowerCase() && all.indexOf(name) === i);
      const genres = doc
        .select('.post-genres a')
        .map((a) => collapse(a.text()))
        .filter(Boolean);
      const synopsis = doc
        .select('.synopsis-block p')
        .map((p) => collapse(p.text()))
        .filter(Boolean)
        .join('\n\n');
      const facts = doc.select('.post-facts span').map((s) => collapse(s.text()));
      return {
        url: anime.url.split('#')[0] as string,
        title,
        thumbnailUrl: posterUrl(base(), doc.selectFirst('.detail-poster img')?.attr('src')),
        altTitles: alt.length > 0 ? alt : undefined,
        description: synopsis || undefined,
        genres: genres.length > 0 ? genres : undefined,
        studio: info('Studio'),
        year: parseYear(facts[0]) ?? parseYear(info('Mulai tayang')),
        status: parseStatus(info('Status') ?? doc.selectFirst('.status-badge')?.text() ?? ''),
        type: parseType(info('Tipe') ?? ''),
      };
    },

    /** The episode grid of the page: numbers only (no titles, no dates), one button per episode that has links. */
    async getEpisodes(anime: AnimeSummary): Promise<Episode[]> {
      const { doc } = await seriesPage(anime);
      const path = anime.url.split('#')[0] as string;
      const numbers = new Set<number>();
      for (const a of doc.select('.episode-grid a[href^="#episode_"]')) {
        const n = Number.parseFloat(/^\s*(\d+(?:\.\d+)?)\s*$/.exec(a.text())?.[1] ?? '');
        if (Number.isFinite(n)) numbers.add(n);
      }
      if (numbers.size === 0) throw new NotFoundError('This series has no episodes yet');
      return [...numbers]
        .sort((a, b) => b - a)
        .map((number) => ({ url: episodeUrl(path, number), name: `Episode ${number}`, number }));
    },

    getStreams,

    resolveUrl(url: string): AnimeSummary | null {
      const match = /^https?:\/\/(?:www\.)?nimegami\.[a-z]+\/([^/?#]+-sub-indo)\/?/i.exec(url);
      const slug = match?.[1];
      return slug ? { url: `/${slug}/`, title: slug.replace(/-sub-indo$/, '').replace(/-/g, ' ') } : null;
    },

    getWebUrl: (item: AnimeSummary | Episode) => `${base()}${item.url.split('#')[0]}`,
  }),
});
