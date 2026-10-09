import { afterEach, describe, expect, it } from 'vitest';
import { BASE, disposeAll, fixture, load } from './harness';

afterEach(disposeAll);

const page = (name: string) => ({ status: 200, text: fixture(name) });
const SAKAMOTO = { url: '/anime/sakamoto-days/', title: 'Sakamoto Days' };

describe('listings', () => {
  it('latest is the home page: one card per series, covers from data-original', async () => {
    const { client, requests } = await load((r) => (r.url === `${BASE}/` ? page('home.html.txt') : undefined));
    const result = await client.getLatest(1);
    expect(requests.map((r) => r.url)).toEqual([`${BASE}/`]);
    expect(result.items).toHaveLength(16);
    expect(result.items[0]).toEqual({
      url: '/anime/steel-ball-run-jojo-no-kimyou-na-bouken/',
      title: 'Steel Ball Run: JoJo no Kimyou na Bouken',
      thumbnailUrl: 'https://anime-indo.lol/img/Steel-Ball-Run-JoJo-no-Kimyou-na-Bouken.jpg',
    });
    expect(result.hasNextPage).toBe(true);
  });

  it('latest page 2 is /page/2/ and a page past the end (404) is empty', async () => {
    const { client, requests } = await load((r) =>
      r.url.endsWith('/page/2/') ? page('page2.html.txt') : { status: 404 },
    );
    expect((await client.getLatest(2)).items).toHaveLength(16);
    expect(requests[0]?.url).toBe(`${BASE}/page/2/`);
    expect(await client.getLatest(99)).toEqual({ items: [], hasNextPage: false });
  });

  it('popular is the sidebar box of 7, with no second page', async () => {
    const { client, requests } = await load((r) => (r.url === `${BASE}/` ? page('home.html.txt') : undefined));
    const result = await client.getPopular(1);
    expect(result.items).toHaveLength(7);
    expect(result.items[0]).toEqual({
      url: '/anime/boruto-naruto-next-generations/',
      title: 'Boruto',
      thumbnailUrl: 'https://anime-indo.lol/img/84460l.jpg',
    });
    expect(result.hasNextPage).toBe(false);
    expect(await client.getPopular(2)).toEqual({ items: [], hasNextPage: false });
    expect(requests).toHaveLength(1);
  });

  it('reads movies with their pager, and genres under /genres/<slug>/page/N/', async () => {
    const { client, requests } = await load((r) =>
      r.url.includes('/genres/') ? page('genre.html.txt') : page('movie.html.txt'),
    );
    const movies = await client.search('', 1, { type: 'movie' });
    expect(movies.items.length).toBeGreaterThan(10);
    expect(movies.items[0]?.url).toMatch(/^\/anime\/[^/]+\/$/);
    expect(movies.items[0]?.thumbnailUrl).toMatch(/^https:\/\/anime-indo\.lol\/img\//);
    expect(movies.hasNextPage).toBe(true);
    await client.search('', 3, { genre: 'action', type: 'movie' });
    await client.search('', 1, { genre: '../x' });
    expect(requests.map((r) => r.url)).toEqual([`${BASE}/movie/`, `${BASE}/genres/action/page/3/`, `${BASE}/`]);
  });

  it('searches by text, one page only', async () => {
    const { client, requests } = await load((r) =>
      r.url.includes('/search.php') ? page('search.html.txt') : undefined,
    );
    const result = await client.search('one piece', 1, { genre: 'action' });
    expect(requests[0]?.url).toBe(`${BASE}/search.php?q=one%20piece`);
    expect(result.items.some((i) => i.url === '/anime/one-piece/')).toBe(true);
    expect(await client.search('one piece', 2, {})).toEqual({ items: [], hasNextPage: false });
    expect(requests).toHaveLength(1);
  });

  it('reports a Cloudflare challenge and a first-page 404', async () => {
    const challenge = await load((r) => ({ status: 403, url: r.url, text: 'Just a moment...' }));
    await expect(challenge.client.getLatest(1)).rejects.toMatchObject({ typed: 'CloudflareError' });
    const gone = await load((r) => ({ status: 404, url: r.url }));
    await expect(gone.client.getLatest(1)).rejects.toMatchObject({ typed: 'NotFoundError' });
  });

  it('a foreign page is a ParseError', async () => {
    const { client } = await load(() => ({ status: 200, text: '<html><body>hi</body></html>' }));
    await expect(client.getLatest(1)).rejects.toMatchObject({ typed: 'ParseError' });
    await expect(client.getPopular(1)).rejects.toMatchObject({ typed: 'ParseError' });
  });

  it('exposes the filters without the site typos', async () => {
    const { client } = await load(() => undefined);
    const genre = (await client.getFilters()).find((f) => f.type === 'select' && f.id === 'genre');
    const values = genre?.type === 'select' ? genre.options.map((o) => o.value) : [];
    expect(values).toContain('action');
    expect(values).not.toContain('adventrue');
    expect(values.length).toBe(91);
  });
});

describe('details and episodes', () => {
  const route = (r: { url: string }) =>
    r.url === `${BASE}/anime/sakamoto-days/` ? page('detail_sakamoto.html.txt') : undefined;

  it('reads the details (no status or year on this site)', async () => {
    const { client } = await load(route);
    const d = await client.getAnimeDetails(SAKAMOTO);
    expect(d).toMatchObject({
      title: 'Sakamoto Days',
      status: 'unknown',
      genres: ['Action', 'Adult Cast', 'Comedy', 'Organized Crime', 'Shounen'],
      thumbnailUrl: 'https://anime-indo.lol/img/Sakamoto-Days.jpg',
    });
    expect(d.description).toContain('Tarou Sakamoto');
    expect(d.year).toBeUndefined();
  });

  it('lists every episode, newest first, including the "000" of a long series', async () => {
    const { client } = await load((r) =>
      r.url.endsWith('/anime/one-piece/') ? page('detail_one_piece.html.txt') : undefined,
    );
    const episodes = await client.getEpisodes({ url: '/anime/one-piece/', title: 'One Piece' });
    expect(episodes.length).toBeGreaterThan(1100);
    expect(episodes[0]).toMatchObject({ number: 1180, name: 'Episode 1180', url: '/one-piece-episode-1180/' });
    expect(episodes.at(-1)).toMatchObject({ url: '/one-piece-episode-000/', number: 0 });
    const numbers = episodes.map((e) => e.number ?? 0);
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
    expect(new Set(episodes.map((e) => e.url)).size).toBe(episodes.length);
  });

  it('a missing anime is NotFoundError and a foreign page a ParseError', async () => {
    const { client } = await load((r) =>
      r.url.includes('/gone/') ? { status: 404 } : { status: 200, text: '<html></html>' },
    );
    await expect(client.getAnimeDetails({ url: '/anime/gone/', title: 'x' })).rejects.toMatchObject({
      typed: 'NotFoundError',
    });
    await expect(client.getEpisodes(SAKAMOTO)).rejects.toMatchObject({ typed: 'ParseError' });
  });

  it('the site answers a missing page with a 503 "Waktu habis" page: that is NotFoundError', async () => {
    const { client } = await load(() => ({
      status: 503,
      text: '<body>Waktu habis silahkan Refresh: <a>Klik disini</a></body>',
    }));
    await expect(client.getAnimeDetails({ url: '/anime/nope/', title: 'x' })).rejects.toMatchObject({
      typed: 'NotFoundError',
    });
    const empty = await load(() => ({ status: 503, text: '' }));
    await expect(empty.client.getAnimeDetails({ url: '/anime/nope/', title: 'x' })).rejects.toMatchObject({
      typed: 'NotFoundError',
    });
    const other = await load(() => ({ status: 503, text: 'Service Unavailable' }));
    await expect(other.client.getAnimeDetails({ url: '/anime/nope/', title: 'x' })).rejects.toMatchObject({
      typed: 'HttpError',
    });
  });

  it('resolves site links and web urls', async () => {
    const { client } = await load(() => undefined);
    expect(await client.resolveUrl('https://anime-indo.lol/anime/one-piece/')).toEqual({
      url: '/anime/one-piece/',
      title: 'one piece',
    });
    expect(await client.resolveUrl('https://anime-indo.lol/one-piece-episode-12/')).toEqual({
      url: '/anime/one-piece/',
      title: 'one piece',
    });
    expect(await client.resolveUrl('https://anime-indo.lol/movie/')).toBeNull();
    expect(await client.resolveUrl('https://example.com/anime/x/')).toBeNull();
    expect(await client.getWebUrl(SAKAMOTO)).toBe(`${BASE}/anime/sakamoto-days/`);
  });
});
