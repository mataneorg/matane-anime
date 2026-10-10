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
  STATUSES,
  TYPES,
  collapse,
  entityPath,
  episodeName,
  fullCover,
  parseEpisodeDate,
  parseNumber,
  releaseYear,
} from './text';

// alqanime.si: WordPress with the AnimeStream theme (the same markup as anoboy.be and samehadaku.li), Indonesian
// subtitles. The adult genres (hentai, erotica) are left out of the filter: the manifest is not marked nsfw.
// Everything is read from HTML.
// Entity urls are paths: "/anime/<slug>/" for an anime, "/<slug>-episode-<n>-subtitle-indonesia/" for an episode.

const EMPTY: AnimePage = { items: [], hasNextPage: false };

/** The site's genre checkboxes (`/anime/` filter form, `genre[]`). */
const GENRES: [slug: string, label: string][] = [
  ['action', 'Action'],
  ['adult-cast', 'Adult Cast'],
  ['adventure', 'Adventure'],
  ['anthropomorphic', 'Anthropomorphic'],
  ['avant-garde', 'Avant Garde'],
  ['boys-love', 'Boys Love'],
  ['cgdct', 'CGDCT'],
  ['childcare', 'Childcare'],
  ['comedy', 'Comedy'],
  ['crossdressing', 'Crossdressing'],
  ['delinquents', 'Delinquents'],
  ['detective', 'Detective'],
  ['drama', 'Drama'],
  ['ecchi', 'Ecchi'],
  ['fantasy', 'Fantasy'],
  ['gag-humor', 'Gag Humor'],
  ['girls-love', 'Girls Love'],
  ['gore', 'Gore'],
  ['gourmet', 'Gourmet'],
  ['harem', 'Harem'],
  ['high-stakes-game', 'High Stakes Game'],
  ['historical', 'Historical'],
  ['horror', 'Horror'],
  ['idols-male', 'Idols (Male)'],
  ['isekai', 'Isekai'],
  ['iyashikei', 'Iyashikei'],
  ['josei', 'Josei'],
  ['love-polygon', 'Love Polygon'],
  ['love-status-quo', 'Love Status Quo'],
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
  ['psychological', 'Psychological'],
  ['racing', 'Racing'],
  ['reincarnation', 'Reincarnation'],
  ['reverse-harem', 'Reverse Harem'],
  ['romance', 'Romance'],
  ['samurai', 'Samurai'],
  ['school', 'School'],
  ['sci-fi', 'Sci-Fi'],
  ['seinen', 'Seinen'],
  ['shoujo', 'Shoujo'],
  ['shounen', 'Shounen'],
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
  ['time-travel', 'Time Travel'],
  ['urban-fantasy', 'Urban Fantasy'],
  ['vampire', 'Vampire'],
  ['video-game', 'Video Game'],
  ['villainess', 'Villainess'],
  ['visual-arts', 'Visual Arts'],
  ['workplace', 'Workplace'],
];

const STATUS_OPTIONS = [
  ['', 'All'],
  ['ongoing', 'Ongoing'],
  ['completed', 'Completed'],
  ['upcoming', 'Upcoming'],
  ['hiatus', 'Hiatus'],
] as const;

const TYPE_OPTIONS = [
  ['', 'All'],
  ['tv', 'TV Series'],
  ['ova', 'OVA'],
  ['movie', 'Movie'],
  ['live action', 'Live Action'],
  ['special', 'Special'],
  ['bd', 'BD'],
  ['ona', 'ONA'],
  ['music', 'Music'],
] as const;

const ORDER_OPTIONS = [
  ['update', 'Latest Update'],
  ['popular', 'Popular'],
  ['rating', 'Rating'],
  ['latest', 'Latest Added'],
  ['title', 'A-Z'],
  ['titlereverse', 'Z-A'],
] as const;

const SUB_OPTIONS = [
  ['', 'All'],
  ['sub', 'Sub'],
  ['dub', 'Dub'],
  ['raw', 'RAW'],
] as const;

const pick = (filters: FilterState, id: string, allowed: readonly (readonly [string, string])[]): string => {
  const value = filters[id];
  return typeof value === 'string' && allowed.some(([v]) => v === value) ? value : '';
};

/** Reads the cards of a listing. A page that is past the end answers 404, or an empty frame. */
function readCards(doc: HtmlElement, baseUrl: string): AnimeSummary[] {
  const items: AnimeSummary[] = [];
  const seen = new Set<string>();
  for (const card of doc.select('.listupd article.bs')) {
    const link = card.selectFirst('a[itemprop=url]') ?? card.selectFirst('a');
    const href = link?.attr('href');
    const title = collapse(card.selectFirst('.tt h2')?.text() ?? link?.attr('title') ?? '');
    if (!href || !title) throw new ParseError('A card has no link or title: the site layout changed');
    const url = entityPath(href, baseUrl);
    if (seen.has(url)) continue;
    seen.add(url);
    const img = card.selectFirst('img');
    // Covers are lazy: the real address is `data-src` (src is an SVG placeholder).
    const cover = fullCover(img?.absUrl('data-src') ?? img?.absUrl('src'));
    items.push({ url, title, ...(cover && !cover.startsWith('data:') && { thumbnailUrl: cover }) });
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
  if (items.length === 0 && !doc.selectFirst('#sidebar, .listupd, .releases')) {
    throw new ParseError('The listing has no cards and no page frame: the site layout changed');
  }
  return { items, hasNextPage: doc.selectFirst('.hpage a.r') !== null };
}

function browse(params: Record<string, string>, page: number): Promise<AnimePage> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.append(key, value);
  if (page > 1) query.set('page', String(Math.floor(page)));
  const qs = query.toString();
  return listing(`/anime/${qs ? `?${qs}` : ''}`, page);
}

