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

  it('answers Range with 206 and expires the stream after its first segment', async () => {
    const part = await get(`${site.cdnOrigin}/media/mp4/h264-aac.mp4`, { ...withReferer(), range: 'bytes=0-99' });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toMatch(/^bytes 0-99\//);
    const playlist = await get(`${site.cdnOrigin}/media/expiring/index.m3u8`, withReferer());
    expect(playlist.status).toBe(200);
    const statuses: number[] = [];
    for (const n of [0, 1, 2]) {
      const segment = String(n).padStart(3, '0');
      statuses.push((await get(`${site.cdnOrigin}/media/expiring/seg_${segment}.ts`, withReferer())).status);
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
