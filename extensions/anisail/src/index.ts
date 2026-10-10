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
import { DEFAULT_BASE_URL, base, fetchPage, fetchPageShared } from './site';
import { getStreams } from './streams';
import {
  collapse,
  entityPath,
  parseNumber,
  parseStatus,
  parseType,
  parseYear,
  seriesOfEpisode,
  seriesTitle,
  titleOfEpisode,
} from './text';

// anisail.com (formerly animesail.com): a custom WordPress theme, Indonesian subtitles, anime and donghua mixed.
// Everything is read from HTML. Entity urls are paths: "/anime/<slug>/" for an anime, "/<slug>-episode-<n>/" for an
// episode. The site has no sorted lists and no status filter: latest comes from the home page's episode cards (only
// the ones marked `is-anime`, so the Chinese donghua are left out), popular from its "Lagi Rame" widget, and
// browsing from the genre archives and the movie list. The explicit genres (hentai, erotica) are not offered.

const EMPTY: AnimePage = { items: [], hasNextPage: false };

/** The genres of `/genre/` with at least 30 titles (the rest are typos and one-offs). */
const GENRES: [slug: string, label: string][] = [
  ['action', 'Action'],
  ['adult-cast', 'Adult Cast'],
  ['adventure', 'Adventure'],
  ['anthropomorphic', 'Anthropomorphic'],
  ['award-winning', 'Award Winning'],
  ['cgdct', 'CGDCT'],
  ['childcare', 'Childcare'],
  ['comedy', 'Comedy'],
  ['demons', 'Demons'],
  ['detective', 'Detective'],
  ['drama', 'Drama'],
  ['ecchi', 'Ecchi'],
  ['fantasy', 'Fantasy'],
  ['gag-humor', 'Gag Humor'],
  ['game', 'Game'],
  ['girls-love', 'Girls Love'],
  ['gore', 'Gore'],
  ['gourmet', 'Gourmet'],
  ['harem', 'Harem'],
  ['high-stakes-game', 'High Stakes Game'],
  ['historical', 'Historical'],
  ['horror', 'Horror'],
  ['idols-female', 'Idols (Female)'],
  ['isekai', 'Isekai'],
  ['iyashikei', 'Iyashikei'],
  ['josei', 'Josei'],
  ['kids', 'Kids'],
  ['love-polygon', 'Love Polygon'],
  ['magic', 'Magic'],
  ['mahou-shoujo', 'Mahou Shoujo'],
  ['martial-arts', 'Martial Arts'],
  ['mecha', 'Mecha'],
  ['military', 'Military'],
  ['music', 'Music'],
  ['mystery', 'Mystery'],
  ['mythology', 'Mythology'],
  ['organized-crime', 'Organized Crime'],
  ['otaku-culture', 'Otaku Culture'],
  ['parody', 'Parody'],
  ['performing-arts', 'Performing Arts'],
  ['police', 'Police'],
  ['psychological', 'Psychological'],
  ['racing', 'Racing'],
  ['reincarnation', 'Reincarnation'],
  ['romance', 'Romance'],
  ['romantic-subtext', 'Romantic Subtext'],
  ['samurai', 'Samurai'],
  ['school', 'School'],
  ['sci-fi', 'Sci-Fi'],
  ['seinen', 'Seinen'],
  ['shoujo', 'Shoujo'],
  ['shoujo-ai', 'Shoujo Ai'],
  ['shounen', 'Shounen'],
  ['slice-of-life', 'Slice of Life'],
  ['space', 'Space'],
  ['sports', 'Sports'],
  ['strategy-game', 'Strategy Game'],
  ['super-power', 'Super Power'],
  ['supernatural', 'Supernatural'],
  ['survival', 'Survival'],
  ['suspense', 'Suspense'],
  ['team-sports', 'Team Sports'],
  ['thriller', 'Thriller'],
  ['time-travel', 'Time Travel'],
];

const TYPE_OPTIONS = [
  ['', 'Any'],
  ['movie', 'Movie'],
] as const;

async function fetchDoc(path: string, fetch = fetchPage): Promise<{ doc: HtmlElement; url: string }> {
  const url = `${base()}${path}`;
  return { doc: html.load((await fetch(url)).text, { baseUrl: url }), url };
}

/** A next-page link: the theme's `.hpage a.r` or WordPress' `a.next.page-numbers`. */
const hasNext = (doc: HtmlElement): boolean => doc.selectFirst('.hpage a.r, a.next.page-numbers') !== null;

const cover = (card: HtmlElement): string | undefined => card.selectFirst('img')?.absUrl('src') || undefined;

