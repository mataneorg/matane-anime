import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadSource } from '../../../packages/extension-cli/src/run';

// Talks to the real site, so it only runs on request: `pnpm test:live`.
const USER_AGENT = (JSON.parse(readFileSync('manifest.json', 'utf8')) as { userAgent: string }).userAgent;
const LIVE = process.env['LIVE'] === '1';

interface Probe {
  server: string;
  kind: string | undefined;
  quality: number | undefined;
  host: string;
  status: number | string;
  type: string;
}

describe.skipIf(!LIVE)('nimegami (live)', () => {
  it('browses, searches, reads details and episodes', { timeout: 120_000 }, async () => {
    const { client, runtime, call } = await loadSource('.', { prefs: [] });
    try {
      const popular = await client.getPopular(1, call);
      expect(popular.items.length).toBe(24);
      expect(popular.hasNextPage).toBe(true);
      expect((await client.getPopular(2, call)).items.length).toBe(24);
      const latest = await client.getLatest(1, call);
      expect(latest.items.length).toBeGreaterThan(10);
      const hits = await client.search('one piece', 1, {}, call);
      expect(hits.items.some((i) => i.url === '/one-piece-sub-indo/')).toBe(true);
      const filtered = await client.search('', 1, { genre: 'Action', format: 'MOVIE', year: '2020' }, call);
      expect(filtered.items.length).toBeGreaterThan(0);
      // The site answers a page past the end with its last page: the next-page link is what ends the paging.
      expect((await client.getPopular(99999, call)).hasNextPage).toBe(false);

      const dandadan = { url: '/dandadan-sub-indo/', title: 'Dandadan' };
      const details = await client.getAnimeDetails(dandadan, call);
      expect(details).toMatchObject({ title: 'Dandadan', year: 2024, status: 'completed', type: 'tv' });
      const episodes = await client.getEpisodes(dandadan, call);
      expect(episodes.map((e) => e.number)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
      await expect(
        client.getAnimeDetails({ url: '/slug-yang-tidak-ada-xyz-sub-indo/', title: 'x' }, call),
      ).rejects.toMatchObject({
        typed: 'NotFoundError',
      });
    } finally {
      runtime.dispose();
    }
  });

  it('resolves streams and every one of them actually answers', { timeout: 300_000 }, async () => {
    const { client, runtime, call } = await loadSource('.', { prefs: [] });
    try {
      const targets = [];
      for (const url of ['/dandadan-sub-indo/', '/one-piece-sub-indo/']) {
        const episodes = await client.getEpisodes({ url, title: url }, call);
        targets.push(episodes[0]!, episodes[Math.floor(episodes.length / 2)]!);
      }
      const latest = await client.getLatest(1, call);
      for (const item of latest.items.slice(0, 2)) {
        const first = (await client.getEpisodes(item, call))[0];
        if (first) targets.push(first);
      }
      const probes: Probe[] = [];
      for (const episode of targets) {
        // An episode may have only unreadable hosts: a NotFoundError, never a crash.
        const streams = await client.getStreams(episode, call).catch((e: { typed?: string }) => {
          expect(e.typed).toBe('NotFoundError');
          return [];
        });
        for (const stream of streams) {
          let response: Response | Error | undefined;
          for (let attempt = 0; attempt < 2 && !(response instanceof Response); attempt++) {
            response = await fetch(stream.url, {
              headers: {
                'user-agent': USER_AGENT,
                ...stream.headers,
                ...(stream.kind === 'hls' ? {} : { Range: 'bytes=0-1023' }),
              },
              signal: AbortSignal.timeout(20_000),
            }).catch((e: Error) => e);
          }
          const ok = response instanceof Response;
          probes.push({
            server: stream.server,
            kind: stream.kind,
            quality: stream.quality,
            host: new URL(stream.url).host,
            status: ok ? response.status : String(response),
            type: ok ? (response.headers.get('content-type') ?? '') : '',
          });
          // The site links some files that were deleted since (pixeldrain answers 404 JSON): the app falls back to
          // the next stream, so that is a dead link, not a wrong recipe.
          if (ok && stream.server === 'Pixeldrain' && response.status === 404)
            probes[probes.length - 1]!.status = 'dead file (404)';
          // A playlist CDN sometimes answers 200 with an error page: that probe is a failure, not a pass.
          if (ok && stream.kind === 'hls' && !(await response.text()).includes('#EXTM3U')) {
            probes[probes.length - 1]!.status = 'not a playlist';
          }
        }
      }
      console.table(probes);
      expect(probes.length).toBeGreaterThan(0);
      for (const probe of probes) {
        if (typeof probe.status === 'string') continue;
        expect(probe.status, `${probe.server} ${probe.quality} ${probe.host}`).toSatisfy((s) => s === 200 || s === 206);
      }
      const worked = probes.filter((p) => p.status === 200 || p.status === 206);
      expect(worked.length).toBeGreaterThanOrEqual(Math.ceil(probes.length / 2));
      for (const server of ['BerkasDrive', 'Pixeldrain'])
        expect(
          worked.some((p) => p.server === server),
          server,
        ).toBe(true);
      expect(worked.some((p) => p.server.startsWith('VidHide') && p.kind === 'hls')).toBe(true);
      expect(worked.some((p) => p.server === 'Desustream')).toBe(true);
      expect(worked.some((p) => (p.quality ?? 0) >= 1080)).toBe(true);
    } finally {
      runtime.dispose();
    }
  });
});
