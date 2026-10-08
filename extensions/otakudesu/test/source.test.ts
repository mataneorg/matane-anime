import { afterEach, describe, expect, it } from 'vitest';
import { BASE, type Route, disposeAll, fixture, load, pages } from './harness';

afterEach(disposeAll);

const url = (path: string) => `${BASE}${path}`;
const ONGOING = url('/ongoing-anime/');
const redirectToOtherDomain: Route = () => ({
  status: 200,
  url: 'https://otakudesu.io/',
  text: '<html>Otakudesu Official</html>',
});

describe('listings', () => {
  it('reads the ongoing list as the latest, with paths as identities', async () => {
    const { client, requests } = await load(pages({ [ONGOING]: fixture('ongoing_p1.txt') }));
    const page = await client.getLatest(1);
    expect(requests.map((r) => r.url)).toEqual([ONGOING]);
    expect(page.items).toHaveLength(25);
    expect(page.hasNextPage).toBe(true);
    expect(page.items[0]).toEqual({
      url: '/anime/kikansha-mahou-tokubetsu-s2-sub-indo/',
      title: 'Kikansha no Mahou wa Tokubetsu desu Season 2',
      thumbnailUrl: 'https://otakudesu.blog/wp-content/uploads/2026/10/160052.jpg',
    });
  });

  it('asks for /page/N/ after the first page, and the last page has no next', async () => {
    const { client, requests } = await load(pages({ [url('/ongoing-anime/page/6/')]: fixture('ongoing_p6.txt') }));
    const page = await client.getLatest(6);
    expect(requests[0]?.url).toBe(url('/ongoing-anime/page/6/'));
    expect(page.items).toHaveLength(9);
    expect(page.hasNextPage).toBe(false);
  });

  it('treats a page past the end ("Not Found" with a 200) as empty, not as a broken layout', async () => {
    const { client } = await load(pages({ [url('/ongoing-anime/page/99/')]: fixture('ongoing_p99.txt') }));
    expect(await client.getLatest(99)).toEqual({ items: [], hasNextPage: false });
  });

  it('reports a layout change instead of an empty list', async () => {
    const { client } = await load(pages({ [ONGOING]: '<html><body><p>surprise</p></body></html>' }));
    await expect(client.getLatest(1)).rejects.toThrow(/layout changed/);
  });

  it('reads the completed list as the popular one', async () => {
    const { client, requests } = await load(pages({ [url('/complete-anime/')]: fixture('complete_p1.txt') }));
    const page = await client.getPopular(1);
    expect(requests[0]?.url).toBe(url('/complete-anime/'));
    expect(page.items).toHaveLength(25);
    expect(page.items.find((i) => i.url === '/anime/oni-hanayome-sub-indo/')?.title).toBe('Oni no Hanayome');
  });

  it('turns a redirect to another domain into an empty page', async () => {
    const { client } = await load(redirectToOtherDomain);
    expect(await client.getLatest(2)).toEqual({ items: [], hasNextPage: false });
  });

  it('follows the site address preference but keeps paths as identities', async () => {
    const { client, requests } = await load(
      pages({ 'https://mirror.example/ongoing-anime/': fixture('ongoing_p1.txt') }),
    );
    const page = await client.getLatest(1, { prefs: { baseUrl: 'https://mirror.example/' } });
    expect(requests[0]?.url).toBe('https://mirror.example/ongoing-anime/');
    expect(page.items[0]?.url).toBe('/anime/kikansha-mahou-tokubetsu-s2-sub-indo/');
  });
});

