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
import { cleanTitle, collapse, entityPath, parseNumber, parseStatus, parseType, releaseYear } from './text';

// animasu.love: WordPress with the AnimeStream theme, but with Indonesian routes and filters. Indonesian subtitles.
// Everything is read from HTML. Entity urls are paths: "/anime/<slug>/" for an anime, "/nonton-<slug>-episode-<n>/"
// for an episode.

const EMPTY: AnimePage = { items: [], hasNextPage: false };

/** The site's genre checkboxes (`/pencarian/` filter form, `genre[]`; Indonesian slugs). */
const GENRES: [slug: string, label: string][] = [
  ['aksi', 'Aksi'],
  ['anak-anak', 'Anak-Anak'],
  ['luar-angkasa', 'Antariksa'],
  ['avant-garde', 'Avant Garde'],
  ['dementia', 'Dimensia'],
  ['donghua', 'Donghua'],
  ['drama', 'Drama'],
  ['ecchi', 'Ecchi'],
  ['fantasi', 'Fantasi'],
  ['fantasi-urban', 'Fantasi Urban'],
  ['game', 'Game'],
  ['gourmet', 'Gourmet'],
  ['harem', 'Harem'],
  ['horror', 'Horror'],
  ['iblis', 'Iblis'],
  ['isekai', 'Isekai'],
  ['josei', 'Josei'],
  ['suspense', 'Ketegangan'],
  ['komedi', 'Komedi'],
  ['live-action', 'Live Action'],
  ['makanan', 'Makanan'],
  ['martial-arts', 'Martial Arts'],
  ['medical', 'Medis'],
  ['militer', 'Militer'],
  ['misteri', 'Misteri'],
  ['mitologi', 'Mitologi'],
  ['mobil', 'Mobil'],
  ['musik', 'Musik'],
  ['olahraga', 'Olahraga'],
  ['parodi', 'Parodi'],
  ['perang', 'Perang'],
  ['petualangan', 'Petualangan'],
  ['polisi', 'Polisi'],
  ['politik', 'Politik'],
  ['psikologis', 'Psikologis'],
  ['reincarnation', 'Reinkarnasi'],
  ['mecha', 'Robot'],
  ['romansa', 'Romansa'],
  ['samurai', 'Samurai'],
  ['sci-fi', 'Sci-Fi'],
  ['seinen', 'Seinen'],
  ['sejarah', 'Sejarah'],
  ['sekolahan', 'Sekolahan'],
  ['shoujo', 'Shoujo'],
  ['shoujo-ai', 'Shoujo Ai'],
  ['shounen', 'Shounen'],
  ['shounen-ai', 'Shounen Ai'],
  ['sihir', 'Sihir'],
  ['slice-of-life', 'Slice of Life'],
  ['super-power', 'Super Power'],
  ['supranatural', 'Supranatural'],
  ['thriller', 'Thriller'],
  ['time-travel', 'Time Travel'],
  ['vampir', 'Vampir'],
  ['wuxia', 'Wuxia'],
  ['yaoi', 'Yaoi'],
];

const STATUS_OPTIONS = [
  ['', 'Any'],
  ['ongoing', 'Ongoing'],
  ['completed', 'Completed'],
  ['upcoming', 'Upcoming'],
] as const;

const TYPE_OPTIONS = [
  ['', 'Any'],
  ['TV', 'TV Series'],
  ['Movie', 'Movie'],
  ['OVA', 'OVA'],
  ['ONA', 'ONA'],
  ['Special', 'Special'],
  ['Music', 'Music'],
  ['Live Action', 'Live Action'],
  ['Drama Jepang', 'Japanese drama'],
  ['Drama China', 'Chinese drama'],
] as const;

/** Note the spelling of the site's value: "populer". */
const ORDER_OPTIONS = [
  ['update', 'Latest Update'],
  ['populer', 'Popular'],
  ['rating', 'Rating'],
  ['publikasi', 'Latest Added'],
  ['abjad', 'A-Z'],
  ['dari-z', 'Z-A'],
] as const;

const pick = (filters: FilterState, id: string, allowed: readonly (readonly [string, string])[]): string => {
  const value = filters[id];
  return typeof value === 'string' && allowed.some(([v]) => v === value) ? value : '';
};

/** Reads the cards of a listing (`div.bs`, which link to the series). */
function readCards(doc: HtmlElement, baseUrl: string): AnimeSummary[] {
  const items: AnimeSummary[] = [];
  const seen = new Set<string>();
  for (const card of doc.select('.listupd div.bs')) {
    const link = card.selectFirst('a');
    const href = link?.attr('href');
    const title = collapse(card.selectFirst('.tt')?.text() ?? link?.attr('title') ?? '');
    if (!href || !title) throw new ParseError('A card has no link or title: the site layout changed');
    const url = entityPath(href, baseUrl);
    if (seen.has(url)) continue;
    seen.add(url);
    const cover = card.selectFirst('img')?.absUrl('src');
    items.push({ url, title: cleanTitle(title), ...(cover && !cover.startsWith('data:') && { thumbnailUrl: cover }) });
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
  return { items, hasNextPage: doc.selectFirst('.hpage a.r') !== null };
}

function browse(params: Record<string, string>, genre: string | undefined, page: number): Promise<AnimePage> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.append(key, value);
  if (genre) query.append('genre[]', genre);
  if (page > 1) query.set('halaman', String(Math.floor(page)));
  return listing(`/pencarian/?${query.toString()}`, page);
}

