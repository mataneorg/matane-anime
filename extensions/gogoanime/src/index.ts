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
import { DEFAULT_BASE_URL, base, fetchPage, memo } from './site';
import { getStreams } from './streams';
import { collapse, entityPath, fullCover, isDub, parseNumber, parseStatus, parseType, releaseYear } from './text';

// gogoanime.by (a look-alike of the old Gogoanime): WordPress with the DramaStream theme, English. Everything is read
// from HTML. Entity urls are paths: "/series/<slug>/" for a series, "/<slug>-episode-<n>-english-subbed/" (or
// "-english-dubbed/") for an episode. The dub is a separate series with its own episodes, found by searching for
// "dubbed"; its episodes are marked `variant: "Dub"`. The site mixes in dramas and TV shows: lists ask for
// `type=anime` unless another type is chosen.

const EMPTY: AnimePage = { items: [], hasNextPage: false };
/** The details and the episodes of a series come from one page, which is fetched once for both. */
const SERIES_TTL_MS = 15_000;

/** The site's genre checkboxes (`/series/` filter form). */
const GENRES: [slug: string, label: string][] = [
  ['action', 'Action'],
  ['adult-cast', 'Adult Cast'],
  ['adventure', 'Adventure'],
  ['avant-garde', 'Avant Garde'],
  ['award-winning', 'Award Winning'],
  ['boys-love', 'Boys Love'],
  ['comedy', 'Comedy'],
  ['drama', 'Drama'],
  ['ecchi', 'Ecchi'],
  ['fantasy', 'Fantasy'],
  ['girls-love', 'Girls Love'],
  ['gore', 'Gore'],
  ['gourmet', 'Gourmet'],
  ['historical', 'Historical'],
  ['horror', 'Horror'],
  ['isekai', 'Isekai'],
  ['mahou-shoujo', 'Mahou Shoujo'],
  ['mecha', 'Mecha'],
  ['military', 'Military'],
  ['music', 'Music'],
  ['mystery', 'Mystery'],
  ['psychological', 'Psychological'],
  ['reincarnation', 'Reincarnation'],
  ['romance', 'Romance'],
  ['sci-fi', 'Sci-Fi'],
  ['shounen', 'Shounen'],
  ['slice-of-life', 'Slice of Life'],
  ['sports', 'Sports'],
  ['supernatural', 'Supernatural'],
  ['survival', 'Survival'],
  ['suspense', 'Suspense'],
  ['thriller', 'Thriller'],
  ['urban-fantasy', 'Urban Fantasy'],
];

const STATUS_OPTIONS = [
  ['', 'Any'],
  ['ongoing', 'Ongoing'],
  ['completed', 'Completed'],
  ['upcoming', 'Upcoming'],
] as const;

/** The default is `anime`: without it the lists are mostly dramas. */
const TYPE_OPTIONS = [
  ['anime', 'Anime'],
  ['movie', 'Movie'],
  ['special', 'Special'],
  ['tv show', 'TV show'],
] as const;

const ORDER_OPTIONS = [
  ['update', 'Latest update'],
  ['popular', 'Popular'],
  ['rating', 'Rating'],
  ['latest', 'Latest added'],
  ['title', 'A-Z'],
  ['titlereverse', 'Z-A'],
] as const;

const pick = (filters: FilterState, id: string, allowed: readonly (readonly [string, string])[]): string => {
  const value = filters[id];
  return typeof value === 'string' && allowed.some(([v]) => v === value) ? value : '';
};