describe('search', () => {
  it('searches anime and strips the language suffix from titles', async () => {
    const { client, requests } = await load(
      pages({ [url('/?s=naruto&post_type=anime')]: fixture('search_naruto.txt') }),
    );
    const page = await client.search('naruto', 1);
    expect(requests[0]?.url).toBe(url('/?s=naruto&post_type=anime'));
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ url: '/anime/borot-sub-indo/', title: 'Boruto: Naruto Next Generations' });
    expect(page.items[0]?.thumbnailUrl).toMatch(/Boruto-Sub-Indo\.jpg$/);
    expect(page.hasNextPage).toBe(false);
  });

  it('reads a full result page', async () => {
    const { client } = await load(pages({ [url('/?s=one&post_type=anime')]: fixture('search_one.txt') }));
    const page = await client.search('one', 1);
    expect(page.items).toHaveLength(15);
    expect(page.items.every((item) => item.url.startsWith('/anime/') && item.title !== '')).toBe(true);
  });

  it('returns nothing, successfully, for a query with no hits', async () => {
    const { client } = await load(pages({ [url('/?s=zzzxqwkj&post_type=anime')]: fixture('search_empty.txt') }));
    expect(await client.search('zzzxqwkj', 1)).toEqual({ items: [], hasNextPage: false });
  });

  it('has only one page: later pages are empty and cost no request', async () => {
    const { client, requests } = await load(() => undefined);
    expect(await client.search('naruto', 2)).toEqual({ items: [], hasNextPage: false });
    expect(requests).toHaveLength(0);
  });

  it('encodes the query', async () => {
    const { client, requests } = await load(pages({}));
    await client.search('a b&c', 1).catch(() => undefined);
    expect(requests[0]?.url).toBe(url('/?s=a+b%26c&post_type=anime'));
  });

  it('browses a genre when the search box is empty, with its own paging', async () => {
    const { client, requests } = await load(pages({ [url('/genres/action/page/2/')]: fixture('genre_action.txt') }));
    const page = await client.search('', 2, { genre: 'action' });
    expect(requests[0]?.url).toBe(url('/genres/action/page/2/'));
    expect(page.items).toHaveLength(15);
    expect(page.hasNextPage).toBe(true);
    // The cover's alt text names another anime; the link and title are what count.
    expect(page.items[0]?.title).toBe('Kikansha no Mahou wa Tokubetsu desu Season 2');
  });

  it('falls back to the chosen list, and ignores a genre that is not a slug', async () => {
    const { client, requests } = await load(
      pages({ [ONGOING]: fixture('ongoing_p1.txt'), [url('/complete-anime/')]: fixture('complete_p1.txt') }),
    );
    await client.search('', 1, { genre: '../x' });
    await client.search('', 1, { list: 'complete' });
    expect(requests.map((r) => r.url)).toEqual([ONGOING, url('/complete-anime/')]);
  });

  it('offers a list and a genre filter', async () => {
    const { client } = await load(pages({}));
    const filters = await client.getFilters();
    expect(filters.map((f) => f.type)).toEqual(['header', 'select', 'select']);
    const genre = filters[2];
    expect(genre?.type === 'select' && genre.options).toHaveLength(37);
  });
});

