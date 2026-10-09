import '@matane-anime/extension-sdk/globals';
import {
  type AnimeDetails,
  type AnimePage,
  type AnimeSummary,
  type Episode,
  type Filter,
  type FilterState,
  NotFoundError,
  ParseError,
  defineExtension,
} from '@matane-anime/extension-sdk';
import { DEFAULT_CATALOG_URL, DEFAULT_STREAMS_URL, WEB_URL, getJson, graphql, catalogUrl, streamsUrl } from './api';
import { getStreams } from './streams';
import { STATUSES, TYPES, cleanDescription, coverOf, episodeUrl } from './text';

// animex.one is a SvelteKit app over open JSON backends: GraphQL for the catalogue (and a REST list of the latest
// releases) on graphql.animex.one, and REST for episodes, servers and streams on pp.animex.one. English.
// Entity urls are the site's string id ("attack-on-titan-2jqd0"), and "<id>/<number>/<sub|dub>" for an episode.

const PAGE_SIZE = 30;

/** AniList genres, without the explicit one (the manifest is not nsfw). */
const GENRES = [
  'Action',
  'Adventure',
  'Comedy',
  'Drama',
  'Ecchi',
  'Fantasy',
  'Horror',
  'Mahou Shoujo',
  'Mecha',
  'Music',
  'Mystery',
  'Psychological',
  'Romance',
  'Sci-Fi',
  'Slice of Life',
  'Sports',
  'Supernatural',
  'Thriller',
];

const FORMATS = [
  ['TV', 'TV'],
  ['TV_SHORT', 'TV short'],
  ['MOVIE', 'Movie'],
  ['ONA', 'ONA'],
  ['OVA', 'OVA'],
  ['SPECIAL', 'Special'],
  ['MUSIC', 'Music'],
] as const;

const STATUS_OPTIONS = [
  ['RELEASING', 'Airing'],
  ['FINISHED', 'Finished'],
  ['NOT_YET_RELEASED', 'Not yet released'],
] as const;

const AUDIO_OPTIONS = [
  ['SUB', 'Sub'],
  ['DUB', 'Dub'],
  ['BOTH', 'Sub and dub'],
] as const;

const SORT_OPTIONS = [
  ['POPULARITY', 'Popularity'],
  ['TRENDING', 'Trending'],
  ['AVERAGE_SCORE', 'Score'],
  ['UPDATED_AT', 'Last updated'],
  ['SEASON_YEAR', 'Year'],
  ['TITLE_ENGLISH', 'Title'],
] as const;

const YEARS = Array.from({ length: new Date().getFullYear() + 1 - 1960 + 1 }, (_, i) =>
  String(new Date().getFullYear() + 1 - i),
);

const CATALOG_FIELDS =
  'id titleRomaji titleEnglish coverImage status format genres seasonYear subCount dubCount isAdult';

interface AnimeNode {
  id?: string;
  titleRomaji?: string | null;
  titleEnglish?: string | null;
  description?: string | null;
  coverImage?: unknown;
  status?: string | null;
  format?: string | null;
  genres?: string[] | null;
  seasonYear?: number | null;
  synonyms?: string[] | null;
  studios?: string[] | string | null;
  isAdult?: boolean | null;
}

const titleOf = (node: AnimeNode): string => (node.titleEnglish?.trim() || node.titleRomaji?.trim() || '').trim();

/** The backend's own adult flag, and the explicit genre, keep adult titles out of every list. */
const isAdult = (node: AnimeNode): boolean => node.isAdult === true || (node.genres ?? []).includes('Hentai');

function summary(node: AnimeNode): AnimeSummary {
  const title = titleOf(node);
  if (!node.id || !title) throw new ParseError('A title has no id or name: the site changed');
  const thumbnailUrl = coverOf(node.coverImage);
  return { url: node.id, title, ...(thumbnailUrl && { thumbnailUrl }) };
}

function dedupe(items: AnimeSummary[]): AnimeSummary[] {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(item.url) && !!seen.add(item.url));
}

const pick = <T extends string>(value: unknown, allowed: readonly (readonly [T, string])[]): T | undefined =>
  allowed.find(([v]) => v === value)?.[0];

