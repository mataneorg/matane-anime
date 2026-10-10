import { afterEach, describe, expect, it } from 'vitest';
import { BASE, disposeAll, fixture, load, type Route } from './harness';

afterEach(disposeAll);

const AOT = { url: 'attack-on-titan-2jqd0', title: 'Attack on Titan' };
const PP = 'https://pp.animex.one';
const json = (name: string) => ({ status: 200, text: fixture(name) });

/** The three backends from fixtures; the GraphQL variables decide which catalogue answer is served. */
const api: Route = (r) => {
  if (r.url === `${BASE}/graphql`) {
    const body = JSON.parse(r.body ?? '{}') as {
      query: string;
      variables: { f?: Record<string, unknown>; id?: string };
    };
    if (!body.query.includes('catalogAnime')) return json('detail_aot.json');
    if (body.variables.f?.['query']) return json('catalog_search.json');
    if (body.variables.f?.['genres']) return json('catalog_filtered.json');
    return json('catalog_popular.json');
  }
  if (r.url.startsWith(`${BASE}/api/recent`)) return json('recent.json');
  if (r.url.startsWith(`${PP}/rest/api/episodes`)) return json('episodes_aot.json');
  return undefined;
};

const variables = (request: { body?: string }) =>
  (
    JSON.parse(request.body ?? '{}') as {
      variables: { f: Record<string, unknown>; s: unknown[]; l: number; o: number };
    }
  ).variables;

describe('listings', () => {
  it('popular is the catalogue by popularity, 30 a page, English titles and covers', async () => {
    const { client, requests } = await load(api);
    const result = await client.getPopular(3);
    expect(variables(requests[0]!)).toMatchObject({
      f: { includeAdult: false },
      s: [{ field: 'POPULARITY', direction: 'DESC' }],
      l: 30,
      o: 60,
    });
    expect(result.items).toHaveLength(30);
    expect(result.items[0]).toEqual({
      url: 'attack-on-titan-2jqd0',
      title: 'Attack on Titan',
      thumbnailUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx16498-buvcRTBx4NSm.jpg',
    });
    expect(result.hasNextPage).toBe(true);
  });

  it('latest is the recent releases as titles, one card each', async () => {
    const { client, requests } = await load(api);
    const result = await client.getLatest(2);
    expect(requests[0]?.url).toBe(`${BASE}/api/recent?page=2`);
    expect(result.items.length).toBeGreaterThan(15);
    expect(new Set(result.items.map((i) => i.url)).size).toBe(result.items.length);
    expect(result.hasNextPage).toBe(true);
  });

  it('searches by text and applies the filters', async () => {
    const { client, requests } = await load(api);
    const result = await client.search('steel ball run', 1, {});
    expect(variables(requests[0]!).f).toMatchObject({ query: 'steel ball run', includeAdult: false });
    expect(result.items[0]?.url).toBe('steel-ball-run-jojos-bizarre-adventure-1st-stage-rhkcb');
    await client.search('', 2, {
      genre: 'Action',
      format: 'MOVIE',
      status: 'FINISHED',
      year: '2020',
      audio: 'DUB',
      sort: 'AVERAGE_SCORE',
    });
    const v = variables(requests[1]!);
    expect(v.f).toEqual({
      includeAdult: false,
      genres: ['Action'],
      formatIn: ['MOVIE'],
      statusIn: ['FINISHED'],
      seasonYearMin: 2020,
      seasonYearMax: 2020,
      subDubFilter: 'DUB',
    });
    expect(v).toMatchObject({ s: [{ field: 'AVERAGE_SCORE', direction: 'DESC' }], o: 30 });
  });

  it('drops unknown filter values and sorts titles A-Z', async () => {
    const { client, requests } = await load(api);
    await client.search('', 1, { genre: 'Hentai', format: 'x', status: 'x', year: '1', audio: 'x', sort: 'x' });
    expect(variables(requests[0]!)).toMatchObject({ f: { includeAdult: false }, s: [{ field: 'POPULARITY' }] });
    expect(Object.keys(variables(requests[0]!).f)).toEqual(['includeAdult']);
    await client.search('', 1, { sort: 'TITLE_ENGLISH' });
    expect(variables(requests[1]!).s).toEqual([{ field: 'TITLE_ENGLISH', direction: 'ASC' }]);
  });

  it('keeps adult titles out of a list even if the backend returns them', async () => {
    const adult = {
      data: {
        catalogAnime: {
          items: [
            { id: 'a', titleEnglish: 'A', isAdult: true },
            { id: 'b', titleEnglish: 'B', genres: ['Hentai'] },
            { id: 'c', titleEnglish: 'C' },
          ],
          hasNextPage: false,
        },
      },
    };
    const { client } = await load(() => ({ status: 200, text: JSON.stringify(adult) }));
    expect((await client.getPopular(1)).items.map((i) => i.url)).toEqual(['c']);
  });

  it('a GraphQL error is a ParseError, a 404 a NotFoundError, a challenge a CloudflareError', async () => {
    const broken = await load(() => ({
      status: 200,
      text: JSON.stringify({ errors: [{ message: 'Unknown field' }], data: null }),
    }));
    await expect(broken.client.getPopular(1)).rejects.toMatchObject({ typed: 'ParseError' });
    const gone = await load(() => ({ status: 404 }));
    await expect(gone.client.getPopular(1)).rejects.toMatchObject({ typed: 'NotFoundError' });
    const challenge = await load((r) => ({ status: 403, url: r.url, text: 'Just a moment...' }));
    await expect(challenge.client.getPopular(1)).rejects.toMatchObject({ typed: 'CloudflareError' });
  });

  it('exposes the filters without the explicit genre', async () => {
    const { client } = await load(() => undefined);
    const genre = (await client.getFilters()).find((f) => f.type === 'select' && f.id === 'genre');
    const values = genre?.type === 'select' ? genre.options.map((o) => o.value) : [];
    expect(values).toContain('Action');
    expect(values).not.toContain('Hentai');
  });
});

