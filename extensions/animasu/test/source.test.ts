import { afterEach, describe, expect, it } from 'vitest';
import { BASE, disposeAll, fixture, load } from './harness';

afterEach(disposeAll);

const page = (name: string) => ({ status: 200, text: fixture(name) });
const KOORI = { url: '/anime/koori-no-jouheki-s2/', title: 'Koori no Jouheki Season 2' };

describe('listings', () => {
  it('reads popular (note the spelling "populer") with covers and next page', async () => {
    const { client, requests } = await load((r) =>
      r.url.includes('pencarian') ? page('list_popular.html.txt') : undefined,
    );
    const result = await client.getPopular(1);
    expect(requests[0]?.url).toBe(`${BASE}/pencarian/?urutan=populer`);
    expect(result.items).toHaveLength(10);
    expect(result.items[0]).toEqual({
      url: '/anime/op-indonesia/',
      title: 'One Piece Serial',
      thumbnailUrl: 'https://i1.wp.com/animasu.love/wp-content/uploads/2020/04/download-1.jpeg',
    });
    expect(result.hasNextPage).toBe(true);
  });

  it('latest is ordered by update and pages with ?halaman', async () => {
    const { client, requests } = await load((r) =>
      r.url.includes('pencarian') ? page('list_popular.html.txt') : undefined,
    );
    await client.getLatest(3);
    expect(requests[0]?.url).toBe(`${BASE}/pencarian/?urutan=update&halaman=3`);
  });

  it('searches by text and ignores filters then', async () => {
    const { client, requests } = await load((r) => (r.url.includes('s=one') ? page('search.html.txt') : undefined));
    const result = await client.search('one piece', 2, { genre: 'aksi' });
    expect(requests[0]?.url).toBe(`${BASE}/page/2/?s=one+piece`);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((i) => i.url.startsWith('/anime/') && i.thumbnailUrl?.startsWith('https://'))).toBe(true);
  });

  it('builds filter urls and drops unknown values', async () => {
    const { client, requests } = await load((r) =>
      r.url.includes('pencarian') ? page('list_popular.html.txt') : undefined,
    );
    await client.search('', 2, { genre: 'aksi', status: 'ongoing', type: 'Movie', order: 'populer' });
    await client.search('', 1, { genre: '../x', status: 'bogus' });
    const first = new URL(requests[0]?.url ?? '');
    expect(first.searchParams.getAll('genre[]')).toEqual(['aksi']);
    expect(first.searchParams.get('status')).toBe('ongoing');
    expect(first.searchParams.get('tipe')).toBe('Movie');
    expect(first.searchParams.get('halaman')).toBe('2');
    expect(requests[1]?.url).toBe(`${BASE}/pencarian/?urutan=update`);
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
    expect(genre?.type === 'select' && genre.options.length).toBe(57);
    const slugs = genre?.type === 'select' ? genre.options.map((o) => o.value) : [];
    expect(slugs).toContain('aksi');
    expect(slugs).not.toContain('hentai');
  });
});

describe('details and episodes', () => {
  const route = (r: { url: string }) =>
    r.url === `${BASE}/anime/koori-no-jouheki-s2/` ? page('detail_a.html.txt') : undefined;

  it('reads the details', async () => {
    const { client } = await load(route);
    const d = await client.getAnimeDetails(KOORI);
    expect(d).toMatchObject({
      title: 'Koori no Jouheki Season 2',
      status: 'ongoing',
      type: 'tv',
      year: 2026,
      studio: 'Studio Kai',
      genres: ['Drama', 'Komedi', 'Romansa', 'Sekolahan'],
      altTitles: ['The Ramparts of Ice Season 2'],
      description: 'Musim kedua Koori no Jouheki.',
    });
    expect(d.thumbnailUrl).toMatch(/^https:\/\/i\d\.wp\.com\/animasu\.love\/.*\.jpg$/);
  });

  it('lists the episodes newest first (the site has no dates)', async () => {
    const { client } = await load(route);
    const episodes = await client.getEpisodes(KOORI);
    expect(episodes.map((e) => [e.url, e.number, e.name])).toEqual([
      ['/nonton-koori-no-jouheki-season-2-episode-2/', 2, 'Episode 2'],
      ['/nonton-koori-no-jouheki-season-2-episode-1/', 1, 'Episode 1'],
    ]);
    expect(episodes[0]?.uploadedAt).toBeUndefined();
  });

  it('a missing anime is NotFoundError and a foreign page a ParseError', async () => {
    const { client } = await load((r) =>
      r.url.endsWith('/gone/') ? { status: 404 } : { status: 200, text: '<html></html>' },
    );
    await expect(client.getAnimeDetails({ url: '/anime/gone/', title: 'x' })).rejects.toMatchObject({
      typed: 'NotFoundError',
    });
    await expect(client.getEpisodes(KOORI)).rejects.toMatchObject({ typed: 'ParseError' });
  });

  it('resolves site links and web urls', async () => {
    const { client } = await load(() => undefined);
    expect(await client.resolveUrl('https://animasu.me/anime/one-piece/')).toEqual({
      url: '/anime/one-piece/',
      title: 'one piece',
    });
    expect(await client.resolveUrl('https://example.com/anime/x/')).toBeNull();
    expect(await client.getWebUrl(KOORI)).toBe(`${BASE}/anime/koori-no-jouheki-s2/`);
  });
});
