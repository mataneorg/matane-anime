import { afterEach, describe, expect, it } from 'vitest';
import { BASE, disposeAll, fixture, load, type Route } from './harness';

afterEach(disposeAll);

const DANDADAN = { url: '/dandadan-sub-indo/', title: 'Dandadan' };

const site: Route = (r) => {
  const u = r.url;
  const name = u.includes('q=one')
    ? 'search.html.txt'
    : u.includes('sort=updated')
      ? 'updated.html.txt'
      : u.includes('genre=')
        ? 'filtered.html.txt'
        : u.includes('/dandadan-sub-indo/')
          ? 'detail_dandadan.html.txt'
          : u.startsWith(`${BASE}/anime/`)
            ? 'catalogue.html.txt'
            : undefined;
  return name ? { status: 200, text: fixture(name) } : undefined;
};

describe('catalogue', () => {
  it('popular is the default order, 24 cards with plain poster files and a next page', async () => {
    const { client, requests } = await load(site);
    const result = await client.getPopular(1);
    expect(requests[0]?.url).toBe(`${BASE}/anime/`);
    expect(result.items).toHaveLength(24);
    expect(result.items[0]).toEqual({
      url: '/snk-s1-sub-indo/',
      title: 'Shingeki no Kyojin',
      thumbnailUrl: 'https://nimegami.id/assets/anime-data/images/posters/e913e2953c554278a6060980.jpg',
    });
    expect(result.hasNextPage).toBe(true);
  });

  it('latest is ordered by update and pages with ?page', async () => {
    const { client, requests } = await load(site);
    const result = await client.getLatest(2);
    expect(requests[0]?.url).toBe(`${BASE}/anime/?sort=updated&page=2`);
    expect(result.items.length).toBeGreaterThan(0);
  });

  it('searches by text and passes the filters along (the catalogue supports both)', async () => {
    const { client, requests } = await load(site);
    const result = await client.search('one piece', 1, {});
    expect(requests[0]?.url).toBe(`${BASE}/anime/?q=one+piece`);
    expect(result.items[0]).toMatchObject({ url: '/one-piece-sub-indo/', title: 'ONE PIECE' });
    await client.search('', 3, { genre: 'Action', status: 'RELEASING', format: 'MOVIE', year: '2020', sort: 'rating' });
    const url = new URL(requests[1]?.url ?? '');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      genre: 'Action',
      status: 'RELEASING',
      format: 'MOVIE',
      year: '2020',
      sort: 'rating',
      page: '3',
    });
  });

  it('drops unknown filter values', async () => {
    const { client, requests } = await load(site);
    await client.search('', 1, { genre: '../x', status: 'ONGOING', format: 'movie', year: '1', sort: 'nope' });
    expect(requests[0]?.url).toBe(`${BASE}/anime/`);
  });

  it('a page past the end (404) is empty, a first-page 404 is an error', async () => {
    const { client } = await load((r) => ({ status: 404, url: r.url }));
    expect(await client.getPopular(9)).toEqual({ items: [], hasNextPage: false });
    await expect(client.getPopular(1)).rejects.toMatchObject({ typed: 'NotFoundError' });
  });

  it('reports a Cloudflare challenge and a foreign page', async () => {
    const challenge = await load((r) => ({ status: 403, url: r.url, text: 'Just a moment...' }));
    await expect(challenge.client.getPopular(1)).rejects.toMatchObject({ typed: 'CloudflareError' });
    const foreign = await load(() => ({ status: 200, text: '<html><body>hi</body></html>' }));
    await expect(foreign.client.getPopular(1)).rejects.toMatchObject({ typed: 'ParseError' });
  });

  it('exposes the filters without the explicit genres', async () => {
    const { client } = await load(() => undefined);
    const genre = (await client.getFilters()).find((f) => f.type === 'select' && f.id === 'genre');
    const values = genre?.type === 'select' ? genre.options.map((o) => o.value) : [];
    expect(values).toContain('Action');
    expect(values).not.toContain('Hentai');
    expect(values).not.toContain('Erotica');
    expect(values).toHaveLength(56);
  });
});

describe('details and episodes', () => {
  it('reads the details', async () => {
    const { client } = await load(site);
    const d = await client.getAnimeDetails(DANDADAN);
    expect(d).toMatchObject({
      title: 'Dandadan',
      status: 'completed',
      type: 'tv',
      year: 2024,
      studio: 'Science SARU',
      genres: ['Action', 'Comedy', 'Drama', 'Romance', 'Sci-Fi', 'Supernatural'],
      thumbnailUrl: 'https://nimegami.id/assets/anime-data/images/posters/78e7fb9a6b34b038c862d327.jpg',
    });
    expect(d.altTitles).toContain('DAN DA DAN');
    expect(d.description).toContain('Momo');
  });

  it("builds the episode list from the page's episode grid, newest first, with one request", async () => {
    const { client, requests } = await load(site);
    const episodes = await client.getEpisodes(DANDADAN);
    expect(requests).toHaveLength(1);
    expect(episodes).toHaveLength(12);
    expect(episodes[0]).toEqual({ url: '/dandadan-sub-indo/#episode-12', name: 'Episode 12', number: 12 });
    expect(episodes.at(-1)?.number).toBe(1);
    expect(new Set(episodes.map((e) => e.url)).size).toBe(12);
  });

  it('a series without episodes is NotFoundError', async () => {
    const { client } = await load(() => ({ status: 200, text: '<h1>X</h1><div class="episode-grid"></div>' }));
    await expect(client.getEpisodes(DANDADAN)).rejects.toMatchObject({ typed: 'NotFoundError' });
  });

  it('a missing series is NotFoundError and a foreign page a ParseError', async () => {
    const { client } = await load((r) =>
      r.url.includes('/gone-') ? { status: 404 } : { status: 200, text: '<html></html>' },
    );
    await expect(client.getAnimeDetails({ url: '/gone-sub-indo/', title: 'x' })).rejects.toMatchObject({
      typed: 'NotFoundError',
    });
    await expect(client.getEpisodes(DANDADAN)).rejects.toMatchObject({ typed: 'ParseError' });
  });

  it('resolves site links and web urls (without the episode fragment)', async () => {
    const { client } = await load(() => undefined);
    expect(await client.resolveUrl('https://nimegami.com/one-piece-sub-indo/')).toEqual({
      url: '/one-piece-sub-indo/',
      title: 'one piece',
    });
    expect(await client.resolveUrl('https://nimegami.id/anime/')).toBeNull();
    expect(await client.resolveUrl('https://example.com/x-sub-indo/')).toBeNull();
    expect(await client.getWebUrl({ url: '/dandadan-sub-indo/#episode-3', name: 'x' })).toBe(
      `${BASE}/dandadan-sub-indo/`,
    );
  });
});
