import '@matane-anime/extension-sdk/globals';
import {
  type AnimeDetails,
  type AnimePage,
  type AnimeSummary,
  type Episode,
  type Filter,
  type FilterState,
  ParseError,
  defineExtension,
} from '@matane-anime/extension-sdk';
import { DEFAULT_BASE_URL, base, getJson, mapLimit, memo, postJson } from './api';
import { getStreams } from './streams';
import { STATUSES, TYPES, type Poster, episodePart, posterUrl } from './text';

// kaa.lt (KickAssAnime): a Nuxt front over a public JSON API (`/api`), English. Entity urls are the show slug, and
// `<show slug>/ep-<n>-<episode slug>` for an episode (the episode slug differs between the sub and the dub).

/** Genres of `/api/show/filters` (the explicit "Erotica" left out: the manifest is not nsfw). */
const GENRES = [
  'Action',
  'Adult Cast',
  'Adventure',
  'Anthropomorphic',
  'Avant Garde',
  'Award Winning',
  'Boys Love',
  'CGDCT',
  'Childcare',
  'Combat Sports',
  'Comedy',
  'Crossdressing',
  'Delinquents',
  'Detective',
  'Drama',
  'Ecchi',
  'Educational',
  'Fantasy',
  'Gag Humor',
  'Girls Love',
  'Gore',
  'Gourmet',
  'Harem',
  'High Stakes Game',
  'Historical',
  'Horror',
  'Idols (Female)',
  'Idols (Male)',
  'Isekai',
  'Iyashikei',
  'Josei',
  'Kids',
  'Love Polygon',
  'Magical Sex Shift',
  'Mahou Shoujo',
  'Martial Arts',
  'Mecha',
  'Medical',
  'Military',
  'Music',
  'Mystery',
  'Mythology',
  'Organized Crime',
  'Otaku Culture',
  'Parody',
  'Performing Arts',
  'Pets',
  'Psychological',
  'Racing',
  'Reincarnation',
  'Reverse Harem',
  'Romance',
  'Romantic Subtext',
  'Samurai',
  'School',
  'Sci-Fi',
  'Seinen',
  'Shoujo',
  'Shounen',
  'Showbiz',
  'Slice of Life',
  'Space',
  'Sports',
  'Strategy Game',
  'Super Power',
  'Supernatural',
  'Survival',
  'Suspense',
  'Team Sports',
  'Time Travel',
  'Urban Fantasy',
  'Vampire',
  'Video Game',
  'Villainess',
  'Visual Arts',
  'Workplace',
];

const TYPE_OPTIONS = [
  ['', 'Any'],
  ['tv', 'TV'],
  ['movie', 'Movie'],
  ['ona', 'ONA'],
  ['ova', 'OVA'],
  ['special', 'Special'],
  ['tv_special', 'TV special'],
] as const;

/** The lists the site offers without a search; they are the only way to browse with filters. */
const LIST_OPTIONS = [
  ['popular', 'Popular'],
  ['trending', 'Trending'],
  ['top', 'Top rated'],
] as const;

const FIRST_YEAR = 1967;
const YEARS = Array.from({ length: new Date().getFullYear() + 1 - FIRST_YEAR + 1 }, (_, i) =>
  String(new Date().getFullYear() + 1 - i),
);

/** Browsing with filters reads at most this many list pages to fill one page of results. */
const MAX_FILTER_PAGES = 4;
const MAX_EPISODE_PAGES = 30;
/** The pages of one episode list are asked for this many at a time. */
const EPISODE_PAGES_AT_ONCE = 4;
/** The details and the episodes of a show both start from the show's record, which is fetched once for both. */
const SHOW_TTL_MS = 15_000;

interface ShowItem {
  slug?: string;
  title?: string;
  title_en?: string | null;
  title_original?: string | null;
  synopsis?: string | null;
  status?: string | null;
  type?: string | null;
  year?: number | null;
  genres?: string[] | null;
  locales?: string[] | null;
  poster?: Poster | null;
}
interface RecentItem extends ShowItem {
  watch_uri?: string;
}
interface EpisodeListItem {
  slug?: string;
  episode_number?: number | string;
  episode_string?: string;
  title?: string | null;
}

/** English title first: the site's `title` is the Japanese romaji. */
const titleOf = (item: ShowItem): string => (item.title_en?.trim() || item.title?.trim() || '').trim();

function summary(item: ShowItem | null | undefined): AnimeSummary {
  const title = item ? titleOf(item) : '';
  if (!item?.slug || !title) throw new ParseError('A show has no slug or title: the site changed');
  const cover = posterUrl(base(), item.poster, 'sm');
  return { url: item.slug, title, ...(cover && { thumbnailUrl: cover }) };
}

function dedupe(items: AnimeSummary[]): AnimeSummary[] {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(item.url) && !!seen.add(item.url));
}

interface Filters {
  genre: string;
  type: string;
  year: string;
}