/** Series cards (`article.bsz`): genre archives, movies and search. */
function readSeriesCards(doc: HtmlElement, baseUrl: string): AnimeSummary[] {
  const items: AnimeSummary[] = [];
  const seen = new Set<string>();
  for (const card of doc.select('article.bsz')) {
    const link = card.selectFirst('a');
    const href = link?.attr('href');
    const title = seriesTitle(card.selectFirst('h2')?.text() ?? link?.attr('title') ?? '');
    if (!href || !title) throw new ParseError('A card has no link or title: the site layout changed');
    const url = entityPath(href, baseUrl);
    if (seen.has(url)) continue;
    seen.add(url);
    const thumbnailUrl = cover(card);
    items.push({ url, title, ...(thumbnailUrl && { thumbnailUrl }) });
  }
  return items;
}

/** Episode cards (`article.bs.is-anime`) as the series they belong to, one card each. */
function readEpisodeCards(doc: HtmlElement, baseUrl: string): AnimeSummary[] {
  const items: AnimeSummary[] = [];
  const seen = new Set<string>();
  for (const card of doc.select('article.bs.is-anime')) {
    const link = card.selectFirst('a');
    const href = link?.attr('href');
    const url = href ? seriesOfEpisode(entityPath(href, baseUrl)) : null;
    const title = titleOfEpisode(card.selectFirst('h2')?.text() ?? link?.attr('title') ?? '');
    if (!url || !title) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const thumbnailUrl = cover(card);
    items.push({ url, title, ...(thumbnailUrl && { thumbnailUrl }) });
  }
  return items;
}

/** `path` is the first page; later pages are `<prefix>/page/N/`. A page past the end is empty. */
async function listing(path: string, kind: 'episodes' | 'series', page: number, prefix = ''): Promise<AnimePage> {
  const n = Math.max(1, Math.floor(page));
  let loaded;
  try {
    loaded = await fetchDoc(n > 1 ? `${prefix}/page/${n}/` : path);
  } catch (error) {
    if (n > 1 && error instanceof NotFoundError) return EMPTY;
    throw error;
  }
  const items =
    kind === 'episodes' ? readEpisodeCards(loaded.doc, loaded.url) : readSeriesCards(loaded.doc, loaded.url);
  if (items.length === 0 && !loaded.doc.selectFirst('#footer, #sidebar, .pagination, .hpage')) {
    throw new ParseError('The listing has no cards and no page frame: the site layout changed');
  }
  return { items, hasNextPage: hasNext(loaded.doc) };
}

async function animePage(anime: AnimeSummary): Promise<HtmlElement> {
  const { doc } = await fetchDoc(anime.url, fetchPageShared);
  if (!doc.selectFirst('h1.entry-title')) throw new ParseError('The anime page has no title: the site layout changed');
  return doc;
}

