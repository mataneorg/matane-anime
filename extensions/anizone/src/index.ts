import '@matane-anime/extension-sdk/globals';
import {
  type AnimeDetails,
  type AnimePage,
  type AnimeSummary,
  type Episode,
  type Filter,
  type FilterState,
  HttpError,
  NotFoundError,
  ParseError,
  RateLimitedError,
  defineExtension,
} from '@matane-anime/extension-sdk';
import { type Component, type ListPage, callComponent, findComponent } from './livewire';
import { DEFAULT_BASE_URL, base, fetchPage, memo } from './site';
import { getStreams } from './streams';
import {
  type Titles,
  altTitles,
  bestTitle,
  collapse,
  decodeCursor,
  entityPath,
  parseAirDate,
  parseStatus,
  parseType,
  readJson,
  readPaging,
} from './text';

// anizone.to: Laravel + Livewire, English. There is no JSON API: pages embed their data as `JSON.parse('…')` in
// Alpine `x-data` values (read as text, nothing is evaluated), and a list continues through Livewire calls (see
// livewire.ts). Entity urls are "/anime/<slug>" for a series and "/anime/<slug>/<episode>" for an episode.

const EMPTY: AnimePage = { items: [], hasNextPage: false };
const PAGE_SIZE = 24;
/** Episode pages are fetched this many at a time. */
const EPISODE_BATCH = 8;
/** More than this many list pages of one series are never read (24 each). */
const MAX_EPISODE_PAGES = 120;
const CURSORS_KEY = 'cursors';
/** `getEpisodes` may run 60 s: the pages stop being asked for after this long, and what was read is returned. */
const EPISODE_BUDGET_MS = 45_000;
/**
 * A page read a moment ago is not fetched again: the details and the episodes of a series share one page, and the
 * next page of a list shares the index page.
 */
const PAGE_TTL_MS = 15_000;

const TYPE_OPTIONS = [
  ['0', 'All'],
  ['2', 'TV Series'],
  ['4', 'Movie'],
  ['3', 'OVA'],
  ['7', 'TV Special'],
  ['6', 'Web'],
  ['8', 'Music Video'],
  ['5', 'Other'],
  ['1', 'Unknown'],
] as const;

const SORT_OPTIONS = [
  ['title-asc', 'A-Z'],
  ['title-desc', 'Z-A'],
  ['release-desc', 'Latest release'],
  ['release-asc', 'Earliest release'],
  ['added-desc', 'Last added'],
  ['added-asc', 'First added'],
] as const;

const DEFAULT_SORT = 'title-asc';
const DEFAULT_TYPE = '0';

interface SeriesItem {
  slug?: string;
  main_title?: string;
  title_list?: Titles | null;
  cover?: string | null;
  is_unsafe?: boolean;
}

interface EpisodeItem {
  slug?: string;
  title_list?: Titles | null;
  air_date?: string | null;
  type?: string | null;
  is_unsafe?: boolean;
  snapshot?: string | null;
  anime?: SeriesItem | null;
}

function summary(item: SeriesItem, fallbackCover?: string | null): AnimeSummary {
  const title = bestTitle(item.title_list, item.main_title);
  if (!item.slug || !title) throw new ParseError('A series has no slug or title: the site changed');
  const cover = item.cover || fallbackCover;
  return { url: `/anime/${item.slug}`, title, ...(cover && { thumbnailUrl: cover }) };
}

const dedupe = (items: AnimeSummary[]): AnimeSummary[] => {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(item.url) && !!seen.add(item.url));
};

const pick = <T extends string>(value: unknown, allowed: readonly (readonly [T, string])[]): T | undefined =>
  allowed.find(([v]) => v === value)?.[0];

// ------------------------------------------------------------------ the index (Livewire)

interface Query {
  search: string;
  sort: string;
  type: string;
}

const cacheKey = (q: Query): string => `${q.search}|${q.sort}|${q.type}`;

async function loadCursors(q: Query): Promise<Record<number, string>> {
  const all = (await storage.get<Record<string, Record<number, string>>>(CURSORS_KEY)) ?? {};
  return all[cacheKey(q)] ?? {};
}

