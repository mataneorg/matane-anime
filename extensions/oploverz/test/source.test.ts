import { afterEach, describe, expect, it } from 'vitest';
import { BASE, disposeAll, fixture, load } from './harness';

afterEach(disposeAll);

const json = (name: string) => ({ status: 200, text: fixture(name) });

describe('listings', () => {
  it('reads the latest episodes as one card per series', async () => {
    const { client, requests } = await load((r) =>
      r.url.startsWith(`${BASE}/episodes?`) ? json('episodes_latest.json') : undefined,
    );
    const page = await client.getLatest(1);
    expect(requests[0]?.url).toBe(`${BASE}/episodes?page=1&pageSize=30`);
    expect(page.items.length).toBeGreaterThan(0);
    expect(new Set(page.items.map((i) => i.url)).size).toBe(page.items.length);
    expect(page.items[0]).toEqual({
      url: expect.any(String) as string,
      title: expect.any(String) as string,
      thumbnailUrl: expect.stringContaining('https://') as string,
    });
    expect(page.hasNextPage).toBe(true);
  });

  it('reads the hot series as popular', async () => {
    const { client, requests } = await load((r) => (r.url.includes('hot=true') ? json('series_hot.json') : undefined));
    const page = await client.getPopular(1);
    expect(requests[0]?.url).toContain('hot=true');
    expect(page.items.length).toBeGreaterThan(5);
  });

  it('searches with q and genre', async () => {
    const { client, requests } = await load((r) =>
      r.url.startsWith(`${BASE}/series?`) ? json('search_naruto.json') : undefined,
    );
    const page = await client.search('naruto', 2, { genre: 'action' });
    const url = new URL(requests[0]?.url ?? '');
    expect(url.searchParams.get('q')).toBe('naruto');
    expect(url.searchParams.get('genre')).toBe('action');
    expect(url.searchParams.get('page')).toBe('2');
    expect(page.items.length).toBeGreaterThan(0);
  });

  it('omits empty q and ignores a malformed genre', async () => {
    const { client, requests } = await load((r) =>
      r.url.startsWith(`${BASE}/series?`) ? json('series_list.json') : undefined,
    );
    await client.search('  ', 1, { genre: '../x' });
    expect(requests[0]?.url).toBe(`${BASE}/series?page=1&pageSize=30`);
  });

  it('reports a body that is not a list', async () => {
    const { client } = await load(() => ({ status: 200, text: '{"nope":1}' }));
    await expect(client.getLatest(1)).rejects.toThrow(/site changed/);
  });

  it('exposes the genre filter', async () => {
    const { client } = await load(() => undefined);
    const filters = await client.getFilters();
    expect(filters[0]).toMatchObject({ type: 'select', id: 'genre' });
  });
});

describe('details and episodes', () => {
  it('maps the series object', async () => {
    const { client, requests } = await load((r) =>
      r.url === `${BASE}/series/one-piece` ? json('series_detail.json') : undefined,
    );
    const d = await client.getAnimeDetails({ url: 'one-piece', title: 'One Piece' });
    expect(requests[0]?.url).toBe(`${BASE}/series/one-piece`);
    expect(d).toMatchObject({
      url: 'one-piece',
      title: 'One Piece',
      status: 'ongoing',
      year: 1999,
      studio: 'Toei Animation',
    });
    expect(d.genres?.length).toBeGreaterThan(0);
    expect(d.description).not.toContain('\r');
  });

  it('keeps the order, names untitled episodes and fixes 1970 dates', async () => {
    const { client, requests } = await load((r) =>
      r.url.startsWith(`${BASE}/series/one-piece/episodes?`) ? json('series_episodes.json') : undefined,
    );
    const list = await client.getEpisodes({ url: 'one-piece', title: 'One Piece' });
    expect(requests[0]?.url).toBe(`${BASE}/series/one-piece/episodes?page=1&pageSize=2000`);
    expect(list).toHaveLength(5);
    expect(list[0]?.number).toBeGreaterThan(list[4]?.number ?? Infinity);
    for (const e of list) {
      expect(e.url).toBe(`one-piece/${e.number}`);
      expect(e.name.length).toBeGreaterThan(0);
      expect(e.uploadedAt === undefined || new Date(e.uploadedAt).getUTCFullYear() > 1971).toBe(true);
    }
  });

  it('survives null titles and odd numbers', async () => {
    const body = {
      meta: { currentPage: 1, lastPage: 1 },
      data: [
        {
          title: null,
          episodeNumber: '0',
          subbed: 'Sub',
          releasedAt: '1970-01-01T00:00:00.000Z',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
        { title: '  ', episodeNumber: '12.5', releasedAt: null },
        { title: 'x', episodeNumber: null },
        { title: 'dup', episodeNumber: '0' },
      ],
    };
    const { client } = await load(() => ({ status: 200, text: JSON.stringify(body) }));
    const list = await client.getEpisodes({ url: 's', title: 's' });
    expect(list).toEqual([
      { url: 's/0', name: 'Episode 0', number: 0, variant: 'Sub', uploadedAt: Date.parse('2024-01-01T00:00:00.000Z') },
      { url: 's/12.5', name: 'Episode 12.5', number: 12.5 },
    ]);
  });
});

describe('urls', () => {
  it('resolves site links and builds web urls', async () => {
    const { client } = await load(() => undefined);
    expect(await client.resolveUrl?.('https://oploverz.site/series/one-piece')).toMatchObject({ url: 'one-piece' });
    expect(await client.resolveUrl?.('https://example.com/x')).toBeNull();
    expect(await client.getWebUrl?.({ url: 'one-piece/3', name: 'x' })).toBe(
      'https://oploverz.site/series/one-piece/episode/3',
    );
  });
});