/** Client-side filters: the API has none for lists and searches, but its items carry genres, type and year. */
function matches(item: ShowItem, filters: Filters): boolean {
  if (filters.genre && !(item.genres ?? []).includes(filters.genre)) return false;
  if (filters.type && item.type !== filters.type) return false;
  if (filters.year && String(item.year ?? '') !== filters.year) return false;
  return true;
}

const readFilters = (state: FilterState): Filters => {
  const genre = typeof state['genre'] === 'string' && GENRES.includes(state['genre']) ? state['genre'] : '';
  const type = TYPE_OPTIONS.some(([v]) => v === state['type']) ? (state['type'] as string) : '';
  const year = typeof state['year'] === 'string' && YEARS.includes(state['year']) ? state['year'] : '';
  return { genre, type, year };
};

interface ListRead {
  items: ShowItem[];
  hasNext: boolean;
  /** The number of the last page, when the answer says. */
  last?: number;
}

/** Fills a page: reads `MAX_FILTER_PAGES` list pages (the first one, then the others together) and keeps what matches. */
async function filtered(filters: Filters, page: number, read: (page: number) => Promise<ListRead>): Promise<AnimePage> {
  const active = filters.genre || filters.type || filters.year;
  if (!active) {
    const result = await read(page);
    return { items: dedupe(result.items.map(summary)), hasNextPage: result.hasNext };
  }
  // With a filter, "page" counts filtered pages: the site page to start from is remembered in the page number.
  const start = (page - 1) * MAX_FILTER_PAGES + 1;
  const first = await read(start);
  const items = first.items.filter((item) => matches(item, filters));
  let hasNext = first.hasNext;
  if (hasNext) {
    // The first answer tells where the list ends, so no page past it is asked for.
    const end = Math.min(start + MAX_FILTER_PAGES - 1, first.last ?? start + MAX_FILTER_PAGES - 1);
    const more = await Promise.all(Array.from({ length: end - start }, (_, i) => read(start + 1 + i)));
    for (const result of more) {
      items.push(...result.items.filter((item) => matches(item, filters)));
      hasNext = result.hasNext;
    }
  }
  return { items: dedupe(items.map(summary)), hasNextPage: hasNext };
}

async function list(kind: string, page: number): Promise<ListRead> {
  const result = await getJson<{ result?: ShowItem[]; page_count?: number }>(`/show/${kind}`, { page });
  if (!Array.isArray(result.result)) throw new ParseError('The API list has no "result": the site changed');
  return { items: result.result, hasNext: page < (result.page_count ?? page), last: result.page_count };
}

async function search(query: string, page: number): Promise<ListRead> {
  const result = await postJson<{ result?: ShowItem[]; maxPage?: number }>('/fsearch', { query, page });
  if (!Array.isArray(result.result)) throw new ParseError('The API search has no "result": the site changed');
  return { items: result.result, hasNext: page < (result.maxPage ?? page), last: result.maxPage };
}

/** The audio/subtitle languages the app can tell apart: the original ("Sub") and the English dub. */
function languages(locales: string[] | null | undefined): { lang: string; variant: string }[] {
  const all = locales ?? [];
  const original = all.find((l) => l !== 'en-US') ?? all[0] ?? 'ja-JP';
  const found = [{ lang: original, variant: 'Sub' }];
  if (all.includes('en-US') && original !== 'en-US') found.push({ lang: 'en-US', variant: 'Dub' });
  return found;
}

/** The show's own record: the details and the episodes both need it. */
const showOf = (slug: string): Promise<ShowItem> =>
  memo(`show:${base()}:${slug}`, SHOW_TTL_MS, () => getJson<ShowItem>(`/show/${encodeURIComponent(slug)}`));

interface EpisodePage {
  result?: EpisodeListItem[];
  pages?: unknown[];
  current_page?: number;
}

async function episodePage(show: string, lang: string, page: number): Promise<EpisodePage> {
  const result = await getJson<EpisodePage>(`/show/${encodeURIComponent(show)}/episodes`, { page, lang });
  if (!Array.isArray(result.result)) throw new ParseError('The API episode list has no "result": the site changed');
  return result;
}

/** The first page says how many there are; the others are asked for a few at a time. */
async function episodesOf(show: string, lang: string): Promise<EpisodeListItem[]> {
  const first = await episodePage(show, lang, 1);
  const items = [...(first.result as EpisodeListItem[])];
  const count = Math.min(MAX_EPISODE_PAGES, Array.isArray(first.pages) ? first.pages.length : 1);
  if (items.length === 0 || count < 2) return items;
  const pages = Array.from({ length: count - 1 }, (_, i) => i + 2);
  for (const result of await mapLimit(pages, EPISODE_PAGES_AT_ONCE, (page) => episodePage(show, lang, page))) {
    items.push(...(result.result as EpisodeListItem[]));
  }
  return items;
}