describe('details and episodes', () => {
  it('reads the details', async () => {
    const { client } = await load(api);
    const d = await client.getAnimeDetails(AOT);
    expect(d).toMatchObject({
      title: 'Attack on Titan',
      status: 'completed',
      type: 'tv',
      year: 2013,
      studio: 'WIT STUDIO',
    });
    expect(d.genres).toContain('Action');
    expect(d.altTitles).toContain('Shingeki no Kyojin');
    expect(d.description).not.toMatch(/<br|&quot;/);
    expect(d.thumbnailUrl).toMatch(/^https:\/\/s4\.anilist\.co\//);
  });

  it('lists Sub and Dub entries with air dates, newest first', async () => {
    const { client } = await load(api);
    const episodes = await client.getEpisodes(AOT);
    expect(episodes.length).toBeGreaterThan(24);
    expect(episodes[0]).toMatchObject({ number: 25, variant: 'Sub', url: 'attack-on-titan-2jqd0/25/sub' });
    expect(episodes[1]).toMatchObject({ number: 25, variant: 'Dub', url: 'attack-on-titan-2jqd0/25/dub' });
    const first = episodes.at(-2);
    expect(first).toMatchObject({ number: 1, variant: 'Sub', uploadedAt: Date.UTC(2013, 3, 6, 15, 30) });
    expect(new Set(episodes.map((e) => e.url)).size).toBe(episodes.length);
  });

  it('a title the catalogue does not know is NotFoundError', async () => {
    const { client } = await load(() => ({ status: 200, text: JSON.stringify({ data: { anime: null } }) }));
    await expect(client.getAnimeDetails({ url: 'gone', title: 'x' })).rejects.toMatchObject({ typed: 'NotFoundError' });
  });

  it('an episode list that is not a list is a ParseError', async () => {
    const { client } = await load(() => ({ status: 200, text: '{"error":"x"}' }));
    await expect(client.getEpisodes(AOT)).rejects.toMatchObject({ typed: 'ParseError' });
  });

  it('web urls point at the title', async () => {
    const { client } = await load(() => undefined);
    expect(await client.getWebUrl({ url: 'attack-on-titan-2jqd0/3/dub', name: 'x' })).toBe(
      'https://animex.one/anime/attack-on-titan-2jqd0',
    );
  });
});
