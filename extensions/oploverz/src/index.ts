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
import { DEFAULT_API_URL, WEB_URL, base, getJson, getPage } from './api';
import { getStreams } from './streams';
import { STATUSES, TYPES, airYear, cleanText, episodeTime, episodeUrl } from './text';

// oploverz.site is a SvelteKit front over a public JSON API (backapi.oploverz.ac); the API is what is read.
// Entity urls are the series slug, and `<slug>/<episodeNumber>` for an episode.

const PAGE_SIZE = 30;
const EPISODE_PAGE_SIZE = 2000;
/** Safety net for the episode list: the API has never needed a second page (One Piece: 1180 episodes). */
const MAX_EPISODE_PAGES = 5;

const GENRES: [slug: string, label: string][] = [
  ['18', '+18'],
  ['action', 'Action'],
  ['adventure', 'Adventure'],
  ['cars', 'Cars'],
  ['comedy', 'Comedy'],
  ['crime', 'Crime'],
  ['demons', 'Demons'],
  ['donghua', 'Donghua'],
  ['drama', 'Drama'],
  ['drive', 'Drive'],
  ['ecchi', 'Ecchi'],
  ['fantasy', 'Fantasy'],
  ['game', 'Game'],
  ['gore', 'Gore'],
  ['gourmet', 'Gourmet'],
  ['harem', 'Harem'],
  ['historical', 'Historical'],
  ['horror', 'Horror'],
  ['isekai', 'Isekai'],
  ['josei', 'Josei'],
  ['live-action', 'Live Action'],
  ['magic', 'Magic'],
  ['martial-arts', 'Martial Arts'],
  ['mecha', 'Mecha'],
  ['medical', 'Medical'],
  ['military', 'Military'],
  ['music', 'Music'],
  ['mystery', 'Mystery'],
  ['mythology', 'Mythology'],
  ['olm', 'OLM'],
  ['parody', 'Parody'],
  ['police', 'Police'],
  ['psychological', 'Psychological'],
  ['racing', 'Racing'],
  ['reincarnation', 'Reincarnation'],
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
  ['supernatural', 'Supernatural'],
  ['super-power', 'Super Power'],
  ['survival', 'Survival'],
  ['suspense', 'Suspense'],
  ['thriller', 'Thriller'],
  ['vampire', 'Vampire'],
  ['zero-g', 'Zero-G'],
];

interface Genre {
  name?: string;
}
interface SeriesItem {
  slug?: string;
  title?: string;
  japaneseTitle?: string | null;
  description?: string | null;
  poster?: string | null;
  status?: string | null;
  releaseType?: string | null;
  releaseDate?: string | null;
  genres?: Genre[] | null;
  studio?: { name?: string } | null;
  season?: { name?: string } | null;
}
interface EpisodeItem {
  title?: string | null;
  subbed?: string | null;
  episodeNumber?: string | number | null;
  releasedAt?: string | null;
  createdAt?: string | null;
  series?: SeriesItem | null;
}

function summary(item: SeriesItem | null | undefined): AnimeSummary {
  if (!item?.slug || !item.title) throw new ParseError('A series has no slug or title: the site changed');
  return { url: item.slug, title: item.title.trim(), ...(item.poster && { thumbnailUrl: item.poster }) };
}

function dedupe(items: AnimeSummary[]): AnimeSummary[] {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(item.url) && !!seen.add(item.url));
}

async function series(params: Record<string, string | number | undefined>, page: number): Promise<AnimePage> {
  const result = await getPage<SeriesItem>('/series', { ...params, page, pageSize: PAGE_SIZE });
  return {
    items: dedupe(result.data.map(summary)),
    hasNextPage: result.meta.currentPage < result.meta.lastPage,
  };
}

