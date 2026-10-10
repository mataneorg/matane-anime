import { afterEach, describe, expect, it, vi } from 'vitest';
import { BASE, disposeAll, fixture, load, type Route } from './harness';

afterEach(() => {
  disposeAll();
  vi.useRealTimers();
});

const KEY = '2ed532e1010005afeed2d9725c144bfd';
const DANDADAN = { url: '/anime.php?ugyek', title: 'Dandadan 2nd Season' };

const site: Route = (r) => {
  const u = r.url;
  const name = u.endsWith('/new.php')
    ? 'new.html.txt'
    : u.endsWith('/popular.php')
      ? 'popular.html.txt'
      : u.includes('/search.php')
        ? 'search.html.txt'
        : u.includes('/tags.php')
          ? 'tags.html.txt'
          : u.endsWith('/anime.php?ugyek')
            ? 'detail.html.txt'
            : u.endsWith('/anime.php?op')
              ? 'detail_op.html.txt'
              : u.endsWith('/gate.php') && r.headers?.['Cookie'] === `key=${KEY}`
                ? 'gate.html.txt'
                : undefined;
  return name
    ? { status: 200, text: fixture(name) }
    : u.endsWith('/gate.php')
      ? { status: 404, text: 'no' }
      : undefined;
};

describe('listings', () => {
  it('latest reads the chart cards with absolute covers and has no next page', async () => {
    const { client, requests } = await load(site);
    const result = await client.getLatest(1);
    expect(requests[0]?.url).toBe(`${BASE}/new.php`);
    expect(result.items.length).toBeGreaterThan(30);
    expect(result.items[0]).toMatchObject({
      url: expect.stringMatching(/^\/anime\.php\?[a-z0-9]+$/),
      title: 'Welsh & Shedar',
      thumbnailUrl: `${BASE}/image.php?zf9ws`,
    });
    expect(new Set(result.items.map((i) => i.url)).size).toBe(result.items.length);
    expect(result.items.length).toBeLessThanOrEqual(50);
  });

  it('popular lists 100 and pages in fifties', async () => {
    const { client } = await load(site);
    const first = await client.getPopular(1);
    expect(first.items).toHaveLength(50);
    expect(first.hasNextPage).toBe(true);
    const second = await client.getPopular(2);
    expect(second.items).toHaveLength(50);
    expect(second.hasNextPage).toBe(false);
    expect(second.items[0]?.url).not.toBe(first.items[0]?.url);
  });

  it('searches with similarimg cards', async () => {
    const { client, requests } = await load(site);
    const result = await client.search('naruto', 1, {});
    expect(requests[0]?.url).toBe(`${BASE}/search.php?s=naruto`);
    expect(result.items.some((i) => i.title === 'Naruto' && i.url === '/anime.php?ukr6y')).toBe(true);
  });

  it('an empty query uses the tag and slices the long list', async () => {
    const { client, requests } = await load(site);
    const result = await client.search('', 1, { tag: 'Action' });
    expect(requests[0]?.url).toBe(`${BASE}/tags.php?tag=Action`);
    expect(result.items).toHaveLength(50);
    expect(result.hasNextPage).toBe(true);
    const last = await client.search('', 14, { tag: 'Action' });
    expect(last.items).toHaveLength(50);
    expect(last.hasNextPage).toBe(false);
    expect((await client.search('', 99, { tag: 'Action' })).items).toEqual([]);
  });

  it('ignores a tag that is not offered', async () => {
    const { client, requests } = await load(site);
    await client.search('', 1, { tag: 'Hentai' });
    expect(requests[0]?.url).toBe(`${BASE}/new.php`);
  });

  it('offers no adult tag', async () => {
    const { client } = await load(site);
    const filters = await client.getFilters();
    const labels = JSON.stringify(filters);
    expect(labels).not.toMatch(/hentai|erotica/i);
    expect(labels).toContain('Action');
  });
});

