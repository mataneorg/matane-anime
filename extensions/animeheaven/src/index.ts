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
import { DEFAULT_BASE_URL, base, fetchPage, memo } from './site';
import { getStreams } from './streams';
import { animePath, collapse, isAdultTag, isEpisodeKey, parseAge, parseNumber, readYear } from './text';

// animeheaven.me: hand-written PHP, HTML only, English sub. An anime is "/anime.php?<id>"; an episode is the 32-hex key
// found on the detail page. Every list is a single page without paging (new.php ~70, popular.php 100, tag and search
// pages up to ~700 cards), so the long ones are cut into pages here.

const PAGE_SIZE = 50;
const NOW = (): number => Date.now();
/** A list is one page of up to ~700 cards that is cut into pages here: the cards are kept for the next page. */
const LIST_TTL_MS = 30_000;
/** The details and the episodes of an anime come from one page, which is fetched once for both. */
const DETAIL_TTL_MS = 15_000;

/** Tags the site offers (`tags.php?tag=`); there is no index page for them. Adult tags are left out on purpose. */
const TAGS = [
  'Action',
  'Adventure',
  'Based On A Manga',
  'Comedy',
  'Drama',
  'Ecchi',
  'Fantasy',
  'Historical',
  'Horror',
  'Isekai',
  'Magic',
  'Mecha',
  'Military',
  'Music',
  'Mystery',
  'Psychological',
  'Romance',
  'School',
  'Sci-Fi',
  'Seinen',
  'Shoujo',
  'Shounen',
  'Slice of Life',
  'Sports',
  'Supernatural',
  'Thriller',
].filter((tag) => !isAdultTag(tag));

/** Reads cards of both kinds: `div.chart` (new, popular) and `div.similarimg` (search, tags). */
function readCards(doc: HtmlElement, baseUrl: string): AnimeSummary[] {
  const items: AnimeSummary[] = [];
  const seen = new Set<string>();
  const add = (href: string | undefined, title: string, cover: string | undefined): void => {
    if (!href) return;
    const url = animePath(href, baseUrl);
    if (!url || seen.has(url)) return;
    if (!title) throw new ParseError('A card has no title: the site layout changed');
    seen.add(url);
    items.push({ url, title, ...(cover && { thumbnailUrl: cover }) });
  };
  for (const card of doc.select('div.chart')) {
    const link = card.selectFirst('.charttitle a');
    add(link?.attr('href'), collapse(link?.text() ?? ''), card.selectFirst('img.coverimg')?.absUrl('src'));
  }
  for (const card of doc.select('div.similarimg')) {
    const link = card.selectFirst('.similarname a');
    add(link?.attr('href'), collapse(link?.text() ?? ''), card.selectFirst('img.coverimg')?.absUrl('src'));
  }
  return items;
}

async function listing(path: string, page: number): Promise<AnimePage> {
  const url = `${base()}${path}`;
  const all = await memo(url, LIST_TTL_MS, async () => {
    const doc = html.load((await fetchPage(url)).text, { baseUrl: url });
    const cards = readCards(doc, url);
    if (cards.length === 0 && !doc.selectFirst('div.header')) {
      throw new ParseError('The listing has no cards and no page frame: the site layout changed');
    }
    return cards;
  });
  const from = (Math.max(1, Math.floor(page)) - 1) * PAGE_SIZE;
  return { items: all.slice(from, from + PAGE_SIZE), hasNextPage: all.length > from + PAGE_SIZE };
}

async function detailPage(anime: AnimeSummary): Promise<HtmlElement> {
  const path = animePath(anime.url, base());
  if (!path) throw new NotFoundError(`Not an anime address: ${anime.url}`);
  const url = `${base()}${path}`;
  const doc = html.load((await memo(url, DETAIL_TTL_MS, () => fetchPage(url))).text, { baseUrl: url });
  if (!doc.selectFirst('.infotitle')) throw new NotFoundError(`Not found: ${anime.url}`);
  return doc;
}

