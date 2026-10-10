import { afterEach, describe, expect, it } from 'vitest';
import { BASE, disposeAll, fixture, load } from './harness';

afterEach(disposeAll);

const page = (name: string) => ({ status: 200, text: fixture(name) });
const OP = { url: '/anime/one-piece/', title: 'One Piece' };

describe('listings', () => {
  it('reads popular with covers and next page', async () => {
    const { client, requests } = await load((r) =>
      r.url.includes('order=popular') ? page('list_popular.html.txt') : undefined,
    );
    const result = await client.getPopular(1);
    expect(requests[0]?.url).toBe(`${BASE}/anime/?order=popular`);
    expect(result.items).toHaveLength(50);
    expect(result.items[0]).toEqual({
      url: '/anime/one-piece/',
      title: 'One Piece',
      thumbnailUrl: 'https://i2.wp.com/samehadaku.li/wp-content/uploads/2024/02/1708080612-8881-138851.jpg',
    });
    expect(result.hasNextPage).toBe(true);
  });

  it('latest is ordered by update and pages with ?page', async () => {
    const { client, requests } = await load((r) =>
      r.url.includes('order=update') ? page('list_popular.html.txt') : undefined,
    );
    await client.getLatest(3);
    expect(requests[0]?.url).toBe(`${BASE}/anime/?order=update&page=3`);
  });

  it('searches by text (cards with a real src) and ignores filters then', async () => {
    const { client, requests } = await load((r) => (r.url.includes('s=one') ? page('search.html.txt') : undefined));
    const result = await client.search('one piece', 2, { genre: 'action' });
    expect(requests[0]?.url).toBe(`${BASE}/page/2/?s=one+piece`);
    expect(result.items).toHaveLength(6);
    expect(result.items.every((i) => i.url.startsWith('/anime/') && i.thumbnailUrl?.startsWith('https://'))).toBe(true);
  });

  it('builds filter urls and drops unknown values', async () => {
    const { client, requests } = await load((r) =>
      r.url.includes('/anime/?') ? page('list_popular.html.txt') : undefined,
    );
    await client.search('', 2, { genre: 'action', status: 'ongoing', type: 'tv', order: 'popular' });
    await client.search('', 1, { genre: '../x', status: 'bogus' });
    const first = new URL(requests[0]?.url ?? '');
    expect(first.searchParams.getAll('genre[]')).toEqual(['action']);
    expect(first.searchParams.get('status')).toBe('ongoing');
    expect(first.searchParams.get('page')).toBe('2');
    expect(requests[1]?.url).toBe(`${BASE}/anime/?order=update`);
  });

  it('a page past the end (404) is empty, a first-page 404 is an error', async () => {
    const { client } = await load((r) => ({ status: 404, url: r.url }));
    expect(await client.getPopular(9)).toEqual({ items: [], hasNextPage: false });
    await expect(client.getPopular(1)).rejects.toMatchObject({ typed: 'NotFoundError' });
  });

  it('reports a Cloudflare challenge', async () => {
    const { client } = await load((r) => ({ status: 403, url: r.url, text: 'Just a moment...' }));
    await expect(client.getPopular(1)).rejects.toMatchObject({ typed: 'CloudflareError' });
  });

  it('exposes the filters', async () => {
    const { client } = await load(() => undefined);
    const filters = await client.getFilters();
    const genre = filters.find((f) => f.type === 'select' && f.id === 'genre');
    expect(genre?.type === 'select' && genre.options.length).toBe(76);
    const slugs = genre?.type === 'select' ? genre.options.map((o) => o.value) : [];
    expect(slugs).not.toContain('hentai');
    expect(slugs).not.toContain('erotica');
  });
});

describe('details and episodes', () => {
  it('reads the details', async () => {
    const { client } = await load((r) =>
      r.url === `${BASE}/anime/one-piece/` ? page('detail_one_piece.html.txt') : undefined,
    );
    const d = await client.getAnimeDetails(OP);
    expect(d).toMatchObject({
      title: 'One Piece',
      status: 'ongoing',
      type: 'tv',
      year: 1999,
      studio: 'Toei Animation',
      genres: ['Action', 'Adventure', 'Fantasy', 'Shounen'],
    });
    expect(d.altTitles).toEqual(['OP']);
    expect(d.description).toContain('Luffy');
    expect(d.thumbnailUrl).toMatch(/^https:\/\/i\d\.wp\.com\/.*\.jpg$/);
  });

  it('lists every episode, newest first', async () => {
    const { client } = await load((r) =>
      r.url === `${BASE}/anime/one-piece/` ? page('detail_one_piece.html.txt') : undefined,
    );
    const episodes = await client.getEpisodes(OP);
    expect(episodes.length).toBeGreaterThan(90);
    expect(episodes[0]).toMatchObject({
      url: '/one-piece-episode-1180-subtitle-indonesia/',
      number: 1180,
      name: 'Episode 1180',
    });
    expect(episodes[0]?.uploadedAt).toBeGreaterThan(0);
    const numbers = episodes.map((e) => e.number ?? 0);
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
    expect(new Set(episodes.map((e) => e.url)).size).toBe(episodes.length);
  });

  it('a missing anime is NotFoundError and a foreign page a ParseError', async () => {
    const { client } = await load((r) =>
      r.url.endsWith('/gone/') ? { status: 404 } : { status: 200, text: '<html></html>' },
    );
    await expect(client.getAnimeDetails({ url: '/anime/gone/', title: 'x' })).rejects.toMatchObject({
      typed: 'NotFoundError',
    });
    await expect(client.getEpisodes(OP)).rejects.toMatchObject({ typed: 'ParseError' });
  });

  it('resolves site links and web urls', async () => {
    const { client } = await load(() => undefined);
    expect(await client.resolveUrl('https://samehadaku.care/anime/one-piece/')).toEqual({
      url: '/anime/one-piece/',
      title: 'one piece',
    });
    expect(await client.resolveUrl('https://example.com/anime/x/')).toBeNull();
    expect(await client.getWebUrl(OP)).toBe(`${BASE}/anime/one-piece/`);
  });

  it('reads the page once when the details and the episodes are asked together', async () => {
    const { client, requests } = await load((r) =>
      r.url === `${BASE}/anime/one-piece/` ? page('detail_one_piece.html.txt') : undefined,
    );
    const [details, episodes] = await Promise.all([client.getAnimeDetails(OP), client.getEpisodes(OP)]);
    expect(details.title).toBeTruthy();
    expect(episodes.length).toBeGreaterThan(0);
    expect(requests).toHaveLength(1);
  });

  it('does not keep a failed page for the next call', async () => {
    let answers = 0;
    const { client, requests } = await load((r) =>
      r.url === `${BASE}/anime/one-piece/`
        ? ++answers === 1
          ? { status: 500 }
          : page('detail_one_piece.html.txt')
        : undefined,
    );
    await expect(client.getAnimeDetails(OP)).rejects.toThrow();
    await expect(client.getAnimeDetails(OP)).resolves.toMatchObject({ title: expect.any(String) });
    expect(requests).toHaveLength(2);
  });
});
