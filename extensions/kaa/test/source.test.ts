import { afterEach, describe, expect, it } from 'vitest';
import { BASE, disposeAll, fixture, load, type Route } from './harness';

afterEach(disposeAll);

const SBR = 'jojo-no-kimyou-na-bouken-part-7-steel-ball-run-472c';
const json = (name: string) => ({ status: 200, text: fixture(name) });

/** The API from fixtures: the path decides the answer, the query is checked by the tests. */
const api: Route = (r) => {
  const url = new URL(r.url);
  const path = url.pathname.replace(/^\/api/, '');
  if (path === '/show/recent')
    return json(url.searchParams.get('type') === 'dub' ? 'recent_dub.json' : 'recent_sub.json');
  if (path === '/show/popular' || path === '/show/trending' || path === '/show/top') return json('popular.json');
  if (path === '/fsearch') return json('search.json');
  if (path === `/show/${SBR}`) return json('show_sbr.json');
  if (path === `/show/${SBR}/episodes`)
    return json(url.searchParams.get('lang') === 'en-US' ? 'eps_sbr_en.json' : 'eps_sbr_ja.json');
  if (path === `/show/${SBR}/episode/ep-4-f3a039`) return json('episode_sbr.json');
  return undefined;
};

describe('listings', () => {
  it('latest is the recent sub releases, one card per show, English titles', async () => {
    const { client, requests } = await load(api);
    const result = await client.getLatest(2);
    expect(requests[0]?.url).toBe(`${BASE}/show/recent?type=sub&page=2`);
    expect(result.items.length).toBeGreaterThan(20);
    expect(result.items[0]).toEqual({
      url: 'jojo-no-kimyou-na-bouken-part-7-steel-ball-run-472c',
      title: "Steel Ball Run: JoJo's Bizarre Adventure",
      thumbnailUrl: 'https://kaa.lt/image/poster/jojo-no-kimyou-na-bouken-part-7-steel-ball-run-337a-sm.webp',
    });
    expect(result.hasNextPage).toBe(true);
    expect(new Set(result.items.map((i) => i.url)).size).toBe(result.items.length);
  });

  it('popular has a next page until the last one', async () => {
    const { client } = await load(api);
    const first = await client.getPopular(1);
    expect(first.items).toHaveLength(24);
    expect(first.items[0]?.title).toBe('Attack on Titan');
    expect(first.hasNextPage).toBe(true);
    expect((await client.getPopular(22)).hasNextPage).toBe(false);
  });

  it('searches by POST with the query and page', async () => {
    const { client, requests } = await load(api);
    const result = await client.search('steel ball run', 1, {});
    expect(requests[0]).toMatchObject({ url: `${BASE}/fsearch`, method: 'POST' });
    expect(JSON.parse(requests[0]?.body ?? '{}')).toEqual({ query: 'steel ball run', page: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.hasNextPage).toBe(false);
  });

  it('applies genre, type and year on the pages read', async () => {
    const { client, requests } = await load(api);
    const result = await client.search('', 1, { genre: 'Action', type: 'tv', year: '2013' });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((i) => i.title.length > 0)).toBe(true);
    expect(result.items.some((i) => i.title === 'Attack on Titan')).toBe(true);
    // Up to four site pages are read to fill one page of results.
    expect(requests.length).toBeLessThanOrEqual(4);
    const none = await client.search('', 1, { genre: 'Action', type: 'movie', year: '1901' });
    expect(none.items).toEqual([]);
    const unknown = await client.search('', 1, { genre: 'Nope', type: 'bogus' });
    expect(unknown.items).toHaveLength(24);
  });

  it('reports a Cloudflare challenge, a 404 and a body that is not JSON', async () => {
    const challenge = await load((r) => ({ status: 403, url: r.url, text: 'Just a moment...' }));
    await expect(challenge.client.getPopular(1)).rejects.toMatchObject({ typed: 'CloudflareError' });
    const gone = await load(() => ({ status: 404 }));
    await expect(gone.client.getPopular(1)).rejects.toMatchObject({ typed: 'NotFoundError' });
    const html = await load(() => ({ status: 200, text: '<html></html>' }));
    await expect(html.client.getPopular(1)).rejects.toMatchObject({ typed: 'ParseError' });
  });

  it('exposes the filters without the explicit genre', async () => {
    const { client } = await load(() => undefined);
    const filters = await client.getFilters();
    const genre = filters.find((f) => f.type === 'select' && f.id === 'genre');
    const values = genre?.type === 'select' ? genre.options.map((o) => o.value) : [];
    expect(values).toContain('Action');
    expect(values).not.toContain('Erotica');
    expect(values).toHaveLength(77);
  });
});

