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
  type Stream,
  defineExtension,
} from '@matane-anime/extension-sdk';

// Talks to the fake site in packages/test-site. Every request that a real extension would make is here:
// listings (HTML), detail (HTML), episodes (JSON), a watch page, embeds (plain and AES-encrypted).

const DEFAULT_BASE_URL = 'http://127.0.0.1:8080';
/** The fake site's "Server B" embeds are AES-128-CBC with this key and IV (see packages/test-site). */
const EMBED_KEY = 'matane-test-key!';
const EMBED_IV = new Array<number>(16).fill(1);

const base = (): string => (prefs.get<string>('baseUrl') ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

const STATUS_FILTER: Filter = {
  type: 'select',
  id: 'status',
  label: 'Status',
  options: [
    { value: '', label: 'Any' },
    { value: 'ongoing', label: 'Ongoing' },
    { value: 'completed', label: 'Completed' },
  ],
  default: '',
};
const GENRES = ['action', 'adventure', 'comedy', 'drama', 'mystery', 'slice-of-life'];

async function listing(path: string, params: Record<string, string>): Promise<AnimePage> {
  const query = new URLSearchParams(params).toString();
  const url = `${base()}${path}${query ? `?${query}` : ''}`;
  const doc = html.load((await http.get(url)).text, { baseUrl: url });
  const items = doc.select('div.card').map((card): AnimeSummary => {
    const link = card.selectFirst('a');
    const href = link?.attr('href');
    const title = card.selectFirst('h3.title')?.text().trim();
    if (!href || !title) throw new ParseError('A card has no link or title: the site layout changed');
    const thumbnailUrl = card.selectFirst('img')?.absUrl('src');
    return { url: href, title, ...(thumbnailUrl && { thumbnailUrl }) };
  });
  return { items, hasNextPage: doc.selectFirst('a.next') !== null };
}

/** `genre=a,-b` as the site expects it, from tri-state filter values. */
function genreParam(filters: FilterState): string {
  return GENRES.flatMap((genre) => {
    const state = filters[`genre-${genre}`];
    return state === 'include' ? [genre] : state === 'exclude' ? [`-${genre}`] : [];
  }).join(',');
}

export default defineExtension({
  preferences: () => [
    {
      type: 'text',
      key: 'baseUrl',
      label: 'Site address',
      description: 'Where the fake site listens (pnpm --filter @matane-anime/test-site serve).',
      default: DEFAULT_BASE_URL,
    },
    { type: 'switch', key: 'showDub', label: 'Show dubbed episodes', default: true },
  ],

  createSource: ({ lang }) => ({
    get baseUrl() {
      return base();
    },

    getPopular: (page) => listing('/popular', { page: String(page) }),
    getLatest: (page) => listing('/latest', { page: String(page) }),

    search(query, page, filters: FilterState) {
      const params: Record<string, string> = { page: String(page) };
      if (query) params['q'] = query;
      if (typeof filters['status'] === 'string' && filters['status']) params['status'] = filters['status'];
      const genre = genreParam(filters);
      if (genre) params['genre'] = genre;
      const sort = filters['sort'];
      if (sort && typeof sort === 'object') {
        params['sort'] = sort.value;
        params['dir'] = sort.ascending ? 'asc' : 'desc';
      }
      return listing('/search', params);
    },

    getFilters: (): Filter[] => [
      STATUS_FILTER,
      {
        type: 'sort',
        id: 'sort',
        label: 'Sort by',
        options: [
          { value: 'title', label: 'Title' },
          { value: 'year', label: 'Year' },
        ],
      },
      {
        type: 'group',
        id: 'genres',
        label: 'Genres',
        filters: GENRES.map((genre) => ({ type: 'tristate', id: `genre-${genre}`, label: genre })),
      },
    ],

    async getAnimeDetails(anime: AnimeSummary): Promise<AnimeDetails> {
      const url = `${base()}${anime.url}`;
      const doc = html.load((await http.get(url)).text, { baseUrl: url });
      const title = doc.selectFirst('h1.title')?.text().trim();
      if (!title) throw new ParseError('The detail page has no title');
      const alt = (doc.selectFirst('p.alt')?.text() ?? '')
        .split('/')
        .map((t) => t.trim())
        .filter(Boolean);
      const status = doc.selectFirst('dd.status')?.text().trim();
      const type = doc.selectFirst('dd.type')?.text().trim();
      const year = Number(doc.selectFirst('dd.year')?.text());
      return {
        url: anime.url,
        title,
        thumbnailUrl: doc.selectFirst('img.cover')?.absUrl('src'),
        altTitles: alt,
        description: doc.selectFirst('p.synopsis')?.text().trim(),
        genres: doc.select('ul.genres li').map((li) => li.text().trim()),
        studio: doc.selectFirst('dd.studio')?.text().trim(),
        year: Number.isFinite(year) && year > 0 ? year : undefined,
        status: status === 'ongoing' || status === 'completed' ? status : 'unknown',
        type: type === 'tv' || type === 'movie' || type === 'ova' ? type : undefined,
      };
    },

    async getEpisodes(anime: AnimeSummary): Promise<Episode[]> {
      const { episodes } = (await http.get(`${base()}${anime.url}/episodes.json`)).json<{
        episodes: { number: number; title: string; variant: string; uploadedAt: number }[];
      }>();
      const showDub = prefs.get<boolean>('showDub') ?? true;
      const slug = anime.url.split('/').pop();
      return episodes
        .filter((episode) => showDub || episode.variant !== 'Dub')
        .map((episode) => ({
          url: `/watch/${slug}/${episode.number}?variant=${episode.variant}`,
          name: lang === 'id' ? `Episode ${episode.number}` : episode.title,
          number: episode.number,
          variant: episode.variant,
          uploadedAt: episode.uploadedAt,
        }));
    },

    async getStreams(episode: Episode): Promise<Stream[]> {
      const referer = `${base()}/`;
      const watchUrl = `${base()}${episode.url}`;
      const doc = html.load((await http.get(watchUrl)).text, { baseUrl: watchUrl });
      const embeds = doc.select('a.server').map((a) => ({ server: a.text().trim(), path: a.attr('data-embed') }));
      const streams: Stream[] = [];
      for (const { server, path } of embeds) {
        if (!path) continue;
        const embed = (await http.get(`${base()}${path}`, { headers: { Referer: referer } })).text;
        let file: string | undefined;
        let quality: number | undefined;
        const config = /window\.player = (\{.*?\});/s.exec(embed)?.[1];
        const payload = /data-payload="([^"]+)"/.exec(embed)?.[1];
        if (config) {
          const source = JSON.parse(config).sources?.[0] as { file: string; label?: string } | undefined;
          file = source?.file;
          quality = Number(/(\d+)p/.exec(source?.label ?? '')?.[1]) || undefined;
        } else if (payload) {
          file = utf8.decode(crypto.aesDecrypt(base64.decodeBytes(payload), EMBED_KEY, { mode: 'cbc', iv: EMBED_IV }));
          quality = Number(/data-quality="(\d+)"/.exec(embed)?.[1]) || undefined;
        }
        if (file) streams.push({ url: file, server, quality, headers: { Referer: referer } });
      }
      if (streams.length === 0) throw new NotFoundError('This episode has no servers');
      return streams;
    },

    resolveUrl(url: string): AnimeSummary | null {
      const match = /\/anime\/([a-z0-9-]+)\/?$/i.exec(url);
      if (!match || !url.startsWith(base())) return null;
      const slug = match[1] as string;
      return { url: `/anime/${slug}`, title: slug.replace(/-/g, ' ') };
    },

    getWebUrl: (item: AnimeSummary | Episode) => `${base()}${item.url}`,

    // An old layout used /series/<slug>; keep libraries from before the change working.
    migrateUrl: (url: string) => (url.startsWith('/series/') ? url.replace('/series/', '/anime/') : null),
  }),
});