interface CatalogFilter {
  query?: string;
  genre?: string;
  format?: string;
  status?: string;
  year?: string;
  audio?: string;
  sort?: string;
  direction?: 'ASC' | 'DESC';
}

async function catalogue(filter: CatalogFilter, page: number): Promise<AnimePage> {
  const n = Math.max(1, Math.floor(page));
  const year = filter.year ? Number(filter.year) : undefined;
  const data = await graphql<{ catalogAnime?: { items?: AnimeNode[]; hasNextPage?: boolean } }>(
    `query($f:AnimeCatalogFilterInput,$s:[AnimeSortInput!],$l:Int,$o:Int){catalogAnime(filter:$f,sort:$s,limit:$l,offset:$o){items{${CATALOG_FIELDS}} totalCount hasNextPage}}`,
    {
      f: {
        includeAdult: false,
        ...(filter.query && { query: filter.query }),
        ...(filter.genre && { genres: [filter.genre] }),
        ...(filter.format && { formatIn: [filter.format] }),
        ...(filter.status && { statusIn: [filter.status] }),
        ...(year && { seasonYearMin: year, seasonYearMax: year }),
        ...(filter.audio && { subDubFilter: filter.audio }),
      },
      s: [{ field: filter.sort ?? 'POPULARITY', direction: filter.direction ?? 'DESC' }],
      l: PAGE_SIZE,
      o: (n - 1) * PAGE_SIZE,
    },
  );
  const result = data.catalogAnime;
  if (!result || !Array.isArray(result.items)) throw new ParseError('The catalogue has no "items": the site changed');
  return {
    items: dedupe(result.items.filter((node) => !isAdult(node)).map(summary)),
    hasNextPage: result.hasNextPage === true,
  };
}

interface RecentItem extends AnimeNode {
  episode?: number | null;
}

interface EpisodeItem {
  number?: number | string;
  titles?: Record<string, string> | null;
  airDateUtc?: string | null;
  updatedAt?: number | null;
  hasSub?: boolean;
  hasDub?: boolean;
}

function airTime(item: EpisodeItem): number | undefined {
  const aired = item.airDateUtc ? Date.parse(item.airDateUtc) : NaN;
  if (Number.isFinite(aired) && aired > 0) return aired;
  return typeof item.updatedAt === 'number' && item.updatedAt > 0 ? item.updatedAt : undefined;
}

