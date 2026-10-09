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
import { collapse, entityPath, hasPageLink, numberOfPath, parseNumber, seriesOfEpisode } from './text';

// anime-indo.lol: a small PHP site with Indonesian subtitles, all HTML. Every path ends with a slash. Entity urls
// are paths: "/anime/<slug>/" for an anime, "/<slug>-episode-<n>/" for an episode.

const EMPTY: AnimePage = { items: [], hasNextPage: false };

/** Genres of the site's `/list-genre/` (its typo duplicates left out). */
const GENRES: [slug: string, label: string][] = [
  ['action', 'Action'],
  ['adventure', 'Adventure'],
  ['anthropomorphic', 'Anthropomorphic'],
  ['avant-garde', 'Avant Garde'],
  ['cars', 'Cars'],
  ['cgdct', 'CGDCT'],
  ['childcare', 'Childcare'],
  ['comedy', 'Comedy'],
  ['crossdressing', 'Crossdressing'],
  ['delinquents', 'Delinquents'],
  ['dementia', 'Dementia'],
  ['demons', 'Demons'],
  ['detective', 'Detective'],
  ['donghua', 'Donghua'],
  ['drama', 'Drama'],
  ['ecchi', 'Ecchi'],
  ['educational', 'Educational'],
  ['erotica', 'Erotica'],
  ['family', 'Family'],
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
  ['idols-male', 'Idols (Male)'],
  ['isekai', 'Isekai'],
  ['iyashikei', 'Iyashikei'],
  ['josei', 'Josei'],
  ['kids', 'Kids'],
  ['life', 'Life'],
  ['live-action', 'Live Action'],
  ['love-polygon', 'Love Polygon'],
  ['love-status-quo', 'Love Status Quo'],
  ['magic', 'Magic'],
  ['magical-sex-shift', 'Magical Sex Shift'],
  ['mahou-shoujo', 'Mahou Shoujo'],
  ['martial-arts', 'Martial Arts'],
  ['mecha', 'Mecha'],
  ['medical', 'Medical'],
  ['military', 'Military'],
  ['music', 'Music'],
  ['mystery', 'Mystery'],
  ['mythology', 'Mythology'],
  ['organized-crime', 'Organized Crime'],
  ['otaku-culture', 'Otaku Culture'],
  ['parody', 'Parody'],
  ['performing-arts', 'Performing Arts'],
  ['pets', 'Pets'],
  ['police', 'Police'],
  ['psychological', 'Psychological'],
  ['racing', 'Racing'],
  ['reincarnation', 'Reincarnation'],
  ['reverse-harem', 'Reverse Harem'],
  ['romance', 'Romance'],
  ['romantic-subtext', 'Romantic Subtext'],
  ['samurai', 'Samurai'],
  ['school', 'School'],
  ['sci-fi', 'Sci-Fi'],
  ['seinen', 'Seinen'],
  ['shoujo', 'Shoujo'],
  ['shoujo-ai', 'Shoujo Ai'],
  ['shounen', 'Shounen'],
  ['shounen-ai', 'Shounen Ai'],
  ['showbiz', 'Showbiz'],
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
  ['tokusatsu', 'Tokusatsu'],
  ['urban-fantasy', 'Urban Fantasy'],
  ['vampire', 'Vampire'],
  ['video-game', 'Video Game'],
  ['villainess', 'Villainess'],
  ['visual-arts', 'Visual Arts'],
  ['work-life', 'Work Life'],
  ['workplace', 'Workplace'],
  ['yaoi', 'Yaoi'],
];

const TYPE_OPTIONS = [
  ['', 'Any'],
  ['movie', 'Movie'],
] as const;

/** Reads the episode cards of the home and `/page/N/` (`div.list-anime`), one per series. */
function readEpisodeCards(doc: HtmlElement, baseUrl: string): AnimeSummary[] {
  const items: AnimeSummary[] = [];
  const seen = new Set<string>();
  for (const link of doc.select('.menu > a')) {
    const card = link.selectFirst('div.list-anime');
    const href = link.attr('href');
    if (!card || !href) continue;
    const path = entityPath(href, baseUrl);
    const url = seriesOfEpisode(path) ?? path;
    const title = collapse(card.selectFirst('p')?.text() ?? card.selectFirst('img')?.attr('alt') ?? '');
    if (!title) throw new ParseError('A card has no title: the site layout changed');
    if (seen.has(url)) continue;
    seen.add(url);
    const img = card.selectFirst('img');
    const cover = img?.absUrl('data-original') ?? img?.absUrl('src');
    items.push({ url, title, ...(cover && !cover.endsWith('/loading.gif') && { thumbnailUrl: cover }) });
  }
  return items;
}

/** Reads the table rows of search, movie and genre lists (`table.otable`) or of the Popular box (`table.ztable`). */
function readRows(doc: HtmlElement, baseUrl: string, table: 'otable' | 'ztable'): AnimeSummary[] {
  const items: AnimeSummary[] = [];
  const seen = new Set<string>();
  for (const row of doc.select(`table.${table}`)) {
    const link = row.selectFirst(table === 'otable' ? 'td.videsc a' : 'td.zvidesc a');
    const href = link?.attr('href');
    const title = collapse(link?.text() ?? '');
    if (!href || !title) throw new ParseError('A row has no link or title: the site layout changed');
    const url = entityPath(href, baseUrl);
    if (seen.has(url)) continue;
    seen.add(url);
    const cover = row.selectFirst('img')?.absUrl('src');
    items.push({ url, title, ...(cover && { thumbnailUrl: cover }) });
  }
  return items;
}

