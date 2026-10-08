import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestSite } from './index.ts';

const MEDIA = resolve(import.meta.dirname, '../../../apps/desktop/e2e/fixtures/media');
let site: TestSite;
beforeAll(async () => {
  site = await TestSite.start({ mediaDir: MEDIA, challengeMs: 50 });
});
afterAll(async () => site.close());
beforeEach(() => site.reset());

const get = (url: string, headers: Record<string, string> = {}) => fetch(url, { headers, redirect: 'manual' });
const withReferer = () => ({ referer: site.referer });

describe('pages', () => {
  it('lists, pages and searches', async () => {
    const page1 = await (await get(`${site.origin}/popular`)).text();
    expect(page1.match(/class="card"/g)).toHaveLength(12);
    expect(page1).toContain('class="next"');
    const page3 = await (await get(`${site.origin}/popular?page=3`)).text();
    expect(page3).not.toContain('class="next"');
    const found = await (await get(`${site.origin}/search?q=sora`)).text();
    expect(found).toContain('Sky Harbor');
    expect(found.match(/class="card"/g)).toHaveLength(1);
  });

  it('filters by status and genre, with exclusion', async () => {
    const drama = await (await get(`${site.origin}/search?genre=drama`)).text();
    expect(drama).toContain('Two Voices');
    expect(drama).not.toContain('Sky Harbor');
    const notAction = await (await get(`${site.origin}/search?genre=-action&q=sky`)).text();
    expect(notAction).not.toContain('Sky Harbor');
    const ongoing = await (await get(`${site.origin}/search?status=ongoing&q=long`)).text();
    expect(ongoing).toContain('Long Runner');
  });

  it('serves detail, episodes (newest first, variants) and covers', async () => {
    expect(await (await get(`${site.origin}/anime/sky-harbor`)).text()).toContain('Sora no Minato');
    const { episodes } = (await (await get(`${site.origin}/anime/two-voices/episodes.json`)).json()) as {
      episodes: { number: number; variant: string }[];
    };
    expect(episodes).toHaveLength(12);
    expect(episodes[0]).toMatchObject({ number: 6 });
    expect(new Set(episodes.map((e) => e.variant))).toEqual(new Set(['Sub', 'Dub']));
    expect(
      ((await (await get(`${site.origin}/anime/long-runner/episodes.json`)).json()) as { episodes: unknown[] })
        .episodes,
    ).toHaveLength(120);
    expect((await get(`${site.origin}/img/sky-harbor.svg`)).headers.get('content-type')).toBe('image/svg+xml');
    expect((await get(`${site.origin}/anime/nope`)).status).toBe(404);
  });
});