export default defineExtension({
  preferences: () => [
    {
      type: 'text',
      key: 'catalogUrl',
      label: 'Catalogue address',
      description: 'The GraphQL backend of the site (and its list of recent releases).',
      default: DEFAULT_CATALOG_URL,
    },
    {
      type: 'text',
      key: 'streamsUrl',
      label: 'Streams address',
      description: 'The backend that lists episodes and servers and gives the streams.',
      default: DEFAULT_STREAMS_URL,
    },
  ],

  createSource: () => ({
    get baseUrl() {
      return WEB_URL;
    },

    getPopular: (page) => catalogue({}, page),

    /** The newest releases (one entry per episode), shown as the titles they belong to. */
    async getLatest(page: number): Promise<AnimePage> {
      const n = Math.max(1, Math.floor(page));
      const result = await getJson<{ results?: RecentItem[]; hasNextPage?: boolean }>(catalogUrl(), '/api/recent', {
        page: n,
      });
      if (!Array.isArray(result.results)) throw new ParseError('The recent list has no "results": the site changed');
      return {
        items: dedupe(result.results.filter((node) => !isAdult(node)).map(summary)),
        hasNextPage: result.hasNextPage === true,
      };
    },

    search(query: string, page: number, filters: FilterState): Promise<AnimePage> {
      const genre =
        typeof filters['genre'] === 'string' && GENRES.includes(filters['genre']) ? filters['genre'] : undefined;
      const year = typeof filters['year'] === 'string' && YEARS.includes(filters['year']) ? filters['year'] : undefined;
      const sort = pick(filters['sort'], SORT_OPTIONS);
      return catalogue(
        {
          query: query.trim() || undefined,
          genre,
          format: pick(filters['format'], FORMATS),
          status: pick(filters['status'], STATUS_OPTIONS),
          year,
          audio: pick(filters['audio'], AUDIO_OPTIONS),
          sort,
          direction: sort === 'TITLE_ENGLISH' ? 'ASC' : 'DESC',
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
        id: 'format',
        label: 'Format',
        options: [{ value: '', label: 'Any' }, ...FORMATS.map(([value, label]) => ({ value, label }))],
        default: '',
      },
      {
        type: 'select',
        id: 'status',
        label: 'Status',
        options: [{ value: '', label: 'Any' }, ...STATUS_OPTIONS.map(([value, label]) => ({ value, label }))],
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
        id: 'audio',
        label: 'Audio',
        options: [{ value: '', label: 'Any' }, ...AUDIO_OPTIONS.map(([value, label]) => ({ value, label }))],
        default: '',
      },
      {
        type: 'select',
        id: 'sort',
        label: 'Order by',
        options: SORT_OPTIONS.map(([value, label]) => ({ value, label })),
        default: 'POPULARITY',
      },
    ],

    async getAnimeDetails(anime: AnimeSummary): Promise<AnimeDetails> {
      const data = await graphql<{ anime?: AnimeNode | null }>(
        'query($id:String!){anime(id:$id){id titleRomaji titleEnglish description status format genres seasonYear coverImage synonyms studios isAdult}}',
        { id: anime.url },
      );
      const node = data.anime;
      if (!node) throw new NotFoundError(`Not found: ${anime.url}`);
      const title = titleOf(node);
      if (!title) throw new ParseError('The title has no name: the site changed');
      const alt = [node.titleRomaji, ...(node.synonyms ?? [])]
        .map((name) => name?.trim() ?? '')
        .filter((name, i, all) => name && name !== title && all.indexOf(name) === i)
        .slice(0, 8);
      const genres = (node.genres ?? []).filter(Boolean);
      const studio = (Array.isArray(node.studios) ? node.studios : [node.studios ?? ''])
        .map((s) => s.trim())
        .filter(Boolean)
        .join(', ');
      return {
        url: anime.url,
        title,
        thumbnailUrl: coverOf(node.coverImage),
        altTitles: alt.length > 0 ? alt : undefined,
        description: cleanDescription(node.description),
        genres: genres.length > 0 ? genres : undefined,
        studio: studio || undefined,
        year: node.seasonYear ?? undefined,
        status: STATUSES[node.status ?? ''] ?? 'unknown',
        type: TYPES[node.format ?? ''],
      };
    },

    /** One Sub entry per episode and, where the site has a dub, a Dub entry. Newest first. */
    async getEpisodes(anime: AnimeSummary): Promise<Episode[]> {
      const items = await getJson<EpisodeItem[]>(streamsUrl(), '/rest/api/episodes', { id: anime.url });
      if (!Array.isArray(items)) throw new ParseError('The episode list is not a list: the site changed');
      const episodes: Episode[] = [];
      const seen = new Set<string>();
      for (const item of items) {
        const number = Number(item.number);
        if (!Number.isFinite(number)) continue;
        const name = item.titles?.['en']?.trim() || `Episode ${number}`;
        const uploadedAt = airTime(item);
        for (const [type, variant, has] of [
          ['sub', 'Sub', item.hasSub !== false],
          ['dub', 'Dub', item.hasDub === true],
        ] as const) {
          const url = episodeUrl(anime.url, number, type);
          if (!has || seen.has(url)) continue;
          seen.add(url);
          episodes.push({ url, name, number, variant, ...(uploadedAt !== undefined && { uploadedAt }) });
        }
      }
      // Newest first, the sub before the dub of the same number.
      return episodes.sort(
        (a, b) => (b.number ?? 0) - (a.number ?? 0) || (a.variant === 'Sub' ? -1 : 1) - (b.variant === 'Sub' ? -1 : 1),
      );
    },

    getStreams,

    // No resolveUrl: the site's web addresses carry the AniList number, not the id the backends use.

    getWebUrl: (item: AnimeSummary | Episode) => `${WEB_URL}/anime/${item.url.split('/')[0]}`,
  }),
});