export default defineExtension({
  preferences: () => [
    {
      type: 'text',
      key: 'apiUrl',
      label: 'API address',
      description: 'The site reads its data from this API; the website domain may change, the API has stayed.',
      default: DEFAULT_API_URL,
    },
  ],

  createSource: () => ({
    get baseUrl() {
      return base();
    },

    /** The site marks a dozen "hot" series; that is all it has for popular. */
    getPopular: (page) => series({ hot: 'true' }, page),

    /** Newest episodes first, shown as the series they belong to (one card per series). */
    async getLatest(page: number): Promise<AnimePage> {
      const result = await getPage<EpisodeItem>('/episodes', { page, pageSize: PAGE_SIZE });
      return {
        items: dedupe(result.data.map((episode) => summary(episode.series))),
        hasNextPage: result.meta.currentPage < result.meta.lastPage,
      };
    },

    search(query: string, page: number, filters: FilterState): Promise<AnimePage> {
      const genre = filters['genre'];
      return series(
        {
          q: query.trim() || undefined,
          genre: typeof genre === 'string' && /^[a-z0-9-]+$/.test(genre) ? genre : undefined,
        },
        page,
      );
    },

    getFilters: (): Filter[] => [
      {
        type: 'select',
        id: 'genre',
        label: 'Genre',
        options: [{ value: '', label: 'Any' }, ...GENRES.map(([value, label]) => ({ value, label }))],
        default: '',
      },
    ],

    async getAnimeDetails(anime: AnimeSummary): Promise<AnimeDetails> {
      const { data } = await getJson<{ data?: SeriesItem }>(`/series/${encodeURIComponent(anime.url)}`);
      const { title, thumbnailUrl } = summary(data);
      const genres = (data?.genres ?? []).map((g) => g.name?.trim() ?? '').filter(Boolean);
      const japanese = data?.japaneseTitle?.trim();
      return {
        url: anime.url,
        title,
        thumbnailUrl,
        altTitles: japanese && japanese !== title ? [japanese] : undefined,
        description: cleanText(data?.description),
        genres: genres.length > 0 ? genres : undefined,
        studio: data?.studio?.name?.trim() || undefined,
        year: airYear(data?.season?.name, data?.releaseDate),
        status: STATUSES[(data?.status ?? '').toLowerCase()] ?? 'unknown',
        type: TYPES[(data?.releaseType ?? '').toLowerCase()],
      };
    },

    /** The API lists newest first, and that is the contract too. */
    async getEpisodes(anime: AnimeSummary): Promise<Episode[]> {
      const path = `/series/${encodeURIComponent(anime.url)}/episodes`;
      const items: EpisodeItem[] = [];
      for (let page = 1; page <= MAX_EPISODE_PAGES; page++) {
        const result = await getPage<EpisodeItem>(path, { page, pageSize: EPISODE_PAGE_SIZE });
        items.push(...result.data);
        if (result.meta.currentPage >= result.meta.lastPage) break;
      }
      const seen = new Set<string>();
      const episodes: Episode[] = [];
      for (const item of items) {
        const raw = item.episodeNumber;
        if (raw === null || raw === undefined || String(raw).trim() === '') continue;
        const label = String(raw).trim();
        const url = episodeUrl(anime.url, label);
        if (seen.has(url)) continue;
        seen.add(url);
        const number = parseFloat(label);
        episodes.push({
          url,
          name: item.title?.trim() || `Episode ${label}`,
          ...(Number.isFinite(number) && { number }),
          ...(item.subbed && { variant: item.subbed }),
          uploadedAt: episodeTime(item.releasedAt, item.createdAt),
        });
      }
      return episodes;
    },

    getStreams,

    resolveUrl(url: string): AnimeSummary | null {
      const match = /^https?:\/\/(?:www\.)?oploverz\.[a-z]+\/(?:series|movie)\/([^/?#]+)/i.exec(url);
      const slug = match?.[1];
      return slug ? { url: slug, title: slug.replace(/-/g, ' ') } : null;
    },

    getWebUrl(item: AnimeSummary | Episode): string {
      const at = item.url.indexOf('/');
      return at < 0
        ? `${WEB_URL}/series/${item.url}`
        : `${WEB_URL}/series/${item.url.slice(0, at)}/episode/${item.url.slice(at + 1)}`;
    },
  }),
});