describe('embeds and media', () => {
  it('needs the site Referer for embeds and media', async () => {
    expect((await get(`${site.origin}/embed/sky-harbor-1-sub.a`)).status).toBe(403);
    expect((await get(`${site.cdnOrigin}/media/mp4/h264-aac.mp4`)).status).toBe(403);
    expect((await get(`${site.origin}/embed/sky-harbor-1-sub.a`, withReferer())).status).toBe(200);
  });

  it('exposes streams on the other host, plain and encrypted', async () => {
    const a = await (await get(`${site.origin}/embed/sky-harbor-1-sub.a`, withReferer())).text();
    expect(a).toContain(`${site.cdnOrigin}/media/hls-ts/master.m3u8`);
    const b = await (await get(`${site.origin}/embed/sky-harbor-1-sub.b`, withReferer())).text();
    expect(b).toMatch(/data-payload="[A-Za-z0-9+/=]+"/);
    expect(await (await get(`${site.origin}/watch/no-streams/1`)).text()).not.toContain('class="server"');
    expect((await get(`${site.origin}/embed/no-streams-1-sub.a`, withReferer())).status).toBe(404);
  });

  it('renews an expiring link on the second embed fetch, and keeps the fallback server dead', async () => {
    const first = await (await get(`${site.origin}/embed/token-tide-1-sub.a`, withReferer())).text();
    const second = await (await get(`${site.origin}/embed/token-tide-1-sub.a`, withReferer())).text();
    expect(first).toContain('/media/expiring/token-tide-1-sub.a-1/index.m3u8');
    expect(second).toContain('/media/hls-ts/master.m3u8');
    const a = await (await get(`${site.origin}/embed/bad-server-1-sub.a`, withReferer())).text();
    const b = await (await get(`${site.origin}/embed/bad-server-1-sub.b`, withReferer())).text();
    expect(a).toContain('/media/expiring/');
    expect(b).toMatch(/data-payload/);
  });

  it('answers Range with 206 and expires the stream after its first segment', async () => {
    const part = await get(`${site.cdnOrigin}/media/mp4/h264-aac.mp4`, { ...withReferer(), range: 'bytes=0-99' });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toMatch(/^bytes 0-99\//);
    const playlist = await get(`${site.cdnOrigin}/media/expiring/t1/index.m3u8`, withReferer());
    expect(playlist.status).toBe(200);
    const statuses: number[] = [];
    for (const n of [0, 1, 2]) {
      const segment = String(n).padStart(3, '0');
      statuses.push((await get(`${site.cdnOrigin}/media/expiring/t1/seg_${segment}.ts`, withReferer())).status);
    }
    expect(statuses).toEqual([200, 403, 403]);
  });
});

describe('behind a challenge, and helpers', () => {
  it('blocks /cf until the challenge cookie is presented', async () => {
    const blocked = await get(`${site.origin}/cf/popular`);
    expect([blocked.status, blocked.headers.get('cf-mitigated')]).toEqual([503, 'challenge']);
    const passed = await get(`${site.origin}/cf/popular`, { cookie: 'cf_clearance=ok' });
    expect(passed.status).toBe(200);
  });

  it('is flaky, rate limited, redirects and echoes headers on demand', async () => {
    expect([500, 500, 200]).toEqual([
      (await get(`${site.origin}/_t/flaky`)).status,
      (await get(`${site.origin}/_t/flaky`)).status,
      (await get(`${site.origin}/_t/flaky`)).status,
    ]);
    const limited = await get(`${site.origin}/_t/limited`);
    expect([limited.status, limited.headers.get('retry-after')]).toEqual([429, '1']);
    expect((await get(`${site.origin}/_t/limited`)).status).toBe(200);
    expect((await get(`${site.origin}/_t/redirect?to=file:///etc/passwd`)).headers.get('location')).toBe(
      'file:///etc/passwd',
    );
    const echo = await (
      await get(`${site.origin}/_t/echo`, { referer: 'https://x.test/', 'user-agent': 'UA/1' })
    ).json();
    expect(echo).toMatchObject({ referer: 'https://x.test/', userAgent: 'UA/1' });
  });

  it('logs requests with the headers the site saw', async () => {
    await get(`${site.origin}/popular`, { referer: 'https://r.test/' });
    expect(site.log.at(-1)).toMatchObject({
      server: 'site',
      path: '/popular',
      status: 200,
      referer: 'https://r.test/',
    });
  });
});

describe('for the download engine', () => {
  it('hides the download series from listings but finds them by search', async () => {
    expect(await (await get(`${site.origin}/popular?page=3`)).text()).not.toContain('class="next"');
    expect(await (await get(`${site.origin}/latest`)).text()).not.toContain('Long Wave');
    const found = await (await get(`${site.origin}/search?q=long%20wave`)).text();
    expect(found).toContain('data-slug="dl-long"');
  });

  it('serves each hls-* fixture as the stream of its series', async () => {
    const kinds: [string, string][] = [
      ['dl-aes', '/media/hls-aes/index.m3u8'],
      ['dl-abs', '/media/hls-abs/index.m3u8'],
      ['dl-audio', '/media/hls-audio/master.m3u8'],
      ['dl-long', '/media/hls-long/index.m3u8'],
      ['dl-byterange', '/media/hls-byterange/index.m3u8'],
      ['dl-keyrot', '/media/hls-keyrot/index.m3u8'],
      ['dl-live', '/media/hls-live/index.m3u8'],
    ];
    for (const [slug, path] of kinds) {
      const embed = await (await get(`${site.origin}/embed/${slug}-1-sub.a`, withReferer())).text();
      expect(embed, slug).toContain(`${site.cdnOrigin}${path}`);
      const playlist = await get(`${site.cdnOrigin}${path}`, withReferer());
      expect(playlist.status, slug).toBe(200);
      expect(await playlist.text(), slug).toContain('#EXTM3U');
    }
  });

  it('has the shapes the engine must handle: a separate audio group, byte ranges, two keys, no end', async () => {
    const text = async (path: string) => (await get(`${site.cdnOrigin}${path}`, withReferer())).text();
    expect(await text('/media/hls-audio/master.m3u8')).toMatch(/TYPE=AUDIO[^\n]*DEFAULT=YES[^\n]*URI=/);
    expect(await text('/media/hls-byterange/index.m3u8')).toContain('#EXT-X-BYTERANGE:');
    expect((await text('/media/hls-keyrot/index.m3u8')).match(/#EXT-X-KEY/g)).toHaveLength(2);
    expect(await text('/media/hls-live/index.m3u8')).not.toContain('#EXT-X-ENDLIST');
    expect((await text('/media/hls-long/index.m3u8')).match(/#EXTINF/g)).toHaveLength(24);
  });

  it('goes offline and comes back on the same ports', async () => {
    const [origin, cdn] = [site.origin, site.cdnOrigin];
    await site.stop();
    await expect(get(`${origin}/popular`)).rejects.toThrow();
    await expect(get(`${cdn}/media/mp4/h264-aac.mp4`, withReferer())).rejects.toThrow();
    await site.resume();
    expect([site.origin, site.cdnOrigin]).toEqual([origin, cdn]);
    expect((await get(`${origin}/popular`)).status).toBe(200);
  });

  it('adds episodes over time, uploaded now, and takes them back on reset', async () => {
    const list = async () =>
      (
        (await (await get(`${site.origin}/anime/quiet-orchard/episodes.json`)).json()) as {
          episodes: { number: number; uploadedAt: number }[];
        }
      ).episodes;
    expect(await list()).toHaveLength(3);
    expect((await get(`${site.origin}/watch/quiet-orchard/4`)).status).toBe(404);
    const before = Date.now();
    site.setEpisodeCount('quiet-orchard', 5);
    const episodes = await list();
    expect(episodes.map((e) => e.number)).toEqual([5, 4, 3, 2, 1]);
    expect(episodes[0]?.uploadedAt).toBeGreaterThanOrEqual(before);
    expect(episodes[4]?.uploadedAt).toBeLessThan(before);
    expect((await get(`${site.origin}/watch/quiet-orchard/5`)).status).toBe(200);
    site.reset();
    expect(await list()).toHaveLength(3);
  });

  it('slows media down, and not playlists', async () => {
    site.setThrottle({ segmentDelayMs: 150 });
    const started = Date.now();
    await get(`${site.cdnOrigin}/media/hls-long/index.m3u8`, withReferer());
    expect(Date.now() - started).toBeLessThan(100);
    const segmentStarted = Date.now();
    const segment = await get(`${site.cdnOrigin}/media/hls-long/seg_000.ts`, withReferer());
    expect((await segment.arrayBuffer()).byteLength).toBeGreaterThan(10_000);
    expect(Date.now() - segmentStarted).toBeGreaterThanOrEqual(140);

    site.setThrottle({ bytesPerSecond: 200_000 });
    const slowStarted = Date.now();
    const slow = await get(`${site.cdnOrigin}/media/hls-long/seg_001.ts`, withReferer());
    const size = (await slow.arrayBuffer()).byteLength;
    expect(Date.now() - slowStarted).toBeGreaterThanOrEqual((size / 200_000) * 1000 * 0.7);
  });

  it('refuses or cuts the requests a fault matches, from the n-th on, a number of times', async () => {
    site.addFault({ pattern: /seg_002\.ts$/, status: 403, from: 2, times: 1 });
    const seg2 = () => get(`${site.cdnOrigin}/media/hls-long/seg_002.ts`, withReferer());
    expect([(await seg2()).status, (await seg2()).status, (await seg2()).status]).toEqual([200, 403, 200]);

    site.clearFaults();
    site.addFault({ pattern: 'seg_003.ts', resetAfterBytes: 1000 });
    const cut = await get(`${site.cdnOrigin}/media/hls-long/seg_003.ts`, withReferer());
    await expect(cut.arrayBuffer()).rejects.toThrow();
    // Other files are untouched.
    expect((await get(`${site.cdnOrigin}/media/hls-long/seg_004.ts`, withReferer())).status).toBe(200);
  });
});