/** Reads the cards of a listing (`article.bs`), leaving out the dramas a search mixes in. */
function readCards(doc: HtmlElement, baseUrl: string): AnimeSummary[] {
  const items: AnimeSummary[] = [];
  const seen = new Set<string>();
  for (const card of doc.select('article.bs')) {
    const link = card.selectFirst('a[itemprop=url]') ?? card.selectFirst('a');
    const href = link?.attr('href');
    const title = collapse(card.selectFirst('.tt h2')?.text() ?? link?.attr('title') ?? '');
    if (!href || !title) throw new ParseError('A card has no link or title: the site layout changed');
    if (collapse(card.selectFirst('.typez')?.text() ?? '').toLowerCase() === 'drama') continue;
    const url = entityPath(href, baseUrl);
    if (seen.has(url)) continue;
    seen.add(url);
    const cover = fullCover(card.selectFirst('img')?.absUrl('src'));
    items.push({ url, title, ...(cover && { thumbnailUrl: cover }) });
  }
  return items;
}

async function listing(path: string, page: number): Promise<AnimePage> {
  const url = `${base()}${path}`;
  let text: string;
  try {
    text = (await fetchPage(url)).text;
  } catch (error) {
    if (page > 1 && error instanceof NotFoundError) return EMPTY;
    throw error;
  }
  const doc = html.load(text, { baseUrl: url });
  const items = readCards(doc, url);
  if (items.length === 0 && !doc.selectFirst('#sidebar, .listupd')) {
    throw new ParseError('The listing has no cards and no page frame: the site layout changed');
  }
  return { items, hasNextPage: doc.selectFirst('.hpage a.r, a.next.page-numbers') !== null };
}

function browse(params: Record<string, string>, genre: string | undefined, page: number): Promise<AnimePage> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.append(key, value);
  if (genre) query.append('genre[]', genre);
  if (page > 1) query.set('page', String(Math.floor(page)));
  return listing(`/series/?${query.toString()}`, page);
}

async function seriesPage(anime: AnimeSummary): Promise<HtmlElement> {
  const url = `${base()}${anime.url}`;
  const response = await memo(url, SERIES_TTL_MS, () => fetchPage(url));
  const doc = html.load(response.text, { baseUrl: url });
  if (!doc.selectFirst('h1.entry-title')) {
    // A series that does not exist is redirected to the home page.
    if (new URL(response.url || url).pathname !== new URL(url).pathname)
      throw new NotFoundError(`Not found: ${anime.url}`);
    throw new ParseError('The series page has no title: the site layout changed');
  }
  return doc;
}

/** `<span><b>Label:</b> value</span>` rows of the info block. */
function readInfo(doc: HtmlElement): (label: string) => string | undefined {
  const lines = doc.select('.spe span').map((span) => collapse(span.text()));
  return (label) => {
    const prefix = `${label.toLowerCase()}:`;
    const line = lines.find((l) => l.toLowerCase().startsWith(prefix));
    const value = line?.slice(prefix.length).trim();
    return value && !/^(?:\?|-|unknown)$/i.test(value) ? value : undefined;
  };
}

