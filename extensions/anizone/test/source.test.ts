import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BASE, disposeAll, fixture, load, type Route } from './harness';

afterEach(disposeAll);

// forgedCursor runs in the sandbox; the test reads the cursors it sends, so `base64` is stood in for here.
beforeAll(() => {
  Object.assign(globalThis, { base64: { decode: (t: string) => Buffer.from(t, 'base64').toString('utf8') } });
});

const SERIES = { url: '/anime/fqvspc7f', title: 'The Iceblade Sorcerer Shall Rule the World II' };
const LONG = { url: '/anime/uyyyn4kf', title: 'One Piece' };
const json = (name: string) => ({ status: 200, text: fixture(name) });
const html = (name: string) => ({ status: 200, text: fixture(name) });

interface Call {
  updates: Record<string, string>;
  calls: { method: string; params: string[] }[];
}
const callOf = (body: string | undefined): Call =>
  (JSON.parse(body ?? '{}') as { components: Call[] }).components[0] as Call;

/** The site from fixtures; `livewire` decides what a POST to /livewire/update answers. */
const site =
  (
    livewire: Route = (r) =>
      callOf(r.body).calls.length > 0 ? json('livewire_index_page2.json') : json('livewire_update.json'),
  ): Route =>
  (r) => {
    const url = new URL(r.url);
    if (url.pathname === '/livewire/update') return livewire(r);
    if (url.pathname === '/') return html('home.html.txt');
    if (url.pathname === '/anime') return html(url.searchParams.has('search') ? 'search.html.txt' : 'index.html.txt');
    if (url.pathname === '/anime/fqvspc7f') return html('detail.html.txt');
    if (url.pathname === '/anime/uyyyn4kf') return html('detail_long.html.txt');
    return undefined;
  };

