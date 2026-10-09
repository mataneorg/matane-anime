import { afterEach, describe, expect, it } from 'vitest';
import { BASE, disposeAll, fixture, load, type Route } from './harness';

afterEach(disposeAll);

const TOKYO = { url: '/anime/tokyo-revengers/', title: 'Tokyo Revengers' };

const site: Route = (r) => {
  const u = r.url;
  const name = u.includes('?s=')
    ? 'search.html.txt'
    : u.includes('/page/2/')
      ? 'page2.html.txt'
      : u.includes('/genres/')
        ? 'genre_action.html.txt'
        : u.includes('/movie-terbaru/')
          ? 'movies.html.txt'
          : u.includes('/anime/tokyo-revengers/')
            ? 'detail_tokyo.html.txt'
            : u === `${BASE}/`
              ? 'home.html.txt'
              : undefined;
  return name ? { status: 200, text: fixture(name) } : undefined;
};

describe('listings', () => {
  it('latest maps the anime episode cards to their series and drops the donghua', async () => {
    const { client, requests } = await load(site);
    const result = await client.getLatest(1);
    expect(requests[0]?.url).toBe(`${BASE}/`);
    // 24 cards on the home page, 12 of them anime.
    expect(result.items).toHaveLength(12);
    expect(result.items[0]).toEqual({
      url: '/anime/tokyo-revengers-santen-sensou-hen/',
      title: 'Tokyo Revengers: Santen Sensou-hen',
      thumbnailUrl: 'https://anisail.com/wp-content/uploads/2026/09/1790698429-159720l.jpg',
    });
    expect(result.items.some((i) => /douluo|ling wu/i.test(i.title))).toBe(false);
    expect(result.hasNextPage).toBe(true);
  });

  it('latest page 2 is /page/2/', async () => {
    const { client, requests } = await load(site);
    const result = await client.getLatest(2);
    expect(requests[0]?.url).toBe(`${BASE}/page/2/`);
    expect(result.items.length).toBeGreaterThan(5);
    expect(result.hasNextPage).toBe(true);
  });

  it('popular is the "Lagi Rame" widget, without paging', async () => {
    const { client, requests } = await load(site);
    const result = await client.getPopular(1);
    expect(result.items.map((i) => i.title).slice(0, 2)).toEqual(['One Piece', 'Detective Conan']);
    expect(result.items[0]?.url).toBe('/anime/one-piece/');
    expect(result.hasNextPage).toBe(false);
    expect(await client.getPopular(2)).toEqual({ items: [], hasNextPage: false });
    expect(requests).toHaveLength(1);
  });

  it('searches by text, one page only, and ignores the filters then', async () => {
    const { client, requests } = await load(site);
    const result = await client.search('one piece', 1, { genre: 'action' });
    expect(requests[0]?.url).toBe(`${BASE}/?s=one+piece`);
    expect(result.items).toHaveLength(13);
    expect(result.items[0]).toMatchObject({ url: '/anime/one-piece-heroines/', title: 'One Piece: Heroines' });
    expect(await client.search('one piece', 2, {})).toEqual({ items: [], hasNextPage: false });
    expect(requests).toHaveLength(1);
  });

  it('reads genre archives and the movie list, with paging', async () => {
    const { client, requests } = await load(site);
    const genre = await client.search('', 1, { genre: 'action', type: 'movie' });
    expect(genre.items).toHaveLength(48);
    expect(genre.hasNextPage).toBe(true);
    await client.search('', 3, { genre: 'action' });
    const movies = await client.search('', 1, { type: 'movie' });
    expect(movies.items).toHaveLength(20);
    await client.search('', 1, { genre: '../x' });
    expect(requests.map((r) => r.url)).toEqual([
      `${BASE}/genres/action/`,
      `${BASE}/genres/action/page/3/`,
      `${BASE}/movie-terbaru/`,
      `${BASE}/`,
    ]);
  });

  it('a page past the end (404) is empty, a first-page 404 is an error', async () => {
    const { client } = await load((r) => ({ status: 404, url: r.url }));
    expect(await client.getLatest(9)).toEqual({ items: [], hasNextPage: false });
    await expect(client.getLatest(1)).rejects.toMatchObject({ typed: 'NotFoundError' });
  });

  it('reports a Cloudflare challenge and a foreign page', async () => {
    const challenge = await load((r) => ({ status: 403, url: r.url, text: 'Just a moment...' }));
    await expect(challenge.client.getLatest(1)).rejects.toMatchObject({ typed: 'CloudflareError' });
    const foreign = await load(() => ({ status: 200, text: '<html><body>hi</body></html>' }));
    await expect(foreign.client.getLatest(1)).rejects.toMatchObject({ typed: 'ParseError' });
    await expect(foreign.client.getPopular(1)).rejects.toMatchObject({ typed: 'ParseError' });
  });

  it('exposes the filters without the explicit genres', async () => {
    const { client } = await load(() => undefined);
    const genre = (await client.getFilters()).find((f) => f.type === 'select' && f.id === 'genre');
    const slugs = genre?.type === 'select' ? genre.options.map((o) => o.value) : [];
    expect(slugs).toContain('action');
    for (const adult of ['hentai', 'erotica', 'donghua', 'live-action']) expect(slugs).not.toContain(adult);
    expect(slugs).toHaveLength(65);
  });
});

describe('details and episodes', () => {
  it('reads the details from the info table', async () => {
    const { client } = await load(site);
    const d = await client.getAnimeDetails(TOKYO);
    expect(d).toMatchObject({
      title: 'Tokyo Revengers',
      status: 'completed',
      type: 'tv',
      year: 2021,
      studio: 'LIDENFILMS',
      genres: ['Action', 'Drama', 'School', 'Shounen', 'Supernatural'],
      altTitles: ['東京リベンジャーズ'],
      thumbnailUrl: 'https://anisail.com/wp-content/uploads/2021/04/1618107161-113949l.jpg',
    });
    expect(d.description).toContain('Takemichi');
  });

  it('lists the episodes newest first (the site has no dates)', async () => {
    const { client } = await load(site);
    const episodes = await client.getEpisodes(TOKYO);
    expect(episodes).toHaveLength(24);
    expect(episodes[0]).toEqual({ url: '/tokyo-revengers-episode-24/', name: 'Episode 24', number: 24 });
    const numbers = episodes.map((e) => e.number ?? 0);
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
  });

  it('a missing anime is NotFoundError and a foreign page a ParseError', async () => {
    const { client } = await load((r) =>
      r.url.endsWith('/gone/') ? { status: 404 } : { status: 200, text: '<html></html>' },
    );
    await expect(client.getAnimeDetails({ url: '/anime/gone/', title: 'x' })).rejects.toMatchObject({
      typed: 'NotFoundError',
    });
    await expect(client.getEpisodes(TOKYO)).rejects.toMatchObject({ typed: 'ParseError' });
  });

  it('resolves site links (also from the old name) and web urls', async () => {
    const { client } = await load(() => undefined);
    expect(await client.resolveUrl('https://anisail.com/anime/one-piece/')).toEqual({
      url: '/anime/one-piece/',
      title: 'one piece',
    });
    expect(await client.resolveUrl('https://animesail.com/one-piece-episode-12/')).toEqual({
      url: '/anime/one-piece/',
      title: 'one piece',
    });
    expect(await client.resolveUrl('https://anisail.com/genres/action/')).toBeNull();
    expect(await client.resolveUrl('https://example.com/anime/x/')).toBeNull();
    expect(await client.getWebUrl(TOKYO)).toBe(`${BASE}/anime/tokyo-revengers/`);
  });
});