async function fetchDoc(path: string): Promise<{ doc: HtmlElement; url: string }> {
  const url = `${base()}${path}`;
  return { doc: html.load((await fetchPage(url)).text, { baseUrl: url }), url };
}

const pagerHrefs = (doc: HtmlElement): string[] => doc.select('div.pag a').map((a) => a.attr('href') ?? '');

/** Reads a listing page; the first page of a section is `path`, the next ones `<prefix>/page/N/`. */
async function listing(path: string, kind: 'episodes' | 'rows', page: number, prefix = ''): Promise<AnimePage> {
  const n = Math.max(1, Math.floor(page));
  let loaded;
  try {
    loaded = await fetchDoc(n > 1 ? `${prefix}/page/${n}/` : path);
  } catch (error) {
    if (n > 1 && error instanceof NotFoundError) return EMPTY;
    throw error;
  }
  const items =
    kind === 'episodes' ? readEpisodeCards(loaded.doc, loaded.url) : readRows(loaded.doc, loaded.url, 'otable');
  if (items.length === 0 && !loaded.doc.selectFirst('#footer, div.pag, .kotakcari')) {
    throw new ParseError('The listing has no entries and no page frame: the site layout changed');
  }
  return { items, hasNextPage: hasPageLink(pagerHrefs(loaded.doc), n) };
}

/** `/anime/<slug>/`: the page of an anime. */
async function animePage(anime: AnimeSummary): Promise<HtmlElement> {
  const { doc } = await fetchDoc(anime.url);
  if (!doc.selectFirst('h1.title')) throw new ParseError('The anime page has no title: the site layout changed');
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

    /** The site only shows its 7 most popular series in a box on every page; there is nothing after them. */
    async getPopular(page: number): Promise<AnimePage> {
      if (page > 1) return EMPTY;
      const { doc, url } = await fetchDoc('/');
      const items = readRows(doc, url, 'ztable');
      if (items.length === 0) throw new ParseError('The home page has no Popular box: the site layout changed');
      return { items, hasNextPage: false };
    },

    /** The newest episodes (16 a page), one card per series. */
    getLatest: (page: number) => listing('/', 'episodes', page),

    search(query: string, page: number, filters: FilterState): Promise<AnimePage> {
      const text = query.trim();
      if (text) {
        // One page of results (the site redirects to /search/<words>/); it ignores the filters.
        if (page > 1) return Promise.resolve(EMPTY);
        return listing(`/search.php?q=${encodeURIComponent(text)}`, 'rows', 1);
      }
      // The site cannot combine them: the genre wins over the type. With neither, the newest episodes.
      const genre = filters['genre'];
      if (typeof genre === 'string' && GENRES.some(([slug]) => slug === genre)) {
        return listing(`/genres/${genre}/`, 'rows', page, `/genres/${genre}`);
      }
      if (filters['type'] === 'movie') return listing('/movie/', 'rows', page, '/movie');
      return listing('/', 'episodes', page);
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
      const title = collapse(doc.selectFirst('h1.title')?.text() ?? '');
      if (!title) throw new ParseError('The anime page has no title');
      const detail = doc.selectFirst('.detail') ?? doc;
      const genres = detail
        .select('a[rel=tag]')
        .map((a) => collapse(a.text()))
        .filter(Boolean);
      const synopsis = collapse(detail.selectFirst('p')?.text() ?? '');
      const cover = detail.selectFirst('img')?.absUrl('src');
      // The page has no status, year, studio or alternative titles.
      return {
        url: anime.url,
        title,
        thumbnailUrl: cover || undefined,
        description: synopsis || undefined,
        genres: genres.length > 0 ? genres : undefined,
        status: 'unknown',
      };
    },

    /** The page lists every episode, oldest first (with a leading "000" on some); the contract is newest first. */
    async getEpisodes(anime: AnimeSummary): Promise<Episode[]> {
      const doc = await animePage(anime);
      const seen = new Set<string>();
      const episodes: Episode[] = [];
      for (const link of doc.select('.ep a')) {
        const href = link.attr('href');
        if (!href) continue;
        const url = entityPath(href, base());
        if (seen.has(url)) continue;
        seen.add(url);
        const label = collapse(link.text());
        const number = parseNumber(label) ?? numberOfPath(url);
        episodes.push({
          url,
          name: number !== undefined ? `Episode ${number}` : label || 'Episode',
          ...(number !== undefined && { number }),
        });
      }
      if (episodes.length === 0 && !doc.selectFirst('.ep')) {
        throw new ParseError('The anime page has no episode list: the site layout changed');
      }
      // A film or a single OVA is "episode 1" of itself.
      const only = episodes.length === 1 ? episodes[0] : undefined;
      if (only && only.number === undefined) only.number = 1;
      // Newest first. Array.sort is stable, so unnumbered entries keep the page order, after the numbered ones.
      return episodes.sort((a, b) => (b.number ?? -Infinity) - (a.number ?? -Infinity) || 0);
    },

    getStreams,

    resolveUrl(url: string): AnimeSummary | null {
      const match = /^https?:\/\/(?:www\.)?anime-indo\.[a-z]+\/([^?#]*)/i.exec(url);
      const parts = (match?.[1] ?? '').split('/').filter(Boolean);
      const first = parts[0];
      if (!first) return null;
      if (first === 'anime' && parts[1]) return { url: `/anime/${parts[1]}/`, title: parts[1].replace(/-/g, ' ') };
      if (parts.length === 1) {
        const series = seriesOfEpisode(`/${first}/`);
        if (series) return { url: series, title: (series.split('/')[2] ?? '').replace(/-/g, ' ') };
      }
      return null;
    },

    getWebUrl: (item: AnimeSummary | Episode) => `${base()}${item.url}`,
  }),
});
