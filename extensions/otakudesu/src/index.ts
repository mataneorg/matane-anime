import '@matane-anime/extension-sdk/globals';
import {
  type AnimeDetails,
  type AnimePage,
  type AnimeStatus,
  type AnimeSummary,
  type AnimeType,
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
import { cleanTitle, entityPath, episodeName, parseEpisodeDate, parseEpisodeLabel } from './text';

// otakudesu.blog: Indonesian subtitles only. The site has no "popular" list, so getPopular is the completed
// series and getLatest the ongoing ones. Entity urls are paths ("/anime/<slug>/", "/episode/<slug>/").

const EMPTY: AnimePage = { items: [], hasNextPage: false };

const GENRES: [slug: string, label: string][] = [
  ['action', 'Action'],
  ['adventure', 'Adventure'],
  ['comedy', 'Comedy'],
  ['demons', 'Demons'],
  ['drama', 'Drama'],
  ['ecchi', 'Ecchi'],
  ['fantasy', 'Fantasy'],
  ['game', 'Game'],
  ['harem', 'Harem'],
  ['historical', 'Historical'],
  ['horror', 'Horror'],
  ['josei', 'Josei'],
  ['magic', 'Magic'],
  ['martial-arts', 'Martial Arts'],
  ['mecha', 'Mecha'],
  ['military', 'Military'],
  ['music', 'Music'],
  ['mystery', 'Mystery'],
  ['psychological', 'Psychological'],
  ['parody', 'Parody'],
  ['police', 'Police'],
  ['romance', 'Romance'],
  ['samurai', 'Samurai'],
  ['school', 'School'],
  ['sci-fi', 'Sci-Fi'],
  ['seinen', 'Seinen'],
  ['shoujo', 'Shoujo'],
  ['shoujo-ai', 'Shoujo Ai'],
  ['shounen', 'Shounen'],
  ['slice-of-life', 'Slice of Life'],
  ['sports', 'Sports'],
  ['space', 'Space'],
  ['super-power', 'Super Power'],
  ['supernatural', 'Supernatural'],
  ['thriller', 'Thriller'],
  ['vampire', 'Vampire'],
];

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** `/ongoing-anime/` for page 1, `/ongoing-anime/page/3/` after. */
const pagedPath = (path: string, page: number): string => (page > 1 ? `${path}page/${Math.floor(page)}/` : path);

/** Reads the cards of a listing; a page with no cards is fine if it is still the site's page ("Not Found" for a page past the end). */
async function listing(path: string, readItems: (doc: HtmlElement, url: string) => AnimeSummary[]): Promise<AnimePage> {
  const url = `${base()}${path}`;
  const { response, moved } = await fetchPage(url);
  if (moved) return EMPTY;
  const doc = html.load(response.text, { baseUrl: url });
  const items = readItems(doc, url);
  if (items.length === 0 && !doc.selectFirst('.venser')) {
    throw new ParseError('The listing has no cards and no page frame: the site layout changed');
  }
  return { items, hasNextPage: doc.selectFirst('.pagenavix a.next') !== null };
}

function summary(href: string | undefined, title: string, thumbnail: string | undefined): AnimeSummary {
  if (!href || !title) throw new ParseError('A card has no link or title: the site layout changed');
  return { url: entityPath(href, base()), title, ...(thumbnail && { thumbnailUrl: thumbnail }) };
}

/** Ongoing and completed lists. */
const readCards = (doc: HtmlElement): AnimeSummary[] =>
  doc
    .select('.venz ul > li')
    .map((card) =>
      summary(
        card.selectFirst('.thumb a')?.attr('href'),
        collapse(card.selectFirst('h2.jdlflm')?.text() ?? ''),
        card.selectFirst('.thumbz img')?.absUrl('src'),
      ),
    );

/** Genre pages use another markup. The `alt` of their covers is wrong (another anime), so it is not read. */
const readGenreCards = (doc: HtmlElement): AnimeSummary[] =>
  doc.select('.col-anime').map((card) => {
    const link = card.selectFirst('.col-anime-title a');
    return summary(
      link?.attr('href'),
      collapse(link?.text() ?? ''),
      card.selectFirst('.col-anime-cover img')?.absUrl('src'),
    );
  });

const readSearchHits = (doc: HtmlElement): AnimeSummary[] => {
  if (!doc.selectFirst('ul.chivsrc'))
    throw new ParseError('The search page has no result list: the site layout changed');
  return doc.select('ul.chivsrc > li').map((hit) => {
    const link = hit.selectFirst('h2 a');
    return summary(link?.attr('href'), cleanTitle(link?.text() ?? ''), hit.selectFirst('img')?.absUrl('src'));
  });
};

const ongoing = (page: number): Promise<AnimePage> => listing(pagedPath('/ongoing-anime/', page), readCards);
const completed = (page: number): Promise<AnimePage> => listing(pagedPath('/complete-anime/', page), readCards);

function readInfo(doc: HtmlElement): (label: string) => string | undefined {
  const lines = doc.select('.infozingle p').map((p) => collapse(p.text()));
  return (label) => {
    const prefix = `${label.toLowerCase()}:`;
    const line = lines.find((l) => l.toLowerCase().startsWith(prefix));
    const value = line?.slice(prefix.length).trim();
    return value && !/^(?:\?|-|unknown)$/i.test(value) ? value : undefined;
  };
}

const STATUSES: Record<string, AnimeStatus> = { ongoing: 'ongoing', completed: 'completed', drop: 'cancelled' };
const TYPES: Record<string, AnimeType> = { tv: 'tv', movie: 'movie', ova: 'ova', ona: 'ona', special: 'special' };

async function animePage(
  anime: AnimeSummary,
): Promise<{ doc: HtmlElement; info: (label: string) => string | undefined }> {
  const url = `${base()}${anime.url}`;
  const { response, moved } = await fetchPage(url);
  if (moved) throw new NotFoundError(`This anime is not on the site (any more): ${anime.url}`);
  const doc = html.load(response.text, { baseUrl: url });
  if (!doc.selectFirst('.jdlrx') && !doc.selectFirst('.infozingle')) {
    throw new ParseError('The anime page has no title block: the site layout changed');
  }
  return { doc, info: readInfo(doc) };
}

export default defineExtension({
  preferences: () => [
    {
      type: 'text',
      key: 'baseUrl',
      label: 'Site address',
      description: 'The official domain has moved before. Libraries are not affected: they store paths.',
      default: DEFAULT_BASE_URL,
    },
  ],

  createSource: () => ({
    get baseUrl() {
      return base();
    },

    getPopular: (page) => completed(page),
    getLatest: (page) => ongoing(page),

    async search(query: string, page: number, filters: FilterState): Promise<AnimePage> {
      const text = query.trim();
      if (text) {
        // The site's own paging answers 302/500 or random pages, so only the first page of a search exists.
        if (page > 1) return EMPTY;
        const params = new URLSearchParams({ s: text, post_type: 'anime' });
        return listing(`/?${params.toString()}`, readSearchHits);
      }
      const genre = filters['genre'];
      if (typeof genre === 'string' && /^[a-z0-9-]+$/.test(genre)) {
        return listing(pagedPath(`/genres/${genre}/`, page), readGenreCards);
      }
      return filters['list'] === 'complete' ? completed(page) : ongoing(page);
    },

    getFilters: (): Filter[] => [
      { type: 'header', label: 'These filters apply only when the search box is empty.' },
      {
        type: 'select',
        id: 'list',
        label: 'List',
        options: [
          { value: 'ongoing', label: 'Ongoing' },
          { value: 'complete', label: 'Completed' },
        ],
        default: 'ongoing',
      },
      {
        type: 'select',
        id: 'genre',
        label: 'Genre (replaces the list)',
        options: [{ value: '', label: 'Any' }, ...GENRES.map(([value, label]) => ({ value, label }))],
        default: '',
      },
    ],

    async getAnimeDetails(anime: AnimeSummary): Promise<AnimeDetails> {
      const { doc, info } = await animePage(anime);
      const title = info('Judul') ?? cleanTitle(doc.selectFirst('.jdlrx h1')?.text() ?? '');
      if (!title) throw new ParseError('The anime page has no title');

      const japanese = info('Japanese');
      const synopsis = doc
        .select('.sinopc p')
        .map((p) => collapse(p.text()))
        .filter(Boolean)
        .join('\n\n');
      const genres = doc
        .select('.infozingle a[rel=tag]')
        .map((a) => collapse(a.text()))
        .filter(Boolean);
      const year = Number(/\b(\d{4})\b/.exec(info('Tanggal Rilis') ?? '')?.[1]);
      const kind = TYPES[(info('Tipe') ?? '').toLowerCase()];
      return {
        url: anime.url,
        title,
        thumbnailUrl: doc.selectFirst('.fotoanime img')?.absUrl('src'),
        altTitles: japanese ? [japanese] : undefined,
        description: synopsis || undefined,
        genres: genres.length > 0 ? genres : undefined,
        studio: info('Studio'),
        year: year >= 1900 && year <= 2200 ? year : undefined,
        status: STATUSES[(info('Status') ?? '').toLowerCase()] ?? 'unknown',
        // The site files some OVAs under "TV"; the title is the better witness.
        type: kind === 'tv' && /\bOVA\b/.test(title) ? 'ova' : kind,
      };
    },

    /** The site lists newest first, and that is the contract too, so the page order is kept. */
    async getEpisodes(anime: AnimeSummary): Promise<Episode[]> {
      const { doc, info } = await animePage(anime);
      const title = info('Judul') ?? cleanTitle(doc.selectFirst('.jdlrx h1')?.text() ?? '');
      const seen = new Set<string>();
      const names = new Set<string>();
      const episodes: Episode[] = [];
      for (const row of doc.select('.episodelist li')) {
        const link = row.selectFirst('a[href*="/episode/"]');
        const href = link?.attr('href');
        if (!link || !href) continue;
        const url = entityPath(href, base());
        if (seen.has(url)) continue;
        seen.add(url);

        const text = collapse(link.text());
        // Episodes without a number are matched by name, so a name must not repeat.
        let name = episodeName(text, title);
        if (names.has(name)) name = cleanTitle(text) || text;
        name ||= text;
        names.add(name);
        episodes.push({
          url,
          name,
          // Read from the name, not the whole link: the anime's own title may say "Special" or "BD".
          ...parseEpisodeLabel(name),
          uploadedAt: parseEpisodeDate(row.selectFirst('.zeebr')?.text() ?? ''),
        });
      }
      // A film or a single OVA is "episode 1" of itself; a lone unnumbered entry cannot collide with another.
      const only = episodes.length === 1 ? episodes[0] : undefined;
      if (only && only.number === undefined) only.number = 1;
      return episodes;
    },

    getStreams,

    resolveUrl(url: string): AnimeSummary | null {
      const match = /^https?:\/\/(?:www\.)?otakudesu\.[a-z]+\/anime\/([^/?#]+)\/?/i.exec(url);
      const slug = match?.[1];
      return slug ? { url: `/anime/${slug}/`, title: slug.replace(/-/g, ' ') } : null;
    },

    getWebUrl: (item: AnimeSummary | Episode) => `${base()}${item.url}`,
  }),
});