export default defineExtension({
  preferences: () => [
    {
      type: 'text',
      key: 'baseUrl',
      label: 'Site address',
      description: 'This name is used by many unrelated look-alike sites: change it if the domain stops working.',
      default: DEFAULT_BASE_URL,
    },
  ],

  createSource: () => ({
    get baseUrl() {
      return base();
    },

    getPopular: (page) => browse({ order: 'popular', type: 'anime' }, undefined, page),

    /** Series ordered by their newest episode. */
    getLatest: (page) => browse({ order: 'update', type: 'anime' }, undefined, page),

    search(query: string, page: number, filters: FilterState): Promise<AnimePage> {
      const text = query.trim();
      if (text) {
        // The site's own search ignores the filters (and finds the dubs: they are series named "… Dubbed").
        const path = page > 1 ? `/page/${Math.floor(page)}/` : '/';
        return listing(`${path}?${new URLSearchParams({ s: text }).toString()}`, page);
      }
      const genre = filters['genre'];
      return browse(
        {
          status: pick(filters, 'status', STATUS_OPTIONS),
          type: pick(filters, 'type', TYPE_OPTIONS) || 'anime',
          order: pick(filters, 'order', ORDER_OPTIONS) || 'update',
        },
        typeof genre === 'string' && GENRES.some(([slug]) => slug === genre) ? genre : undefined,
        page,
      );
    },

    getFilters: (): Filter[] => [
      {
        type: 'header',
        label: 'These filters apply only when the search box is empty. For a dub, search for "dubbed".',
      },
      {
        type: 'select',
        id: 'genre',
        label: 'Genre',
        options: [{ value: '', label: 'Any' }, ...GENRES.map(([value, label]) => ({ value, label }))],
        default: '',
      },
      {
        type: 'select',
        id: 'status',
        label: 'Status',
        options: STATUS_OPTIONS.map(([value, label]) => ({ value, label })),
        default: '',
      },
      {
        type: 'select',
        id: 'type',
        label: 'Type',
        options: TYPE_OPTIONS.map(([value, label]) => ({ value, label })),
        default: 'anime',
      },
      {
        type: 'select',
        id: 'order',
        label: 'Order by',
        options: ORDER_OPTIONS.map(([value, label]) => ({ value, label })),
        default: 'update',
      },
    ],

    async getAnimeDetails(anime: AnimeSummary): Promise<AnimeDetails> {
      const doc = await seriesPage(anime);
      const info = readInfo(doc);
      const title = collapse(doc.selectFirst('h1.entry-title')?.text() ?? '');
      if (!title) throw new ParseError('The series page has no title');
      const english = collapse(doc.selectFirst('.ninfo h2')?.text() ?? '');
      const synopsis = doc
        .select('.ninfo p')
        .map((p) => collapse(p.text()))
        .filter(Boolean)
        .join('\n\n');
      const genres = doc
        .select('.genxed a')
        .map((a) => collapse(a.text()))
        .filter(Boolean);
      const cover = fullCover(doc.selectFirst('.thumb img')?.absUrl('src'));
      return {
        url: anime.url,
        title,
        thumbnailUrl: cover || undefined,
        altTitles: english && english !== title ? [english] : undefined,
        description: synopsis || undefined,
        genres: genres.length > 0 ? genres : undefined,
        studio: info('Studio'),
        year: releaseYear(info('Released')),
        status: parseStatus(info('Status') ?? ''),
        type: parseType(info('Type') ?? ''),
      };
    },

    /** The page lists every episode, newest first, with no titles or dates. */
    async getEpisodes(anime: AnimeSummary): Promise<Episode[]> {
      const doc = await seriesPage(anime);
      const seen = new Set<string>();
      const episodes: Episode[] = [];
      for (const item of doc.select('.episodes-container .episode-item')) {
        const href = item.selectFirst('a')?.attr('href');
        if (!href) continue;
        const url = entityPath(href, base());
        if (seen.has(url)) continue;
        seen.add(url);
        const raw = Number.parseFloat(item.attr('data-episode-number') ?? '');
        const number = Number.isFinite(raw) ? raw : parseNumber(url);
        episodes.push({
          url,
          name: number !== undefined ? `Episode ${number}` : collapse(item.text()),
          ...(number !== undefined && { number }),
          variant: isDub(url) ? 'Dub' : 'Sub',
        });
      }
      if (episodes.length === 0 && !doc.selectFirst('.episodes-container')) {
        throw new ParseError('The series page has no episode list: the site layout changed');
      }
      // A film is "episode 1" of itself.
      const only = episodes.length === 1 ? episodes[0] : undefined;
      if (only && only.number === undefined) only.number = 1;
      // Newest first. Array.sort is stable, so unnumbered entries keep the page order, after the numbered ones.
      return episodes.sort((a, b) => (b.number ?? -Infinity) - (a.number ?? -Infinity) || 0);
    },

    getStreams,

    resolveUrl(url: string): AnimeSummary | null {
      const match = /^https?:\/\/(?:www\.)?gogoanime\.[a-z]+\/series\/([^/?#]+)/i.exec(url);
      const slug = match?.[1];
      return slug ? { url: `/series/${slug}/`, title: slug.replace(/-/g, ' ') } : null;
    },

    getWebUrl: (item: AnimeSummary | Episode) => `${base()}${item.url}`,
  }),
});
