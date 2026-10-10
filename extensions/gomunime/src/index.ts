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
import { DEFAULT_BASE_URL, base, fetchPage, sharedFetch } from './site';
import { getStreams } from './streams';
import {
  collapse,
  entityPath,
  parseEpisodeDate,
  parseNumber,
  parseStatus,
  parseType,
  episodeSeries,
  parseYear,
  seriesOfEpisode,
} from './text';

// gomunime.top: a Laravel site with server-rendered HTML (no JSON API) and Indonesian subtitles.
// Entity urls are paths: "/<series-slug>" for an anime, "/<series-slug>-episode-<n>" for an episode.

const EMPTY: AnimePage = { items: [], hasNextPage: false };

/** Genres the site links to (`/genre/<slug>`). */
const GENRES: [slug: string, label: string][] = [
  ['action', 'Action'],
  ['adult-cast', 'Adult Cast'],
  ['adventure', 'Adventure'],
  ['anthropomorphic', 'Anthropomorphic'],
  ['avant-garde', 'Avant Garde'],
  ['award-winning', 'Award Winning'],
  ['cgdct', 'CGDCT'],
  ['childcare', 'Childcare'],
  ['comedy', 'Comedy'],
  ['crossdressing', 'Crossdressing'],
  ['delinquents', 'Delinquents'],
  ['detective', 'Detective'],
  ['drama', 'Drama'],
  ['ecchi', 'Ecchi'],
  ['educational', 'Educational'],
  ['fantasy', 'Fantasy'],
  ['gag-humor', 'Gag Humor'],
  ['girls-love', 'Girls Love'],
  ['gore', 'Gore'],
  ['harem', 'Harem'],
  ['historical', 'Historical'],
  ['isekai', 'Isekai'],
  ['martial-arts', 'Martial Arts'],
  ['military', 'Military'],
  ['music', 'Music'],
  ['mystery', 'Mystery'],
  ['mythology', 'Mythology'],
  ['organized-crime', 'Organized Crime'],
  ['psychological', 'Psychological'],
  ['reincarnation', 'Reincarnation'],
  ['romance', 'Romance'],
  ['school', 'School'],
  ['sci-fi', 'Sci-Fi'],
  ['seinen', 'Seinen'],
  ['shoujo', 'Shoujo'],
  ['shounen', 'Shounen'],
  ['slice-of-life', 'Slice of Life'],
  ['supernatural', 'Supernatural'],
  ['suspense', 'Suspense'],
  ['time-travel', 'Time Travel'],
  ['urban-fantasy', 'Urban Fantasy'],
];

const STATUS_OPTIONS = [
  ['', 'Any'],
  ['ongoing', 'Ongoing'],
  ['completed', 'Completed'],
] as const;

const TYPE_OPTIONS = [
  ['', 'Any'],
  ['movie', 'Movie'],
] as const;

const allowed = (filters: FilterState, id: string, options: readonly (readonly [string, string])[]): string => {
  const value = filters[id];
  return typeof value === 'string' && options.some(([v]) => v === value) ? value : '';
};

/** Reads series cards (`a.card-netflix`); episode cards (the home "Episode Terbaru") become their series. */
function readCards(root: HtmlElement, baseUrl: string): AnimeSummary[] {
  const items: AnimeSummary[] = [];
  const seen = new Set<string>();
  for (const card of root.select('a.card-netflix')) {
    const href = card.attr('href');
    if (!href) continue;
    const path = entityPath(href, baseUrl);
    // An episode card (home "Episode Terbaru") names its series in `p.uppercase`; its path is the series path plus
    // "-episode-<n>", or on some older entries just "-<n>".
    const seriesTitle = collapse(card.selectFirst('p.uppercase')?.text() ?? '');
    const url = seriesTitle ? episodeSeries(path) : path;
    const title = seriesTitle || collapse(card.selectFirst('h3')?.text() ?? '');
    if (!title) throw new ParseError('A card has no title: the site layout changed');
    if (seen.has(url)) continue;
    seen.add(url);
    const cover = card.selectFirst('img')?.absUrl('src');
    items.push({ url, title, ...(cover && { thumbnailUrl: cover }) });
  }
  return items;
}