async function animePage(anime: AnimeSummary): Promise<HtmlElement> {
  const url = `${base()}${anime.url}`;
  const doc = html.load((await fetchPageShared(url)).text, { baseUrl: url });
  if (!doc.selectFirst('h1.entry-title')) throw new ParseError('The anime page has no title: the site layout changed');
  return doc;
}

/** `<span><b>Label:</b> value</span>` rows of the info block. */
function readInfo(doc: HtmlElement): (label: string) => string | undefined {
  const lines = doc.select('.info-content .spe span').map((span) => collapse(span.text()));
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
      description:
        'The domain moves often (alqanime.net is a sister site): change it here. Libraries store paths, so they survive.',
      default: DEFAULT_BASE_URL,
    },
  ],

  createSource: () => ({
    get baseUrl() {
      return base();
    },

    getPopular: (page) => browse({ order: 'popular' }, page),

    /** Series ordered by their newest episode (the home page lists episodes, not series). */
    getLatest: (page) => browse({ order: 'update' }, page),

    search(query: string, page: number, filters: FilterState): Promise<AnimePage> {
      const text = query.trim();
      if (text) {
        // The site's own search ignores the filters.
        const path = page > 1 ? `/page/${Math.floor(page)}/` : '/';
        return listing(`${path}?${new URLSearchParams({ s: text }).toString()}`, page);
      }
      const genre = filters['genre'];
      const params: Record<string, string> = {
        status: pick(filters, 'status', STATUS_OPTIONS),
        type: pick(filters, 'type', TYPE_OPTIONS),
        sub: pick(filters, 'sub', SUB_OPTIONS),
        order: pick(filters, 'order', ORDER_OPTIONS) || 'update',
      };
      const query2 = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) if (value) query2.append(key, value);
      if (typeof genre === 'string' && GENRES.some(([slug]) => slug === genre)) query2.append('genre[]', genre);
      if (page > 1) query2.set('page', String(Math.floor(page)));
      return listing(`/anime/?${query2.toString()}`, page);
    },

    getFilters: (): Filter[] => [
      { type: 'header', label: 'These filters apply only when the search box is empty.' },
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
      {
        type: 'select',
        id: 'sub',
        label: 'Language',
        options: SUB_OPTIONS.map(([value, label]) => ({ value, label })),
        default: '',
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
      const doc = await animePage(anime);
      const info = readInfo(doc);
      const title = collapse(doc.selectFirst('h1.entry-title')?.text() ?? '');
      if (!title) throw new ParseError('The anime page has no title');

      const alt = (doc.selectFirst('.alter')?.text() ?? '')
        .split(',')
        .map(collapse)
        .filter((name) => name && name.toLowerCase() !== title.toLowerCase());
      const synopsis = doc
        .select('.synp .entry-content p')
        .map((p) => collapse(p.text()))
        .filter(Boolean)
        .join('\n\n');
      const genres = doc
        .select('.genxed a')
        .map((a) => collapse(a.text()))
        .filter(Boolean);
      const img = doc.selectFirst('.thumbook .thumb img');
      const cover = fullCover(img?.absUrl('data-src') ?? img?.absUrl('src'));
      const kind = TYPES[(info('Type') ?? '').toLowerCase()];
      return {
        url: anime.url,
        title,
        thumbnailUrl: cover && !cover.startsWith('data:') ? cover : undefined,
        altTitles: alt.length > 0 ? alt : undefined,
        description: synopsis || undefined,
        genres: genres.length > 0 ? genres : undefined,
        studio: info('Studio'),
        year: releaseYear(info('Released')),
        status: STATUSES[(info('Status') ?? '').toLowerCase()] ?? 'unknown',
        type: kind === 'tv' && /\bOVA\b/.test(title) ? 'ova' : kind,
      };
    },

    /** The page lists oldest first; the contract is newest first, so numbered episodes are sorted by number. */
    async getEpisodes(anime: AnimeSummary): Promise<Episode[]> {
      const doc = await animePage(anime);
      const seen = new Set<string>();
      const episodes: Episode[] = [];
      for (const row of doc.select('.eplister ul li')) {
        const link = row.selectFirst('a');
        const href = link?.attr('href');
        if (!link || !href) continue;
        const url = entityPath(href, base());
        if (seen.has(url)) continue;
        seen.add(url);
        const label = collapse(row.selectFirst('.epl-num')?.text() ?? '');
        const number = parseNumber(label);
        const title = collapse(row.selectFirst('.epl-title')?.text() ?? '');
        episodes.push({
          url,
          name: episodeName(title || label, label),
          ...(number !== undefined && { number }),
          uploadedAt: parseEpisodeDate(row.selectFirst('.epl-date')?.text() ?? ''),
        });
      }
      // A film or a single OVA is "episode 1" of itself.
      const only = episodes.length === 1 ? episodes[0] : undefined;
      if (only && only.number === undefined) only.number = 1;
      // Newest first. Array.sort is stable, so unnumbered entries keep the page order, after the numbered ones.
      return episodes.sort((a, b) => (b.number ?? -Infinity) - (a.number ?? -Infinity) || 0);
    },

    getStreams,

    resolveUrl(url: string): AnimeSummary | null {
      const match = /^https?:\/\/(?:www\.)?alqanime\.[a-z]+\/anime\/([^/?#]+)\/?/i.exec(url);
      const slug = match?.[1];
      return slug ? { url: `/anime/${slug}/`, title: slug.replace(/-/g, ' ') } : null;
    },

    getWebUrl: (item: AnimeSummary | Episode) => `${base()}${item.url}`,
  }),
});