describe('listings', () => {
  it('latest page 1 is the 12 newest episodes of the home page, as their series', async () => {
    const { client, requests } = await load(site());
    const result = await client.getLatest(1);
    expect(requests.map((r) => r.url)).toEqual([`${BASE}/`]);
    expect(result.items).toHaveLength(12);
    expect(result.items[0]).toMatchObject({
      url: '/anime/zh8kj3zj',
      title: 'So What`s Wrong with Getting Reborn as a Goblin?',
    });
    expect(result.items[0]?.thumbnailUrl).toMatch(/^https:\/\/suzaku\.xin-cdn\.xyz\/.*\/snapshot\.webp$/);
    expect(result.hasNextPage).toBe(true);
  });

  it('latest page 2 continues with the "last added" order (a sort update, no page loaded yet)', async () => {
    const { client, requests } = await load(site());
    const result = await client.getLatest(2);
    const post = requests.find((r) => r.url.endsWith('/livewire/update'));
    expect(callOf(post?.body).updates).toEqual({ sort: 'added-desc', type: '0' });
    expect(result.items.length).toBeGreaterThan(20);
    expect(result.hasNextPage).toBe(true);
  });

  it('popular is the latest-release order; the first page needs one GET and one update', async () => {
    const { client, requests } = await load(site());
    const result = await client.getPopular(1);
    expect(requests.map((r) => new URL(r.url).pathname)).toEqual(['/anime', '/livewire/update']);
    const post = requests[1]!;
    expect(callOf(post.body).updates).toEqual({ sort: 'release-desc', type: '0' });
    expect(post.headers).toMatchObject({ 'X-Livewire': 'true', Origin: BASE, Referer: `${BASE}/anime` });
    expect(post.headers?.['X-CSRF-TOKEN']).toMatch(/^\w{20,}$/);
    expect(JSON.parse(post.body ?? '{}')._token).toBe(post.headers?.['X-CSRF-TOKEN']);
    // 24 items, minus the ones the site marks unsafe.
    expect(result.items.length).toBeGreaterThan(20);
    expect(result.items[0]).toMatchObject({ url: expect.stringMatching(/^\/anime\/\w{8}$/) });
  });

  it('without a session cookie (419) the popular list falls back to the A-Z page, and page 2 ends', async () => {
    const { client } = await load(site(() => ({ status: 419, text: '<title>Page Expired</title>' })));
    const popular = await client.getPopular(1);
    expect(popular.items.length).toBeGreaterThan(20);
    expect(popular.hasNextPage).toBe(true);
    expect(await client.getPopular(2)).toEqual({ items: [], hasNextPage: false });
    await expect(client.search('', 1, { sort: 'added-desc' })).rejects.toMatchObject({ typed: 'HttpError' });
  });

  it("search is a GET of /anime?search=, and the next page is a loadPage with the page's cursor", async () => {
    const { client, requests } = await load(site());
    const first = await client.search('naruto', 1, {});
    expect(requests[0]?.url).toBe(`${BASE}/anime?search=naruto`);
    expect(first.items.length).toBeGreaterThan(0);
    expect(first.hasNextPage).toBe(false);
    const index = await load(site());
    await index.client.search('', 2, {});
    const post = index.requests[1]!;
    expect(callOf(post.body).calls).toEqual([
      { path: '', method: 'loadPage', params: [expect.stringMatching(/^eyJ/)] },
    ]);
    expect(callOf(post.body).updates).toEqual({});
  });

  it('keeps the unsafe items out of a list', async () => {
    const unsafe = (slug: string, is_unsafe: boolean) => ({
      slug,
      main_title: slug,
      title_list: { '1': slug },
      is_unsafe,
    });
    const items = JSON.stringify([unsafe('aaaaaaaa', true), unsafe('bbbbbbbb', false)]).replace(/"/g, '\\u0022');
    const page = `<meta name="csrf-token" content="x"> x-data="{ items: JSON.parse('${items}'), nextCursor: null, hasMore: false }"`;
    const { client } = await load(() => ({ status: 200, text: page }));
    expect((await client.search('x', 1, {})).items.map((i) => i.url)).toEqual(['/anime/bbbbbbbb']);
  });

  it('a page without the data is a ParseError, a challenge a CloudflareError', async () => {
    const foreign = await load(() => ({ status: 200, text: '<html></html>' }));
    await expect(foreign.client.getLatest(1)).rejects.toMatchObject({ typed: 'ParseError' });
    await expect(foreign.client.search('x', 1, {})).rejects.toMatchObject({ typed: 'ParseError' });
    const challenge = await load((r) => ({ status: 403, url: r.url, text: 'Just a moment...' }));
    await expect(challenge.client.getLatest(1)).rejects.toMatchObject({ typed: 'CloudflareError' });
  });

  it('exposes the filters', async () => {
    const { client } = await load(() => undefined);
    const filters = await client.getFilters();
    const type = filters.find((f) => f.type === 'select' && f.id === 'type');
    expect(type?.type === 'select' && type.options).toHaveLength(9);
  });
});

describe('details and episodes', () => {
  it('reads the details', async () => {
    const { client } = await load(site());
    const d = await client.getAnimeDetails(SERIES);
    expect(d).toMatchObject({
      title: 'The Iceblade Sorcerer Shall Rule the World II',
      status: 'ongoing',
      type: 'tv',
      year: 2026,
    });
    expect(d.altTitles).toContain('Hyouken no Majutsushi ga Sekai o Suberu II');
    expect(d.description).toContain('fantasy light novel');
    expect(d.thumbnailUrl).toMatch(/^https:\/\/anizone\.to\/images\/anime\/.*\.jpg$/);
  });

  it('a short series is read from the page alone, with air dates', async () => {
    const { client, requests } = await load(site());
    const episodes = await client.getEpisodes(SERIES);
    expect(requests).toHaveLength(1);
    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({ url: '/anime/fqvspc7f/1', number: 1 });
    expect(episodes[0]?.uploadedAt).toBeGreaterThan(Date.UTC(2026, 0, 1));
  });

  it('a long series asks for the other pages in parallel batches with rebuilt cursors, then stops at the end', async () => {
    let pages = 0;
    const { client, requests } = await load(
      site((r) => {
        const cursor = callOf(r.body).calls[0]?.params[0];
        pages++;
        const base = JSON.parse(fixture('livewire_episodes_page.json')) as {
          components: { effects: { dispatches: { params: { hasMore: boolean } }[] } }[];
        };
        // The page of sort 192 (the 8th) is the last one.
        const sort = (JSON.parse(Buffer.from(cursor ?? '', 'base64').toString()) as { sort: number }).sort;
        base.components[0]!.effects.dispatches[0]!.params.hasMore = sort < 24 * 8;
        return { status: 200, text: JSON.stringify(base) };
      }),
    );
    const episodes = await client.getEpisodes(LONG);
    const cursors = requests
      .filter((r) => r.url.endsWith('/livewire/update'))
      .map(
        (r) =>
          JSON.parse(Buffer.from(callOf(r.body).calls[0]!.params[0]!, 'base64').toString()) as {
            sort: number;
            id: number;
          },
      );
    // The page's own cursor first, then rebuilt ones (sort in steps of 24, id 0); batches of eight.
    expect(cursors[0]).toMatchObject({ sort: 24, id: 1041 });
    expect(cursors.slice(1, 4)).toEqual([
      { sort: 48, id: 0, _pointsToNextItems: true },
      { sort: 72, id: 0, _pointsToNextItems: true },
      { sort: 96, id: 0, _pointsToNextItems: true },
    ]);
    expect(pages).toBe(8);
    // Page items repeat across the pages: every episode once, newest first.
    expect(new Set(episodes.map((e) => e.url)).size).toBe(episodes.length);
    const numbers = episodes.map((e) => e.number ?? 0);
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
    // The page's own 1-24, then the mocked page (25-48) again and again.
    expect(numbers.at(0)).toBe(48);
    expect(numbers.at(-1)).toBe(1);
    expect(episodes).toHaveLength(48);
  });

  it('waits out a 429 on an episode page and retries it', async () => {
    let first = true;
    const { client } = await load(
      site((r) => {
        if (first && callOf(r.body).calls.length > 0) {
          first = false;
          return { status: 429, text: 'slow down' };
        }
        const page = JSON.parse(fixture('livewire_episodes_page.json')) as {
          components: { effects: { dispatches: { params: { hasMore: boolean } }[] } }[];
        };
        page.components[0]!.effects.dispatches[0]!.params.hasMore = false;
        return { status: 200, text: JSON.stringify(page) };
      }),
    );
    const episodes = await client.getEpisodes(LONG);
    expect(episodes).toHaveLength(48);
  });

  it('keeps the first episodes when the other pages cannot be read (no session)', async () => {
    const { client, logs } = await load(site(() => ({ status: 419, text: 'Page Expired' })));
    const episodes = await client.getEpisodes(LONG);
    expect(episodes).toHaveLength(24);
    expect(episodes[0]?.number).toBe(24);
    expect(logs.some((l) => l.includes('Only the first episodes'))).toBe(true);
  });

  it('a series page without a title is a ParseError, a 404 a NotFoundError', async () => {
    const { client } = await load((r) =>
      r.url.endsWith('/gone') ? { status: 404 } : { status: 200, text: '<html></html>' },
    );
    await expect(client.getAnimeDetails({ url: '/anime/gone', title: 'x' })).rejects.toMatchObject({
      typed: 'NotFoundError',
    });
    await expect(client.getEpisodes(SERIES)).rejects.toMatchObject({ typed: 'ParseError' });
  });

  it('resolves site links and web urls', async () => {
    const { client } = await load(() => undefined);
    expect(await client.resolveUrl('https://anizone.to/anime/fqvspc7f')).toEqual({
      url: '/anime/fqvspc7f',
      title: 'fqvspc7f',
    });
    expect(await client.resolveUrl('https://example.com/anime/x')).toBeNull();
    expect(await client.getWebUrl({ url: '/anime/fqvspc7f/3', name: 'x' })).toBe(`${BASE}/anime/fqvspc7f/3`);
  });
});

describe('requests', () => {
  it('reads the series page once for its details and its episodes', async () => {
    const { client, requests } = await load(site());
    await Promise.all([client.getAnimeDetails(SERIES), client.getEpisodes(SERIES)]);
    expect(requests.filter((r) => r.url.endsWith('/anime/fqvspc7f'))).toHaveLength(1);
  });

  it('asks only for the episode pages that the page says exist', async () => {
    const route = site();
    const { client, requests } = await load((r) =>
      new URL(r.url).pathname === LONG.url
        ? { status: 200, text: fixture('detail_long.html.txt').replace('1184 Episodes', '30 Episodes') }
        : route(r),
    );
    await client.getEpisodes(LONG);
    // 24 episodes are in the page, the other 6 are one more page.
    expect(requests.filter((r) => r.url.endsWith('/livewire/update'))).toHaveLength(1);
  });
});