describe('details and episodes', () => {
  it('reads the details', async () => {
    const { client } = await load(api);
    const d = await client.getAnimeDetails({ url: SBR, title: 'x' });
    expect(d).toMatchObject({
      title: "Steel Ball Run: JoJo's Bizarre Adventure",
      status: 'ongoing',
      type: 'ona',
      year: 2026,
      genres: ['Action', 'Adventure', 'Historical', 'Mystery', 'Seinen', 'Shounen', 'Supernatural'],
      thumbnailUrl: 'https://kaa.lt/image/poster/jojo-no-kimyou-na-bouken-part-7-steel-ball-run-337a-hq.webp',
    });
    expect(d.altTitles).toContain('Steel Ball Run: JoJo no Kimyou na Bouken');
    expect(d.description).toContain('American Old West');
  });

  it('lists the sub and the dub of every episode, newest first', async () => {
    const { client, requests } = await load(api);
    const episodes = await client.getEpisodes({ url: SBR, title: 'x' });
    expect(requests.map((r) => new URL(r.url).searchParams.get('lang')).filter(Boolean)).toEqual(['ja-JP', 'en-US']);
    expect(episodes.map((e) => [e.number, e.variant])).toEqual([
      [4, 'Sub'],
      [4, 'Dub'],
      [3, 'Sub'],
      [3, 'Dub'],
      [2, 'Sub'],
      [2, 'Dub'],
      [1, 'Sub'],
      [1, 'Dub'],
    ]);
    expect(episodes[0]?.url).toMatch(new RegExp(`^${SBR}/ep-4-[0-9a-f]+$`));
    expect(episodes[0]?.url).not.toBe(episodes[1]?.url);
    expect(new Set(episodes.map((e) => e.url)).size).toBe(episodes.length);
  });

  it('a show with only the original language has no dub entries', async () => {
    const { client } = await load((r) =>
      r.url.includes('/episodes?')
        ? json('eps_sbr_ja.json')
        : { status: 200, text: JSON.stringify({ title: 'x', locales: ['ja-JP'] }) },
    );
    const episodes = await client.getEpisodes({ url: 'x', title: 'x' });
    expect(episodes.every((e) => e.variant === 'Sub')).toBe(true);
    expect(episodes).toHaveLength(4);
  });

  it('a missing show is NotFoundError', async () => {
    const { client } = await load(() => ({ status: 404 }));
    await expect(client.getAnimeDetails({ url: 'gone', title: 'x' })).rejects.toMatchObject({ typed: 'NotFoundError' });
  });

  it('resolves site links and web urls', async () => {
    const { client } = await load(() => undefined);
    expect(await client.resolveUrl('https://kaa.lt/jojo-no-kimyou-na-bouken-part-7-steel-ball-run-472c')).toEqual({
      url: 'jojo-no-kimyou-na-bouken-part-7-steel-ball-run-472c',
      title: 'jojo no kimyou na bouken part 7 steel ball run',
    });
    expect(await client.resolveUrl('https://kaa.lt/api/show/popular')).toBeNull();
    expect(await client.resolveUrl('https://example.com/x')).toBeNull();
    expect(await client.getWebUrl({ url: `${SBR}/ep-4-f3a039`, name: 'x' })).toBe(`https://kaa.lt/${SBR}/ep-4-f3a039`);
  });
});