describe('getAnimeDetails', () => {
  const details = async (path: string, file: string) => {
    const { client, requests } = await load(pages({ [url(path)]: fixture(file) }));
    const result = await client.getAnimeDetails({ url: path, title: 'x' });
    expect(requests.map((r) => r.url)).toEqual([url(path)]);
    return result;
  };

  it('reads a completed series', async () => {
    const anime = await details('/anime/heroine-seijo-iie-sub-indo/', 'detail_complete.txt');
    expect(anime).toMatchObject({
      url: '/anime/heroine-seijo-iie-sub-indo/',
      title: 'Heroine? Seijo? Iie, All Works Maid desu (Hokori)!',
      status: 'completed',
      type: 'tv',
      studio: 'EMT Squared',
      year: 2026,
    });
    expect(anime.genres).toEqual(['Fantasy', 'Isekai', 'Reincarnation']);
    expect(anime.altTitles).toHaveLength(1);
    expect(anime.description).toContain('Melody');
    expect(anime.description).toContain('\n\n');
    expect(anime.thumbnailUrl).toMatch(/^https:\/\/otakudesu\.blog\/wp-content\/uploads\//);
  });

  it('copes with an ongoing series that has no synopsis yet', async () => {
    const anime = await details('/anime/aoashi-s2-sub-indo/', 'detail_ongoing.txt');
    expect(anime).toMatchObject({
      title: 'Ao Ashi Season 2',
      status: 'ongoing',
      year: 2026,
      studio: 'TMS Entertainment',
    });
    expect(anime.description).toBeUndefined();
    expect(anime.genres).toEqual(['Seinen', 'Sports']);
  });

  it('maps Drop to cancelled', async () => {
    expect((await details('/anime/borot-sub-indo/', 'detail_drop.txt')).status).toBe('cancelled');
  });

  it('maps types, and trusts the title over a "TV" that is really an OVA', async () => {
    expect((await details('/anime/m/', 'detail_movie.txt')).type).toBe('movie');
    const ova = await details('/anime/ova/', 'detail_ova.txt');
    expect(ova.title).toContain('OVA');
    expect(ova.type).toBe('ova');
  });

  it('says "not found" when the site sends a missing slug to another domain', async () => {
    const { client } = await load(redirectToOtherDomain);
    await expect(client.getAnimeDetails({ url: '/anime/nope/', title: 'x' })).rejects.toThrow(/not on the site/);
    const unfollowed = await load(() => ({
      status: 302,
      url: url('/anime/nope/'),
      headers: { location: 'https://otakudesu.io/' },
    }));
    await expect(unfollowed.client.getAnimeDetails({ url: '/anime/nope/', title: 'x' })).rejects.toMatchObject({
      typed: 'NotFoundError',
    });
  });

  it('maps HTTP errors and Cloudflare challenges to their typed errors', async () => {
    const missing = await load(() => ({ status: 404 }));
    await expect(missing.client.getAnimeDetails({ url: '/anime/x/', title: 'x' })).rejects.toMatchObject({
      typed: 'NotFoundError',
    });
    const limited = await load(() => ({ status: 429 }));
    await expect(limited.client.getAnimeDetails({ url: '/anime/x/', title: 'x' })).rejects.toMatchObject({
      typed: 'RateLimitedError',
    });
    const challenge = await load(() => ({ status: 403, text: '<title>Just a moment...</title>' }));
    await expect(challenge.client.getAnimeDetails({ url: '/anime/x/', title: 'x' })).rejects.toMatchObject({
      typed: 'CloudflareError',
    });
    const broken = await load(() => ({ status: 503, text: 'down' }));
    await expect(broken.client.getAnimeDetails({ url: '/anime/x/', title: 'x' })).rejects.toMatchObject({
      typed: 'HttpError',
    });
  });

  it('reports a page without the title block', async () => {
    const { client } = await load(pages({ [url('/anime/x/')]: '<html><body>maintenance</body></html>' }));
    await expect(client.getAnimeDetails({ url: '/anime/x/', title: 'x' })).rejects.toThrow(/layout changed/);
  });
});

describe('getEpisodes', () => {
  const episodes = async (file: string) => {
    const { client } = await load(pages({ [url('/anime/x/')]: fixture(file) }));
    return client.getEpisodes({ url: '/anime/x/', title: 'x' });
  };

  it('lists a finished series newest first with paths, numbers and dates', async () => {
    const list = await episodes('detail_complete.txt');
    expect(list).toHaveLength(12);
    expect(list[0]).toEqual({
      url: '/episode/hsiawmdh-episode-12-sub-indo/',
      name: 'Episode 12 (End)',
      number: 12,
      uploadedAt: Date.UTC(2026, 8, 19, 17),
    });
    expect(list.map((e) => e.number)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });

  it('takes the batch and "lengkap" links out of the list', async () => {
    const list = await episodes('detail_complete.txt');
    expect(list.every((e) => e.url.startsWith('/episode/'))).toBe(true);
  });

  it('handles a very long series', async () => {
    const list = await episodes('detail_drop.txt');
    expect(list).toHaveLength(293);
    expect(list[0]?.number).toBe(293);
    expect(list.at(-1)?.number).toBe(1);
    expect(new Set(list.map((e) => e.url)).size).toBe(293);
  });

  it('keeps Episode 0 and Specials apart from the regular numbering', async () => {
    const list = await episodes('detail_special2.txt');
    expect(list).toHaveLength(19);
    const specials = list.filter((e) => e.variant === 'Special');
    expect(specials.map((e) => e.name)).toEqual([
      'Special 6',
      'Special 5',
      'Special 4',
      'Special 3',
      'Special 2',
      'Special 1',
    ]);
    expect(specials.every((e) => e.number === undefined)).toBe(true);
    const numbers = list.filter((e) => e.number !== undefined).map((e) => e.number);
    expect(numbers).toContain(0);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('does not let "Special Episode 1" collide with Episode 1', async () => {
    const list = await episodes('detail_special1.txt');
    expect(list[0]).toMatchObject({ variant: 'Special', name: 'Special Episode 1' });
    expect(list[0]?.number).toBeUndefined();
    expect(list.filter((e) => e.number === 1)).toHaveLength(1);
  });

  it('names an unnumbered special by what it is', async () => {
    const list = await episodes('detail_special3.txt');
    expect(list[0]).toMatchObject({ variant: 'Special', name: 'Special' });
    expect(list).toHaveLength(25);
  });

  it('gives a lone BD film number 1 and the BD variant', async () => {
    const list = await episodes('detail_movie.txt');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ number: 1, variant: 'BD', name: 'BD' });
  });

  it('lists a series that has only started', async () => {
    const list = await episodes('detail_ongoing.txt');
    expect(list.map((e) => [e.name, e.number])).toEqual([['Episode 1', 1]]);
  });
});

describe('urls', () => {
  it('maps pasted links and builds web links', async () => {
    const { client } = await load(pages({}));
    expect(await client.resolveUrl('https://otakudesu.blog/anime/aoashi-s2-sub-indo/?x=1')).toEqual({
      url: '/anime/aoashi-s2-sub-indo/',
      title: 'aoashi s2 sub indo',
    });
    expect(await client.resolveUrl('https://otakudesu.blog/episode/aoashi-s2-episode-1-sub-indo/')).toBeNull();
    expect(await client.resolveUrl('https://example.com/anime/x/')).toBeNull();
    expect(await client.getWebUrl({ url: '/anime/x/', title: 'x' })).toBe('https://otakudesu.blog/anime/x/');
  });
});