/** The info table: `<tr><th>Label:</th><td>value</td></tr>`. */
function readInfo(doc: HtmlElement): (label: string) => string | undefined {
  const rows = new Map<string, string>();
  for (const row of doc.select('.serial-info table tr')) {
    const label = collapse(row.selectFirst('th')?.text() ?? '')
      .replace(/:$/, '')
      .toLowerCase();
    const value = collapse(row.selectFirst('td')?.text() ?? '');
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
      description: 'The site was called animesail.com before (it redirects). Libraries store paths, so they survive.',
      default: DEFAULT_BASE_URL,
    },
  ],

  createSource: () => ({
    get baseUrl() {
      return base();
    },

    /** The "Lagi Rame" (busiest now) widget of the home page: about ten series, no paging. */
    async getPopular(page: number): Promise<AnimePage> {
      if (page > 1) return EMPTY;
      const { doc, url } = await fetchDoc('/');
      const items: AnimeSummary[] = [];
      for (const row of doc.select('#as-rtp-wgt li')) {
        const link = row.selectFirst('h2 a') ?? row.selectFirst('a.series');
        const href = link?.attr('href');
        const title = seriesTitle(link?.text() ?? '');
        if (!href || !title) continue;
        const thumbnailUrl = cover(row);
        items.push({ url: entityPath(href, url), title, ...(thumbnailUrl && { thumbnailUrl }) });
      }
      if (items.length === 0) throw new ParseError('The home page has no "Lagi Rame" widget: the site layout changed');
      return { items, hasNextPage: false };
    },

    /** The newest anime episodes of the home page and `/page/N/`, one card per series. */
    getLatest: (page: number) => listing('/', 'episodes', page, ''),

    search(query: string, page: number, filters: FilterState): Promise<AnimePage> {
      const text = query.trim();
      if (text) {
        // One page of results (13 at most); the site's search ignores the filters.
        if (page > 1) return Promise.resolve(EMPTY);
        return listing(`/?${new URLSearchParams({ s: text }).toString()}`, 'series', 1);
      }
      // The site cannot combine them: the genre wins over the type. With neither, the newest episodes.
      const genre = filters['genre'];
      if (typeof genre === 'string' && GENRES.some(([slug]) => slug === genre)) {
        return listing(`/genres/${genre}/`, 'series', page, `/genres/${genre}`);
      }
      if (filters['type'] === 'movie') return listing('/movie-terbaru/', 'series', page, '/movie-terbaru');
      return listing('/', 'episodes', page, '');
    },

    getFilters: (): Filter[] => [
      {
        type: 'header',
        label:
          'The site cannot combine these: the genre wins over the type. They apply only when the search box is empty.',
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
        id: 'type',
        label: 'Type',
        options: TYPE_OPTIONS.map(([value, label]) => ({ value, label })),
        default: '',
      },
    ],

    async getAnimeDetails(anime: AnimeSummary): Promise<AnimeDetails> {
      const doc = await animePage(anime);
      const info = readInfo(doc);
      const title = seriesTitle(doc.selectFirst('h1.entry-title')?.text() ?? '');
      if (!title) throw new ParseError('The anime page has no title');
      const alt = (info('Alternatif') ?? '')
        .split(',')
        .map(collapse)
        .filter((name, i, all) => name && name.toLowerCase() !== title.toLowerCase() && all.indexOf(name) === i);
      const genres = doc
        .select('.serial-info table a[rel=tag][href*="/genres/"]')
        .map((a) => collapse(a.text()))
        .filter(Boolean);
      const synopsis = doc
        .select('.serial-info > p')
        .map((p) => collapse(p.text()))
        .filter(Boolean)
        .join('\n\n');
      const thumbnailUrl = doc.selectFirst('.serial-info img')?.absUrl('src');
      return {
        url: anime.url,
        title,
        thumbnailUrl: thumbnailUrl || undefined,
        altTitles: alt.length > 0 ? alt : undefined,
        description: synopsis || undefined,
        genres: genres.length > 0 ? genres : undefined,
        studio: info('Studio'),
        year: parseYear(info('Dirilis')),
        status: parseStatus(info('Status') ?? ''),
        type: parseType(info('Tipe') ?? ''),
      };
    },

    /** The page lists the episodes newest first, with no dates. */
    async getEpisodes(anime: AnimeSummary): Promise<Episode[]> {
      const doc = await animePage(anime);
      const seen = new Set<string>();
      const episodes: Episode[] = [];
      for (const link of doc.select('ul.daftar li a')) {
        const href = link.attr('href');
        if (!href) continue;
        const url = entityPath(href, base());
        if (seen.has(url)) continue;
        seen.add(url);
        const label = collapse(link.text());
        const number = parseNumber(label);
        episodes.push({
          url,
          name: number !== undefined ? `Episode ${number}` : seriesTitle(label),
          ...(number !== undefined && { number }),
        });
      }
      if (episodes.length === 0 && !doc.selectFirst('ul.daftar')) {
        throw new ParseError('The anime page has no episode list: the site layout changed');
      }
      // A film is "episode 1" of itself.
      const only = episodes.length === 1 ? episodes[0] : undefined;
      if (only && only.number === undefined) only.number = 1;
      // Newest first. Array.sort is stable, so unnumbered entries keep the page order, after the numbered ones.
      return episodes.sort((a, b) => (b.number ?? -Infinity) - (a.number ?? -Infinity) || 0);
    },

    getStreams,

    resolveUrl(url: string): AnimeSummary | null {
      const match = /^https?:\/\/(?:www\.)?(?:anisail|animesail)\.[a-z]+\/([^?#]*)/i.exec(url);
      const parts = (match?.[1] ?? '').split('/').filter(Boolean);
      const first = parts[0];
      if (!first) return null;
      if (first === 'anime' && parts[1]) return { url: `/anime/${parts[1]}/`, title: parts[1].replace(/-/g, ' ') };
      const series = parts.length === 1 ? seriesOfEpisode(`/${first}/`) : null;
      return series ? { url: series, title: (series.split('/')[2] ?? '').replace(/-/g, ' ') } : null;
    },

    getWebUrl: (item: AnimeSummary | Episode) => `${base()}${item.url}`,
  }),
});