async function saveCursors(q: Query, cursors: Record<number, string>): Promise<void> {
  const all = (await storage.get<Record<string, Record<number, string>>>(CURSORS_KEY)) ?? {};
  // A handful of queries are remembered: the cursors are what makes page 5 cost 2 calls instead of 5.
  const keys = Object.keys(all)
    .filter((k) => k !== cacheKey(q))
    .slice(-7);
  const next: Record<string, Record<number, string>> = {};
  for (const k of keys) next[k] = all[k] as Record<number, string>;
  next[cacheKey(q)] = cursors;
  await storage.set(CURSORS_KEY, next);
}

const toPage = (list: ListPage): AnimePage => ({
  items: dedupe((list.items as SeriesItem[]).filter((item) => item.is_unsafe !== true).map((item) => summary(item))),
  hasNextPage: list.hasMore,
});

/**
 * One page of the index. The first page of an unsorted list is in the HTML; a sort or a type is a Livewire update,
 * and every later page a `loadPage` call with the cursor of the previous one (cursors are remembered).
 */
async function index(q: Query, page: number): Promise<AnimePage> {
  const n = Math.max(1, Math.floor(page));
  const path = `/anime${q.search ? `?${new URLSearchParams({ search: q.search }).toString()}` : ''}`;
  const url = `${base()}${path}`;
  // The next page of a list asks for the same index page (its token and component) again.
  const text = (await memo(url, PAGE_TTL_MS, () => fetchPage(url))).text;
  const items = readJson<unknown[]>(text, 'items');
  if (!items) throw new ParseError('The index page has no items: the site layout changed');
  let list: ListPage = { items, ...readPaging(text) };
  let component: Component | undefined = findComponent(text, 'pages.anime-index', `${base()}${path}`);

  const changed = q.sort !== DEFAULT_SORT || q.type !== DEFAULT_TYPE;
  if (changed || n > 1) {
    if (!component) throw new ParseError('The index page has no Livewire component: the site layout changed');
  }
  if (changed && component) {
    const updated = await callComponent(component, { sort: q.sort, type: q.type }, []);
    component = updated.component;
    if (!updated.list) throw new ParseError('Livewire gave no list after the update: the site changed');
    list = updated.list;
  }
  if (n === 1) {
    if (list.nextCursor) await saveCursors(q, { ...(await loadCursors(q)), 1: list.nextCursor });
    return toPage(list);
  }

  const cursors = await loadCursors(q);
  if (list.nextCursor) cursors[1] = list.nextCursor;
  // The nearest page below n-1 whose cursor is known; the pages in between are read one by one.
  let known = n - 1;
  while (known > 1 && !cursors[known]) known--;
  let current = component as Component;
  for (let k = known; k <= n - 1; k++) {
    const cursor = cursors[k];
    if (!cursor) return EMPTY;
    const step = await callComponent(current, {}, [{ path: '', method: 'loadPage', params: [cursor] }]);
    current = step.component;
    if (!step.list) throw new ParseError('Livewire gave no list for the next page: the site changed');
    if (step.list.nextCursor) cursors[k + 1] = step.list.nextCursor;
    list = step.list;
    if (!step.list.hasMore && k < n - 1) {
      await saveCursors(q, cursors);
      return EMPTY;
    }
  }
  await saveCursors(q, cursors);
  return toPage(list);
}

/** Pages past the first need the session cookie; where there is none, the list simply ends. */
async function indexOrEnd(q: Query, page: number): Promise<AnimePage> {
  try {
    return await index(q, page);
  } catch (error) {
    if (page > 1 && error instanceof HttpError && error.status === 419) {
      log.warn('The site wants a session for more pages; the list ends here');
      return EMPTY;
    }
    throw error;
  }
}

// ------------------------------------------------------------------ the series page

interface DetailPage {
  text: string;
  doc: HtmlElement;
}
type HtmlElement = ReturnType<typeof html.load>;

async function seriesPage(anime: AnimeSummary): Promise<DetailPage> {
  const url = `${base()}${anime.url}`;
  const text = (await memo(url, PAGE_TTL_MS, () => fetchPage(url))).text;
  const doc = html.load(text, { baseUrl: url });
  if (!doc.selectFirst('h1')) throw new ParseError('The series page has no title: the site layout changed');
  return { text, doc };
}

/** Episode `slug` is the number for regular episodes and some other word for specials. */
function episodeOf(seriesPath: string, item: EpisodeItem): Episode | undefined {
  if (!item.slug) return undefined;
  const number = /^\d+(?:\.\d+)?$/.test(item.slug) ? Number.parseFloat(item.slug) : undefined;
  const title = bestTitle(item.title_list);
  const uploadedAt = parseAirDate(item.air_date);
  const regular = item.type === undefined || item.type === null || item.type === 'Regular Episode';
  return {
    url: `${seriesPath}/${item.slug}`,
    name: title || (number !== undefined ? `Episode ${number}` : item.slug),
    ...(number !== undefined && regular && { number }),
    ...(uploadedAt !== undefined && { uploadedAt }),
  };
}