export default defineExtension({
  preferences: () => [
    {
      type: 'text',
      key: 'baseUrl',
      label: 'Site address',
      description: 'The JSON API lives under /api on the same address (other KickAssAnime domains redirect here).',
      default: DEFAULT_BASE_URL,
    },
  ],

  createSource: () => ({
    get baseUrl() {
      return base();
    },

    getPopular: async (page) => {
      const result = await list('popular', page);
      return { items: dedupe(result.items.map(summary)), hasNextPage: result.hasNext };
    },

    /** The newest sub releases (one entry per episode), shown as the shows they belong to. */
    async getLatest(page: number): Promise<AnimePage> {
      const result = await getJson<{ result?: RecentItem[]; hadNext?: boolean }>('/show/recent', { type: 'sub', page });
      if (!Array.isArray(result.result)) throw new ParseError('The API list has no "result": the site changed');
      return { items: dedupe(result.result.map(summary)), hasNextPage: result.hadNext === true };
    },

    async search(query: string, page: number, state: FilterState): Promise<AnimePage> {
      const filters = readFilters(state);
      const text = query.trim();
      if (text) return filtered(filters, page, (n) => search(text, n));
      const chosen = LIST_OPTIONS.find(([v]) => v === state['list'])?.[0] ?? 'popular';
      return filtered(filters, page, (n) => list(chosen, n));
    },

    getFilters: (): Filter[] => [
      {
        type: 'header',
        label:
          'The site cannot filter: genre, type and year are applied to the pages read, so a rare combination may need several pages.',
      },
      {
        type: 'select',
        id: 'list',
        label: 'Browse',
        options: LIST_OPTIONS.map(([value, label]) => ({ value, label })),
        default: 'popular',
      },
      {
        type: 'select',
        id: 'genre',
        label: 'Genre',
        options: [{ value: '', label: 'Any' }, ...GENRES.map((g) => ({ value: g, label: g }))],
        default: '',
      },
      {
        type: 'select',
        id: 'type',
        label: 'Type',
        options: TYPE_OPTIONS.map(([value, label]) => ({ value, label })),
        default: '',
      },
      {
        type: 'select',
        id: 'year',
        label: 'Year',
        options: [{ value: '', label: 'Any' }, ...YEARS.map((y) => ({ value: y, label: y }))],
        default: '',
      },
    ],

    async getAnimeDetails(anime: AnimeSummary): Promise<AnimeDetails> {
      const data = await showOf(anime.url);
      const title = titleOf(data);
      if (!title) throw new ParseError('The show has no title: the site changed');
      const alt = [data.title, data.title_original]
        .map((name) => name?.trim() ?? '')
        .filter((name, i, all) => name && name !== title && all.indexOf(name) === i);
      const genres = (data.genres ?? []).filter(Boolean);
      return {
        url: anime.url,
        title,
        thumbnailUrl: posterUrl(base(), data.poster, 'hq'),
        altTitles: alt.length > 0 ? alt : undefined,
        description: data.synopsis?.trim() || undefined,
        genres: genres.length > 0 ? genres : undefined,
        year: typeof data.year === 'number' ? data.year : undefined,
        status: STATUSES[data.status ?? ''] ?? 'unknown',
        type: TYPES[data.type ?? ''],
      };
    },

    /** The sub list, plus the English dub as its own entries (same number, `variant: "Dub"`). Newest first. */
    async getEpisodes(anime: AnimeSummary): Promise<Episode[]> {
      const show = await showOf(anime.url);
      const episodes: Episode[] = [];
      const seen = new Set<string>();
      // The sub and the dub are two lists: they are read together.
      const lists = await Promise.all(
        languages(show.locales).map(async ({ lang, variant }) => ({
          variant,
          items: await episodesOf(anime.url, lang),
        })),
      );
      for (const { variant, items } of lists) {
        for (const item of items) {
          const raw = item.episode_string ?? item.episode_number;
          const number = Number(item.episode_number ?? raw);
          if (!item.slug || raw === undefined || !Number.isFinite(number)) continue;
          const url = `${anime.url}/${episodePart(String(raw), item.slug)}`;
          if (seen.has(url)) continue;
          seen.add(url);
          episodes.push({ url, name: item.title?.trim() || `Episode ${raw}`, number, variant });
        }
      }
      // Newest first, the sub before the dub of the same number.
      return episodes.sort(
        (a, b) => (b.number ?? 0) - (a.number ?? 0) || (a.variant === 'Sub' ? -1 : 1) - (b.variant === 'Sub' ? -1 : 1),
      );
    },

    getStreams,

    resolveUrl(url: string): AnimeSummary | null {
      const match = /^https?:\/\/(?:www\.)?(?:kaa\.lt|kickass-anime\.ru)\/([^/?#]+)/i.exec(url);
      const slug = match?.[1];
      return slug && !/^(?:api|image|anime|schedule|search)$/i.test(slug)
        ? { url: slug, title: slug.replace(/-[0-9a-f]{4}$/, '').replace(/-/g, ' ') }
        : null;
    },

    getWebUrl: (item: AnimeSummary | Episode) => `${base()}/${item.url}`,
  }),
});