export default defineExtension({
  preferences: () => [
    {
      type: 'text',
      key: 'baseUrl',
      label: 'Site address',
      description: 'Change it if the domain stops working.',
      default: DEFAULT_BASE_URL,
    },
  ],

  createSource: () => ({
    get baseUrl() {
      return base();
    },

    getPopular: (page) => listing('/popular.php', page),

    getLatest: (page) => listing('/new.php', page),

    search(query: string, page: number, filters: FilterState): Promise<AnimePage> {
      const text = query.trim();
      if (text) return listing(`/search.php?${new URLSearchParams({ s: text }).toString()}`, page);
      const tag = filters['tag'];
      if (typeof tag === 'string' && TAGS.includes(tag)) {
        return listing(`/tags.php?${new URLSearchParams({ tag }).toString()}`, page);
      }
      return listing('/new.php', page);
    },

    getFilters: (): Filter[] => [
      { type: 'header', label: 'The tag applies only when the search box is empty.' },
      {
        type: 'select',
        id: 'tag',
        label: 'Tag',
        options: [{ value: '', label: 'Any' }, ...TAGS.map((value) => ({ value, label: value }))],
        default: '',
      },
    ],

    async getAnimeDetails(anime: AnimeSummary): Promise<AnimeDetails> {
      const doc = await detailPage(anime);
      const title = collapse(doc.selectFirst('.infotitle')?.text() ?? '');
      if (!title) throw new ParseError('The detail page has no title');
      const tags = doc
        .select('.infotags a')
        .map((a) => collapse(a.text()))
        .filter((tag) => tag && !isAdultTag(tag));
      const description = collapse(doc.selectFirst('.infodes')?.text() ?? '');
      const cover = doc.selectFirst('img.posterimg')?.absUrl('src');
      const yearText = collapse(doc.selectFirst('.infoyear')?.text() ?? '');
      const year = readYear(/Year:\s*(\S+)/i.exec(yearText)?.[1] ?? '');
      return {
        url: anime.url,
        title,
        thumbnailUrl: cover || undefined,
        description: description || undefined,
        genres: tags.length > 0 ? tags : undefined,
        year,
        // The site publishes no status; a year range such as "1999-?" means it is still running.
        status: /Year:\s*\d{4}\s*-\s*\?/i.test(yearText) ? 'ongoing' : 'unknown',
      };
    },

    /** Every episode the page lists, newest first. Raw releases ("2raw") have no number and are left out. */
    async getEpisodes(anime: AnimeSummary): Promise<Episode[]> {
      const doc = await detailPage(anime);
      const now = NOW();
      const seen = new Set<string>();
      const episodes: Episode[] = [];
      for (const link of doc.select("a[href='gate.php']")) {
        const key = (link.attr('id') ?? '').trim();
        if (!isEpisodeKey(key) || seen.has(key)) continue;
        const number = parseNumber(link.selectFirst('.watch2')?.text() ?? '');
        if (number === undefined) continue;
        seen.add(key);
        const ages = link.select('.watch1').map((n) => collapse(n.text()));
        const age = parseAge(ages[ages.length - 1] ?? '');
        episodes.push({
          url: key,
          name: `Episode ${number}`,
          number,
          variant: 'Sub',
          ...(age !== undefined && { uploadedAt: now - age }),
        });
      }
      return episodes.sort((a, b) => (b.number ?? 0) - (a.number ?? 0));
    },

    getStreams,

    resolveUrl(url: string): AnimeSummary | null {
      const match = /^https?:\/\/(?:www\.)?animeheaven\.[a-z]+\/anime\.php\?([a-z0-9]+)/i.exec(url);
      const id = match?.[1];
      return id ? { url: `/anime.php?${id}`, title: id } : null;
    },

    getWebUrl: (item: AnimeSummary | Episode) => (isEpisodeKey(item.url) ? `${base()}/` : `${base()}${item.url}`),
  }),
});