/** One page of episodes; the site answers 429 when asked too fast, so that is waited out (twice) before giving up. */
async function loadEpisodePage(component: Component, cursor: string): Promise<ListPage | undefined> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return (await callComponent(component, {}, [{ path: '', method: 'loadPage', params: [cursor] }])).list;
    } catch (error) {
      if (!(error instanceof RateLimitedError) || attempt === 2) {
        if (error instanceof HttpError && error.status === 419) throw error;
        return undefined;
      }
      await timers.sleep(1500 * (attempt + 1));
    }
  }
  return undefined;
}

/** A cursor for the page after the `k`-th of 24 items, in the form the site makes (see `decodeCursor`). */
function forgedCursor(first: string, k: number): string | undefined {
  const parts = decodeCursor(first, (t) => base64.decode(t));
  if (!parts || typeof parts['sort'] !== 'number' || typeof parts['id'] !== 'number') return undefined;
  // The keyset is (sort, id): id 0 keeps the item at `sort` itself in the page, and the repeat is removed later.
  return base64.encode(JSON.stringify({ ...parts, sort: PAGE_SIZE * k, id: 0 }));
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

    /** The site has no popularity order: the latest releases stand in for it (A-Z where the session is missing). */
    async getPopular(page: number): Promise<AnimePage> {
      const q: Query = { search: '', sort: 'release-desc', type: DEFAULT_TYPE };
      try {
        return await indexOrEnd(q, page);
      } catch (error) {
        if (!(error instanceof HttpError) || page > 1) throw error;
        log.warn('Sorting needs a session; showing the A-Z list');
        return index({ ...q, sort: DEFAULT_SORT }, 1);
      }
    },

    /** Page 1 is the home page's 12 newest episodes (with dates); the rest follows the "last added" order. */
    async getLatest(page: number): Promise<AnimePage> {
      if (page > 1) return indexOrEnd({ search: '', sort: 'added-desc', type: DEFAULT_TYPE }, page - 1);
      const text = (await fetchPage(`${base()}/`)).text;
      const episodes = readJson<EpisodeItem[]>(text, 'latestEpisodes');
      if (!episodes) throw new ParseError('The home page has no latest episodes: the site layout changed');
      const items = episodes
        .filter((e) => e.is_unsafe !== true && e.anime?.is_unsafe !== true && e.anime)
        .map((e) => summary(e.anime as SeriesItem, e.snapshot));
      return { items: dedupe(items), hasNextPage: true };
    },

    search(query: string, page: number, filters: FilterState): Promise<AnimePage> {
      return indexOrEnd(
        {
          search: query.trim(),
          sort: pick(filters['sort'], SORT_OPTIONS) ?? DEFAULT_SORT,
          type: pick(filters['type'], TYPE_OPTIONS) ?? DEFAULT_TYPE,
        },
        page,
      );
    },

    getFilters: (): Filter[] => [
      {
        type: 'header',
        label: 'Sorting, the type and every page after the first need a session cookie from the site.',
      },
      {
        type: 'select',
        id: 'type',
        label: 'Type',
        options: TYPE_OPTIONS.map(([value, label]) => ({ value, label })),
        default: DEFAULT_TYPE,
      },
      {
        type: 'select',
        id: 'sort',
        label: 'Order by',
        options: SORT_OPTIONS.map(([value, label]) => ({ value, label })),
        default: DEFAULT_SORT,
      },
    ],

    async getAnimeDetails(anime: AnimeSummary): Promise<AnimeDetails> {
      const { text, doc } = await seriesPage(anime);
      const titles = readJson<Titles>(text, 'anmTitles');
      const title = bestTitle(titles, anime.title);
      if (!title) throw new ParseError('The series has no title');
      const facts = doc
        .select('h1 + div > span')
        .map((s) => collapse(s.text()))
        .filter(Boolean);
      const synopsis = collapse(doc.selectFirst('h3.sr-only + div')?.text() ?? '');
      const tags = doc
        .select('a[href*="/tag/"]')
        .map((a) => collapse(a.text()))
        .filter(Boolean);
      const alt = altTitles(titles, title);
      const year = facts.map((f) => /^(\d{4})$/.exec(f)?.[1]).find(Boolean);
      return {
        url: anime.url,
        title,
        thumbnailUrl: doc.selectFirst('img[src*="/images/anime/"]')?.absUrl('src') || undefined,
        altTitles: alt.length > 0 ? alt : undefined,
        description: synopsis || undefined,
        genres: tags.length > 0 ? tags : undefined,
        year: year ? Number(year) : undefined,
        status: parseStatus(facts.find((f) => /^(?:ongoing|completed)$/i.test(f)) ?? ''),
        type: parseType(facts[0] ?? ''),
      };
    },

    /**
     * The first 24 episodes are in the page, the rest come through Livewire. A series of 1000 episodes would
     * take 40 sequential calls of 2 s each; the cursors are of a keyset (`sort`, `id`), so the pages are asked for
     * in parallel by rebuilding the cursor of each. Newest first.
     */
    async getEpisodes(anime: AnimeSummary): Promise<Episode[]> {
      const { text } = await seriesPage(anime);
      const seriesPath = entityPath(anime.url, base());
      const first = readJson<EpisodeItem[]>(text, 'items');
      if (!first) throw new ParseError('The series page has no episode list: the site layout changed');
      const items: EpisodeItem[] = [...first];
      const paging = readPaging(text);
      const component = findComponent(text, 'pages.anime-detail', `${base()}${seriesPath}`);
      if (paging.hasMore && paging.nextCursor && component) {
        try {
          // The page says how many episodes there are: pages past the last one are not asked for (each is a request
          // that can be answered with a 429, and waited out).
          const counts = [...text.matchAll(/(\d+)\s+Episodes\b/g)].map((m) => Number(m[1]));
          const wanted = counts.length > 0 ? Math.ceil(Math.max(...counts) / PAGE_SIZE) - 1 : MAX_EPISODE_PAGES;
          const cursors: (string | undefined)[] = [];
          for (let k = 1; k <= Math.min(MAX_EPISODE_PAGES, Math.max(1, wanted)); k++)
            cursors.push(k === 1 ? paging.nextCursor : forgedCursor(paging.nextCursor, k));
          if (cursors.some((c) => !c))
            throw new ParseError('The episode cursor has a form this extension does not know');
          const started = Date.now();
          for (let at = 0; at < cursors.length; at += EPISODE_BATCH) {
            if (Date.now() - started > EPISODE_BUDGET_MS) {
              log.warn('The time for the episode list ran out; the list is incomplete');
              break;
            }
            const batch = await Promise.all(
              cursors.slice(at, at + EPISODE_BATCH).map((cursor) => loadEpisodePage(component, cursor as string)),
            );
            let more = false;
            for (const list of batch) {
              items.push(...((list?.items as EpisodeItem[] | undefined) ?? []));
              more = list?.hasMore === true;
            }
            // A page that could not be read (even after the retries) ends the list there: what was read is kept.
            if (batch.some((list) => list === undefined)) {
              log.warn('Some episode pages could not be read; the list is incomplete');
              break;
            }
            if (!more) break;
          }
        } catch (error) {
          // Without a session (or if the cursor changed) the page's own 24 episodes are what there is.
          log.warn('Only the first episodes could be read:', (error as Error).message);
        }
      }
      const seen = new Set<string>();
      const episodes: Episode[] = [];
      for (const item of items) {
        if (item.is_unsafe === true) continue;
        const episode = episodeOf(seriesPath, item);
        if (!episode || seen.has(episode.url)) continue;
        seen.add(episode.url);
        episodes.push(episode);
      }
      if (episodes.length === 0) throw new NotFoundError('This series has no episodes yet');
      // Newest first. Array.sort is stable, so unnumbered entries keep their order, after the numbered ones.
      return episodes.sort((a, b) => (b.number ?? -Infinity) - (a.number ?? -Infinity) || 0);
    },

    getStreams,

    resolveUrl(url: string): AnimeSummary | null {
      const match = /^https?:\/\/(?:www\.)?anizone\.[a-z]+\/anime\/([^/?#]+)/i.exec(url);
      const slug = match?.[1];
      return slug ? { url: `/anime/${slug}`, title: slug } : null;
    },

    getWebUrl: (item: AnimeSummary | Episode) => `${base()}${item.url}`,
  }),
});
