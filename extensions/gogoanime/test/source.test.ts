import { afterEach, describe, expect, it } from 'vitest';
import { BASE, disposeAll, fixture, load, type Route } from './harness';

afterEach(disposeAll);

const SBR = { url: '/series/steel-ball-run-jojo-no-kimyou-na-bouken/', title: 'Steel Ball Run' };

const site: Route = (r) => {
  const u = r.url;
  const name = u.includes('s=steel')
    ? 'search.html.txt'
    : u.includes('order=popular')
      ? 'series_popular.html.txt'
      : u.includes('/series/steel-ball-run')
        ? 'detail_sbr.html.txt'
        : u.includes('/series/one-piece-english-dubbed')
          ? 'detail_dub.html.txt'
          : u.includes('/series/')
            ? 'series_update.html.txt'
            : undefined;
  return name ? { status: 200, text: fixture(name) } : undefined;
};

describe('listings', () => {
  it('popular is /series/ by popularity, anime only, with full covers and a next page', async () => {
    const { client, requests } = await load(site);
    const result = await client.getPopular(1);
    expect(requests[0]?.url).toBe(`${BASE}/series/?order=popular&type=anime`);
    expect(result.items).toHaveLength(20);
    expect(result.items[0]).toEqual({
      url: '/series/one-piece-english-dubbed-online/',
      title: 'One Piece English Dubbed',
      thumbnailUrl: 'https://i2.wp.com/gogoanime.by/wp-content/uploads/2024/03/One-Piece-2.jpg',
    });
    expect(result.hasNextPage).toBe(true);
  });

  it('latest is ordered by update and pages with ?page', async () => {
    const { client, requests } = await load(site);
    await client.getLatest(3);
    expect(requests[0]?.url).toBe(`${BASE}/series/?order=update&type=anime&page=3`);
  });

  it('searches by text and ignores the filters then', async () => {
    const { client, requests } = await load(site);
    const result = await client.search('steel ball run', 2, { genre: 'action' });
    expect(requests[0]?.url).toBe(`${BASE}/page/2/?s=steel+ball+run`);
    expect(result.items.map((i) => i.url)).toEqual(['/series/steel-ball-run-jojo-no-kimyou-na-bouken/']);
  });

  it('leaves the dramas out of a search', async () => {
    const card = (type: string, slug: string) =>
      `<article class="bs"><div class="bsx"><a href="https://gogoanime.by/series/${slug}/" itemprop="url" title="${slug}"><div class="limit"><div class="typez ${type}">${type}</div></div><div class="tt">${slug}<h2 itemprop="headline">${slug}</h2></div></a></div></article>`;
    const { client } = await load(() => ({
      status: 200,
      text: `<div class="listupd">${card('Drama', 'a')}${card('Anime', 'b')}${card('Movie', 'c')}</div>`,
    }));
    expect((await client.search('x', 1, {})).items.map((i) => i.url)).toEqual(['/series/b/', '/series/c/']);
  });

  it('builds filter urls (anime by default) and drops unknown values', async () => {
    const { client, requests } = await load(site);
    await client.search('', 2, { genre: 'action', status: 'ongoing', type: 'movie', order: 'popular' });
    await client.search('', 1, { genre: '../x', status: 'bogus', type: 'drama' });
    const first = new URL(requests[0]?.url ?? '');
    expect(first.searchParams.getAll('genre[]')).toEqual(['action']);
    expect(first.searchParams.get('status')).toBe('ongoing');
    expect(first.searchParams.get('type')).toBe('movie');
    expect(first.searchParams.get('page')).toBe('2');
    expect(requests[1]?.url).toBe(`${BASE}/series/?type=anime&order=update`);
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

  it('exposes the filters', async () => {
    const { client } = await load(() => undefined);
    const filters = await client.getFilters();
    const genre = filters.find((f) => f.type === 'select' && f.id === 'genre');
    expect(genre?.type === 'select' && genre.options.length).toBe(34);
    const type = filters.find((f) => f.type === 'select' && f.id === 'type');
    expect(type?.type === 'select' && type.default).toBe('anime');
  });
});

describe('details and episodes', () => {
  it('reads the details', async () => {
    const { client } = await load(site);
    const d = await client.getAnimeDetails(SBR);
    expect(d).toMatchObject({
      title: 'Steel Ball Run: JoJo no Kimyou na Bouken',
      status: 'ongoing',
      type: 'tv',
      year: 2026,
      studio: 'David Production',
      genres: ['Action', 'Adventure', 'Mystery', 'Supernatural'],
      altTitles: ['Steel Ball Run: JoJo’s Bizarre Adventure'],
      thumbnailUrl:
        'https://i2.wp.com/gogoanime.by/wp-content/uploads/2026/03/steel-ball-run-jojo-no-kimyou-na-bouken.webp',
    });
    expect(d.description).toContain('American Old West');
  });

  it('lists the episodes newest first, marked Sub', async () => {
    const { client } = await load(site);
    const episodes = await client.getEpisodes(SBR);
    expect(episodes.map((e) => [e.number, e.variant])).toEqual([
      [4, 'Sub'],
      [3, 'Sub'],
      [2, 'Sub'],
      [1, 'Sub'],
    ]);
    expect(episodes[0]?.url).toBe('/steel-ball-run-jojo-no-kimyou-na-bouken-episode-4-english-subbed/');
  });

  it('a dub series has its own episodes, marked Dub', async () => {
    const { client } = await load(site);
    const episodes = await client.getEpisodes({ url: '/series/one-piece-english-dubbed-online/', title: 'One Piece' });
    expect(episodes).toHaveLength(1123);
    expect(episodes[0]).toMatchObject({ number: 1123, variant: 'Dub', url: '/one-piece-episode-1123-english-dubbed/' });
    expect(new Set(episodes.map((e) => e.url)).size).toBe(episodes.length);
  });

  it('a series that does not exist (redirected to the home page) is NotFoundError', async () => {
    const { client } = await load(() => ({ status: 200, url: `${BASE}/`, text: '<html><body>home</body></html>' }));
    await expect(client.getAnimeDetails({ url: '/series/gone/', title: 'x' })).rejects.toMatchObject({
      typed: 'NotFoundError',
    });
    await expect(client.getEpisodes({ url: '/series/gone/', title: 'x' })).rejects.toMatchObject({
      typed: 'NotFoundError',
    });
  });

  it('a missing series (404) is NotFoundError and a foreign page a ParseError', async () => {
    const { client } = await load((r) =>
      r.url.includes('/gone/') ? { status: 404 } : { status: 200, text: '<html></html>' },
    );
    await expect(client.getAnimeDetails({ url: '/series/gone/', title: 'x' })).rejects.toMatchObject({
      typed: 'NotFoundError',
    });
    await expect(client.getEpisodes(SBR)).rejects.toMatchObject({ typed: 'ParseError' });
  });

  it('resolves site links and web urls', async () => {
    const { client } = await load(() => undefined);
    expect(await client.resolveUrl('https://gogoanime.by/series/one-piece/')).toEqual({
      url: '/series/one-piece/',
      title: 'one piece',
    });
    expect(await client.resolveUrl('https://example.com/series/x/')).toBeNull();
    expect(await client.getWebUrl(SBR)).toBe(`${BASE}/series/steel-ball-run-jojo-no-kimyou-na-bouken/`);
  });
});

describe('requests', () => {
  it('reads the page of a series once for its details and its episodes', async () => {
    const { client, requests } = await load(site);
    const [details, episodes] = await Promise.all([client.getAnimeDetails(SBR), client.getEpisodes(SBR)]);
    expect(requests).toHaveLength(1);
    expect(details.title).toBeTruthy();
    expect(episodes.length).toBeGreaterThan(0);
  });
});