/** The cards of the home section whose heading contains `heading`. */
function homeSection(doc: HtmlElement, baseUrl: string, heading: string): AnimeSummary[] {
  for (const section of doc.select('section')) {
    if (collapse(section.selectFirst('h2.section-title')?.text() ?? '').includes(heading)) {
      const items = readCards(section, baseUrl);
      if (items.length > 0) return items;
    }
  }
  throw new ParseError(`The home page has no "${heading}" row: the site layout changed`);
}

/** Pages are shared between calls that start together: details and episodes of an anime, the home's rows. */
async function fetchDoc(path: string): Promise<{ doc: HtmlElement; url: string }> {
  const url = `${base()}${path}`;
  return { doc: html.load((await sharedFetch(url, fetchPage)).text, { baseUrl: url }), url };
}

/** A grid page (`?page=N`). A page past the end is empty. */
async function listing(path: string, page: number): Promise<AnimePage> {
  const n = Math.max(1, Math.floor(page));
  const joiner = path.includes('?') ? '&' : '?';
  let loaded;
  try {
    loaded = await fetchDoc(n > 1 ? `${path}${joiner}page=${n}` : path);
  } catch (error) {
    if (n > 1 && error instanceof NotFoundError) return EMPTY;
    throw error;
  }
  const items = readCards(loaded.doc, loaded.url);
  if (items.length === 0 && !loaded.doc.selectFirst('footer, nav')) {
    throw new ParseError('The listing has no cards and no page frame: the site layout changed');
  }
  const hasNextPage = loaded.doc.select('a[href]').some((a) => {
    const href = a.attr('href') ?? '';
    return href.endsWith(`page=${n + 1}`);
  });
  return { items, hasNextPage };
}

async function homeRow(heading: string): Promise<AnimeSummary[]> {
  const { doc, url } = await fetchDoc('/');
  return homeSection(doc, url, heading);
}

/** `/<slug>`: the page of an anime. */
async function animePage(anime: AnimeSummary): Promise<HtmlElement> {
  const { doc } = await fetchDoc(anime.url);
  if (!doc.selectFirst('h1')) throw new ParseError('The anime page has no title: the site layout changed');
  return doc;
}

