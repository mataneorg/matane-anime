import { afterEach, describe, expect, it } from 'vitest';
import { BASE, disposeAll, fixture, load } from './harness';

afterEach(disposeAll);

const page = (name: string) => ({ status: 200, text: fixture(name) });
const SAKAMOTO = { url: '/sakamoto-days', title: 'Sakamoto Days' };

describe('home rows', () => {
  it('latest page 1 is "Episode Terbaru" as one card per series', async () => {
    const { client, requests } = await load((r) => (r.url === `${BASE}/` ? page('home.html.txt') : undefined));
    const result = await client.getLatest(1);
    expect(requests.map((r) => r.url)).toEqual([`${BASE}/`]);
    // 24 episode cards from 13 series: one card per series.
    expect(result.items).toHaveLength(13);
    expect(result.items[0]).toEqual({
      url: '/tokyo-revengers-santen-sensou-hen',
      title: 'Tokyo Revengers Santen Sensou Hen',
      thumbnailUrl: 'https://gomunime.top/storage/posters/tokyo-revengers-santen-sensou-hen-poster.jpg',
    });
    expect(result.hasNextPage).toBe(true);
  });

  it('latest page 2 continues with the ongoing list', async () => {
    const { client, requests } = await load((r) =>
      r.url.includes('/status/ongoing') ? page('list_ongoing.html.txt') : undefined,
    );
    const result = await client.getLatest(2);
    expect(requests[0]?.url).toBe(`${BASE}/status/ongoing`);
    expect(result.items.length).toBeGreaterThan(20);
    await client.getLatest(4);
    expect(requests[1]?.url).toBe(`${BASE}/status/ongoing?page=3`);
  });

  it('popular page 1 is the trending row of series', async () => {
    const { client } = await load((r) => (r.url === `${BASE}/` ? page('home.html.txt') : undefined));
    const result = await client.getPopular(1);
    expect(result.items).toHaveLength(12);
    expect(result.items[0]).toMatchObject({ url: '/one-piece', title: 'One Piece' });
    expect(result.items.every((i) => i.thumbnailUrl?.startsWith('https://'))).toBe(true);
  });

  it('popular page 2+ follows the top MAL scores, with a next page', async () => {
    const { client, requests } = await load((r) =>
      r.url.includes('/koleksi/') ? page('list_koleksi.html.txt') : undefined,
    );
    const result = await client.getPopular(2);
    expect(requests[0]?.url).toBe(`${BASE}/koleksi/anime-skor-mal-tertinggi?page=2`);
    expect(result.items).toHaveLength(24);
    expect(result.hasNextPage).toBe(true);
  });

  it('maps an episode card without "-episode-" in its path to its series', async () => {
    const card = `<a href="https://gomunime.top/sentai-daishikkaku-2nd-season-4" class="card-netflix"><img src="/p.jpg"><span class="badge-sub">Episode 4</span><p class="uppercase">Sentai Daishikkaku 2nd Season</p><h3>Sentai Daishikkaku 2nd Season Episode 4</h3></a>`;
    const { client } = await load(() => ({
      status: 200,
      text: `<html><body><section><h2 class="section-title">Episode Terbaru</h2>${card}</section></body></html>`,
    }));
    expect((await client.getLatest(1)).items).toEqual([
      {
        url: '/sentai-daishikkaku-2nd-season',
        title: 'Sentai Daishikkaku 2nd Season',
        thumbnailUrl: 'https://gomunime.top/p.jpg',
      },
    ]);
  });

  it('a home page without the row is a ParseError', async () => {
    const { client } = await load(() => ({
      status: 200,
      text: '<html><body><section><h2 class="section-title">Other</h2></section></body></html>',
    }));
    await expect(client.getLatest(1)).rejects.toMatchObject({ typed: 'ParseError' });
  });
});