describe('details and episodes', () => {
  it('reads the detail page', async () => {
    const { client } = await load(site);
    const details = await client.getAnimeDetails(DANDADAN);
    expect(details).toMatchObject({
      url: '/anime.php?ugyek',
      title: 'Dandadan 2nd Season',
      description: 'The second season of Dandadan.',
      year: 2025,
      status: 'unknown',
      thumbnailUrl: 'https://animeheaven.me/image.php?anjid',
    });
    expect(details.genres).toEqual(['Action', 'Drama', 'Ecchi', 'Shounen', 'Supernatural', 'Based On A Manga']);
  });

  it('a running series (year range) is ongoing', async () => {
    const { client } = await load((r) =>
      r.url.endsWith('?op') ? { status: 200, text: fixture('detail_op.html.txt') } : undefined,
    );
    const details = await client.getAnimeDetails({ url: '/anime.php?op', title: 'One Piece' });
    expect(details).toMatchObject({ title: 'One Piece', year: 1999, status: 'ongoing' });
  });

  it('lists episodes newest first with keys, numbers and approximate dates', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-09T00:00:00Z'));
    const { client } = await load(site);
    const episodes = await client.getEpisodes(DANDADAN);
    expect(episodes).toHaveLength(12);
    expect(episodes[0]).toEqual({
      url: KEY,
      name: 'Episode 12',
      number: 12,
      variant: 'Sub',
      uploadedAt: Date.parse('2026-10-09T00:00:00Z') - 385 * 86_400_000,
    });
    expect(episodes.map((e) => e.number)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });

  it('keeps fractional numbers and leaves out raws', async () => {
    const { client } = await load((r) =>
      r.url.endsWith('?op') ? { status: 200, text: fixture('detail_op.html.txt') } : undefined,
    );
    const episodes = await client.getEpisodes({ url: '/anime.php?op', title: 'One Piece' });
    expect(episodes.length).toBeGreaterThan(250);
    expect(episodes[0]?.number).toBe(1180);
    expect(episodes.some((e) => e.number === 1150.5)).toBe(true);
    const numbers = episodes.map((e) => e.number as number);
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
  });

  it('a missing page is NotFoundError', async () => {
    const { client } = await load(() => ({ status: 200, text: '<html><body>nothing</body></html>' }));
    await expect(client.getAnimeDetails({ url: '/anime.php?zzzzz', title: 'x' })).rejects.toMatchObject({
      typed: 'NotFoundError',
    });
  });
});

describe('streams', () => {
  it('sends the key as a Cookie and returns the mp4, skipping the error fallbacks', async () => {
    const { client, requests } = await load(site);
    const streams = await client.getStreams({ url: KEY, name: 'Episode 12', number: 12 });
    expect(requests[0]).toMatchObject({ url: `${BASE}/gate.php`, headers: { Cookie: `key=${KEY}` } });
    expect(streams).toEqual([
      {
        url: `https://cz.animeheaven.me/video.mp4?${KEY}&4b513bb34a43d93c8224ceb3f4855ba2`,
        server: 'AnimeHeaven',
        quality: 1080,
        kind: 'mp4',
      },
    ]);
  });

  it('an unknown key is NotFoundError', async () => {
    const { client } = await load(site);
    await expect(client.getStreams({ url: 'f'.repeat(32), name: 'x' })).rejects.toMatchObject({
      typed: 'NotFoundError',
    });
    await expect(client.getStreams({ url: 'not-a-key', name: 'x' })).rejects.toMatchObject({ typed: 'NotFoundError' });
  });
});

describe('urls', () => {
  it('resolves site links', async () => {
    const { client } = await load(site);
    expect(await client.resolveUrl('https://animeheaven.me/anime.php?ugyek')).toEqual({
      url: '/anime.php?ugyek',
      title: 'ugyek',
    });
    expect(await client.resolveUrl('https://example.com/')).toBeNull();
    expect(await client.getWebUrl({ url: '/anime.php?ugyek', title: 'x' })).toBe(`${BASE}/anime.php?ugyek`);
  });
});

describe('requests', () => {
  it('reads a long list once for all its pages', async () => {
    const { client, requests } = await load(site);
    const first = await client.getPopular(1);
    const second = await client.getPopular(2);
    expect(requests).toHaveLength(1);
    expect(second.items[0]?.url).not.toBe(first.items[0]?.url);
  });

  it('reads the page of an anime once for its details and its episodes', async () => {
    const { client, requests } = await load(site);
    const [details, episodes] = await Promise.all([client.getAnimeDetails(DANDADAN), client.getEpisodes(DANDADAN)]);
    expect(requests).toHaveLength(1);
    expect(details.title).toBeTruthy();
    expect(episodes.length).toBeGreaterThan(0);
  });

  it('does not keep a failed request', async () => {
    let failing = true;
    const { client, requests } = await load((r) => (failing ? { status: 500 } : site(r)));
    await expect(client.getPopular(1)).rejects.toBeDefined();
    failing = false;
    expect((await client.getPopular(1)).items).toHaveLength(50);
    expect(requests.length).toBeGreaterThan(1);
  });
});