export default defineExtension({
  preferences: () => [
    {
      type: 'text',
      key: 'baseUrl',
      label: 'Site address',
      description: 'Libraries store paths, so they survive a change of domain.',
      default: DEFAULT_BASE_URL,
    },
  ],

  createSource: () => ({
    get baseUrl() {
      return base();
    },

    /** Page 1 is the home "Lagi Trending" row (no paging there); the rest follows the top MAL scores. */
    async getPopular(page: number): Promise<AnimePage> {
      if (page <= 1) return { items: await homeRow('Trending'), hasNextPage: true };
      return listing('/koleksi/anime-skor-mal-tertinggi', page);
    },

    /** Page 1 is the home "Episode Terbaru" row (newest episodes, one card per series); the rest is the ongoing list. */
    async getLatest(page: number): Promise<AnimePage> {
      if (page <= 1) return { items: await homeRow('Episode Terbaru'), hasNextPage: true };
      return listing('/status/ongoing', page - 1);
    },

    search(query: string, page: number, filters: FilterState): Promise<AnimePage> {
      const text = query.trim();
      if (text) {
        // One page of results; the site's search ignores the filters.
        if (page > 1) return Promise.resolve(EMPTY);
        return listing(`/search?${new URLSearchParams({ q: text }).toString()}`, 1);
      }
      // The site cannot combine them: the genre wins, then the status, then the type.
      const genre = filters['genre'];
      if (typeof genre === 'string' && GENRES.some(([slug]) => slug === genre)) return listing(`/genre/${genre}`, page);
      const status = allowed(filters, 'status', STATUS_OPTIONS);
      if (status) return listing(`/status/${status}`, page);
      const type = allowed(filters, 'type', TYPE_OPTIONS);
      if (type) return listing(`/type/${type}`, page);
      return listing('/status/ongoing', page);
    },

    getFilters: (): Filter[] => [
      {
        type: 'header',
        label:
          'The site cannot combine these: the genre wins, then the status, then the type. They apply only when the search box is empty.',
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
        default: '',
      },
    ],

    async getAnimeDetails(anime: AnimeSummary): Promise<AnimeDetails> {
      const doc = await animePage(anime);
      const title = collapse(doc.selectFirst('h1')?.text() ?? '');
      if (!title) throw new ParseError('The anime page has no title');
      const article = doc.selectFirst('article') ?? doc;

      // `<p><span>Anime</span> <title> Sub Indo · Alt one, Alt two</p>`
      const subtitle = collapse(article.selectFirst('h1 + p')?.text() ?? '');
      const alt = (subtitle.includes('·') ? subtitle.slice(subtitle.indexOf('·') + 1) : '')
        .split(',')
        .map(collapse)
        .filter((name, i, all) => name && name.toLowerCase() !== title.toLowerCase() && all.indexOf(name) === i);

      const genres = article
        .select('a[href*="/genre/"]')
        .map((a) => collapse(a.text()))
        .filter(Boolean);
      const stats = new Map<string, string>();
      for (const row of article.select('dl > div')) {
        const label = collapse(row.selectFirst('dt')?.text() ?? '').toLowerCase();
        const value = collapse(row.selectFirst('dd')?.text() ?? '');
        if (label && value) stats.set(label, value);
      }
      const synopsis = collapse(doc.selectFirst('.prose')?.text() ?? '');
      const cover = article.selectFirst('img')?.absUrl('src');
      return {
        url: anime.url,
        title,
        thumbnailUrl: cover || undefined,
        altTitles: alt.length > 0 ? alt : undefined,
        description: synopsis || undefined,
        genres: genres.length > 0 ? genres : undefined,
        studio: stats.get('studio'),
        year: parseYear(article.selectFirst('a[href*="/tahun/"]')?.text()),
        status: parseStatus(article.selectFirst('span.badge')?.text() ?? ''),
        type: parseType(article.selectFirst('span.badge-sub')?.text() ?? ''),
      };
    },

    /** The page lists every episode at once; the contract is newest first. */
    async getEpisodes(anime: AnimeSummary): Promise<Episode[]> {
      const doc = await animePage(anime);
      const seen = new Set<string>();
      const episodes: Episode[] = [];
      for (const link of doc.select('#episode-list a.ept')) {
        const href = link.attr('href');
        if (!href) continue;
        const url = entityPath(href, base());
        if (seen.has(url)) continue;
        seen.add(url);
        const number = parseNumber(link.attr('data-n') ?? link.selectFirst('b')?.text());
        const dates = link.select('small').map((s) => s.text());
        episodes.push({
          url,
          name: number !== undefined ? `Episode ${number}` : collapse(link.text()),
          ...(number !== undefined && { number }),
          uploadedAt: parseEpisodeDate(dates[dates.length - 1] ?? ''),
        });
      }
      if (episodes.length === 0 && !doc.selectFirst('#episode-list')) {
        throw new ParseError('The anime page has no episode list: the site layout changed');
      }
      // Newest first. Array.sort is stable, so unnumbered entries keep the page order, after the numbered ones.
      return episodes.sort((a, b) => (b.number ?? -Infinity) - (a.number ?? -Infinity) || 0);
    },

    getStreams,

    resolveUrl(url: string): AnimeSummary | null {
      const match = /^https?:\/\/(?:www\.)?gomunime\.[a-z]+\/([^/?#]+)\/?(?:[?#].*)?$/i.exec(url);
      const slug = match?.[1];
      if (!slug || /^(?:genre|status|type|tahun|studio|search|koleksi|api|storage)$/.test(slug)) return null;
      const series = seriesOfEpisode(`/${slug}`) ?? `/${slug}`;
      return { url: series, title: series.slice(1).replace(/-/g, ' ') };
    },

    getWebUrl: (item: AnimeSummary | Episode) => `${base()}${item.url}`,
  }),
});