async function animePage(anime: AnimeSummary): Promise<HtmlElement> {
  const url = `${base()}${anime.url}`;
  const doc = html.load((await fetchPage(url)).text, { baseUrl: url });
  if (!doc.selectFirst('h1')) throw new ParseError('The anime page has no title: the site layout changed');
  return doc;
}

/** `<span><b>Label:</b> value</span>` rows of the info block. */
function readInfo(doc: HtmlElement): (label: string) => string | undefined {
  const lines = doc.select('.infox .spe span').map((span) => collapse(span.text()));
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
        'The domain rotates (animasu.me is only a landing page that links to the current one). Libraries store paths, so they survive.',
      default: DEFAULT_BASE_URL,
    },
  ],

  createSource: () => ({
    get baseUrl() {
      return base();
    },

    getPopular: (page) => browse({ urutan: 'populer' }, undefined, page),

    /** Series ordered by their newest episode (10 a page). */
    getLatest: (page) => browse({ urutan: 'update' }, undefined, page),

    search(query: string, page: number, filters: FilterState): Promise<AnimePage> {
      const text = query.trim();
      if (text) {
        // The site's own search ignores the filters.
        const path = page > 1 ? `/page/${Math.floor(page)}/` : '/';
        return listing(`${path}?${new URLSearchParams({ s: text }).toString()}`, page);
      }
      const genre = filters['genre'];
      return browse(
        {
          status: pick(filters, 'status', STATUS_OPTIONS),
          tipe: pick(filters, 'type', TYPE_OPTIONS),
          urutan: pick(filters, 'order', ORDER_OPTIONS) || 'update',
        },
        typeof genre === 'string' && GENRES.some(([slug]) => slug === genre) ? genre : undefined,
        page,
      );
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
        id: 'order',
        label: 'Order by',
        options: ORDER_OPTIONS.map(([value, label]) => ({ value, label })),
        default: 'update',
      },
    ],

    async getAnimeDetails(anime: AnimeSummary): Promise<AnimeDetails> {
      const doc = await animePage(anime);
      const info = readInfo(doc);
      const title = cleanTitle(doc.selectFirst('h1')?.text() ?? '');
      if (!title) throw new ParseError('The anime page has no title');
      const alt = collapse(doc.selectFirst('.infox .alter')?.text() ?? '')
        .split(',')
        .map(collapse)
        .filter((name) => name && name.toLowerCase() !== title.toLowerCase());
      const synopsis = doc
        .select('.sinopsis .desc p')
        .map((p) => collapse(p.text()))
        .filter(Boolean)
        .join('\n\n');
      const genres = doc
        .select('.infox .spe a[rel=tag][href*="/genre/"]')
        .map((a) => collapse(a.text()))
        .filter(Boolean);
      const cover = (doc.selectFirst('.bigcover img') ?? doc.selectFirst('.thumb img'))?.absUrl('src');
      const kind = parseType(info('Jenis') ?? '');
      return {
        url: anime.url,
        title,
        thumbnailUrl: cover || undefined,
        altTitles: alt.length > 0 ? alt : undefined,
        description: synopsis || undefined,
        genres: genres.length > 0 ? genres : undefined,
        studio: info('Studio'),
        year: releaseYear(info('Rilis')),
        status: parseStatus(info('Status') ?? ''),
        type: kind,
      };
    },

    /** The list is newest first already and has no dates; it is sorted by number to be sure. */
    async getEpisodes(anime: AnimeSummary): Promise<Episode[]> {
      const doc = await animePage(anime);
      const seen = new Set<string>();
      const episodes: Episode[] = [];
      for (const link of doc.select('#daftarepisode li .lchx a')) {
        const href = link.attr('href');
        if (!href) continue;
        const url = entityPath(href, base());
        if (seen.has(url)) continue;
        seen.add(url);
        const label = collapse(link.text());
        const number = parseNumber(label);
        episodes.push({ url, name: label || 'Episode', ...(number !== undefined && { number }) });
      }
      if (episodes.length === 0 && !doc.selectFirst('#daftarepisode')) {
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
      const match = /^https?:\/\/(?:www\.)?animasu\.[a-z]+\/anime\/([^/?#]+)\/?/i.exec(url);
      const slug = match?.[1];
      return slug ? { url: `/anime/${slug}/`, title: slug.replace(/-/g, ' ') } : null;
    },

    getWebUrl: (item: AnimeSummary | Episode) => `${base()}${item.url}`,
  }),
});