describe('lists and search', () => {
  it('reads an ongoing page with its pager', async () => {
    const { client } = await load(() => page('list_ongoing.html.txt'));
    const result = await client.search('', 1, { status: 'ongoing' });
    expect(result.items).toHaveLength(24);
    expect(result.hasNextPage).toBe(true);
  });

  it('searches by text, one page only', async () => {
    const { client, requests } = await load((r) => (r.url.includes('/search') ? page('search.html.txt') : undefined));
    const result = await client.search('one piece', 1, { genre: 'action' });
    expect(requests[0]?.url).toBe(`${BASE}/search?q=one+piece`);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0]?.url).toMatch(/^\/[a-z0-9-]+$/);
    expect(await client.search('one piece', 2, {})).toEqual({ items: [], hasNextPage: false });
    expect(requests).toHaveLength(1);
  });

  it('builds filter urls: genre, then status, then type; unknown values are dropped', async () => {
    const { client, requests } = await load(() => page('list_ongoing.html.txt'));
    await client.search('', 3, { genre: 'action', status: 'completed' });
    await client.search('', 1, { status: 'completed', type: 'movie' });
    await client.search('', 1, { type: 'movie' });
    await client.search('', 1, { genre: '../x', status: 'bogus' });
    expect(requests.map((r) => r.url)).toEqual([
      `${BASE}/genre/action?page=3`,
      `${BASE}/status/completed`,
      `${BASE}/type/movie`,
      `${BASE}/status/ongoing`,
    ]);
  });

  it('a page past the end (404) is empty, a first-page 404 is an error', async () => {
    const { client } = await load((r) => ({ status: 404, url: r.url }));
    expect(await client.search('', 9, { status: 'ongoing' })).toEqual({ items: [], hasNextPage: false });
    await expect(client.search('', 1, { status: 'ongoing' })).rejects.toMatchObject({ typed: 'NotFoundError' });
  });

  it('reports a Cloudflare challenge', async () => {
    const { client } = await load((r) => ({ status: 403, url: r.url, text: 'Just a moment...' }));
    await expect(client.search('x', 1, {})).rejects.toMatchObject({ typed: 'CloudflareError' });
  });

  it('exposes the filters', async () => {
    const { client } = await load(() => undefined);
    const filters = await client.getFilters();
    const genre = filters.find((f) => f.type === 'select' && f.id === 'genre');
    expect(genre?.type === 'select' && genre.options.length).toBe(43);
  });
});

describe('details and episodes', () => {
  const route = (r: { url: string }) =>
    r.url === `${BASE}/sakamoto-days` ? page('detail_sakamoto.html.txt') : undefined;

  it('reads the details', async () => {
    const { client } = await load(route);
    const d = await client.getAnimeDetails(SAKAMOTO);
    expect(d).toMatchObject({
      title: 'Sakamoto Days',
      status: 'ongoing',
      type: 'tv',
      year: 2025,
      studio: 'TMS Entertainment',
      genres: ['Comedy', 'Action', 'Shounen', 'Adult Cast', 'Organized Crime'],
    });
    expect(d.altTitles).toBeUndefined(); // the only alternative is the title in capitals
    expect(d.description).toContain('hitman');
    expect(d.thumbnailUrl).toBe('https://gomunime.top/storage/posters/sakamoto-days-subtitle-indonesia-poster.jpg?v=2');
  });

  it('lists every episode, newest first, with dates', async () => {
    const { client } = await load(route);
    const episodes = await client.getEpisodes(SAKAMOTO);
    expect(episodes).toHaveLength(11);
    expect(episodes[0]).toMatchObject({ url: '/sakamoto-days-episode-11', number: 11, name: 'Episode 11' });
    expect(episodes[10]).toMatchObject({
      url: '/sakamoto-days-episode-1',
      number: 1,
      uploadedAt: Date.UTC(2025, 0, 19),
    });
    const numbers = episodes.map((e) => e.number ?? 0);
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
  });

  it('a missing anime is NotFoundError and a foreign page a ParseError', async () => {
    const { client } = await load((r) =>
      r.url.endsWith('/gone') ? { status: 404 } : { status: 200, text: '<html></html>' },
    );
    await expect(client.getAnimeDetails({ url: '/gone', title: 'x' })).rejects.toMatchObject({
      typed: 'NotFoundError',
    });
    await expect(client.getEpisodes(SAKAMOTO)).rejects.toMatchObject({ typed: 'ParseError' });
  });

  it('resolves site links and web urls', async () => {
    const { client } = await load(() => undefined);
    expect(await client.resolveUrl('https://gomunime.top/one-piece')).toEqual({
      url: '/one-piece',
      title: 'one piece',
    });
    expect(await client.resolveUrl('https://gomunime.top/one-piece-episode-12/')).toEqual({
      url: '/one-piece',
      title: 'one piece',
    });
    expect(await client.resolveUrl('https://gomunime.top/genre/action')).toBeNull();
    expect(await client.resolveUrl('https://example.com/one-piece')).toBeNull();
    expect(await client.getWebUrl(SAKAMOTO)).toBe(`${BASE}/sakamoto-days`);
  });
});
