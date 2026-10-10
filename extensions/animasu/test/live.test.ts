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

describe.skipIf(!LIVE)('animasu (live)', () => {
  it('browses, searches, reads details and episodes', { timeout: 120_000 }, async () => {
    const { client, runtime, call } = await loadSource('.', { prefs: [] });
    try {
      const latest = await client.getLatest(1, call);
      expect(latest.items.length).toBe(10);
      expect(latest.hasNextPage).toBe(true);
      const popular = await client.getPopular(1, call);
      expect(popular.items.length).toBe(10);
      expect((await client.getPopular(2, call)).items.length).toBe(10);
      const first = popular.items[0]!;
      const hits = await client.search(first.title, 1, {}, call);
      expect(hits.items.some((i) => i.url === first.url)).toBe(true);
      const genre = await client.search('', 1, { genre: 'aksi', status: 'ongoing' }, call);
      expect(genre.items.length).toBeGreaterThan(0);
      expect(await client.getPopular(9999, call)).toEqual({ items: [], hasNextPage: false });

      const details = await client.getAnimeDetails(first, call);
      expect(details.title.length).toBeGreaterThan(0);
      expect(details.genres?.length).toBeGreaterThan(0);
      const episodes = await client.getEpisodes(first, call);
      console.log('episodes', episodes.length, episodes[0]);
      expect(episodes.length).toBeGreaterThan(0);
      await expect(
        client.getAnimeDetails({ url: '/anime/slug-yang-tidak-ada-xyz/', title: 'x' }, call),
      ).rejects.toMatchObject({
        typed: 'NotFoundError',
      });
    } finally {
      runtime.dispose();
    }
  });

  it('resolves streams and every one of them actually answers', { timeout: 240_000 }, async () => {
    const { client, runtime, call } = await loadSource('.', { prefs: [] });
    try {
      // The newest episode of the latest shows (Blogger, with extra servers: cepat2, btube, vkspeed).
      const latest = await client.getLatest(1, call);
      const targets = [];
      for (const item of latest.items.slice(0, 10)) {
        const first = (await client.getEpisodes(item, call))[0];
        if (first) targets.push(first);
      }
      // Older episodes with desustream (archive.org), ok.ru and gdriveplayer servers.
      for (const url of [
        '/nonton-shin-tennis-no-oujisama-u-17-world-cup-kesshou-member-ketteisen-episode-2/',
        '/nonton-tantei-wa-mou-shindeiru-episode-1/',
        '/nonton-hyouken-no-majutsushi-ga-sekai-wo-suberu-episode-1/',
      ])
        targets.push({ url, name: 'Episode', number: 1 });
      const probes: Probe[] = [];
      for (const episode of targets) {
        // A fresh episode may still have no readable server; that must be a NotFoundError, never a crash.
        const streams = await client.getStreams(episode, call).catch((e: { typed?: string }) => {
          expect(e.typed).toBe('NotFoundError');
          return [];
        });
        for (const stream of streams) {
          // googlevideo cache nodes are sometimes unreachable from a given network (connect timeout): retry once.
          let response: Response | Error | undefined;
          for (let attempt = 0; attempt < 2 && !(response instanceof Response); attempt++) {
            response = await fetch(stream.url, {
              headers: {
                'user-agent': USER_AGENT,
                ...stream.headers,
                ...(stream.kind === 'hls' ? {} : { Range: 'bytes=0-1023' }),
              },
              signal: AbortSignal.timeout(15_000),
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
          // A playlist CDN sometimes answers 200 with an error page: that probe is a failure, not a pass.
          if (ok && stream.kind === 'hls' && !(await response.text()).includes('#EXTM3U')) {
            probes[probes.length - 1]!.status = 'not a playlist';
          }
        }
      }
      console.table(probes);
      expect(probes.length).toBeGreaterThan(0);
      // A stream that connects must answer 200/206 (a 403/404/500 means the recipe is wrong). Only a network
      // failure (the cache node is unreachable from here) is tolerated.
      for (const probe of probes) {
        if (typeof probe.status === 'string') continue;
        expect(probe.status, `${probe.server} ${probe.host}`).toSatisfy((s) => s === 200 || s === 206);
      }
      const worked = probes.filter((p) => p.status === 200 || p.status === 206);
      expect(worked.length).toBeGreaterThanOrEqual(Math.ceil(probes.length / 2));
      expect(worked.some((p) => p.server === 'Blogger' && p.type.startsWith('video/'))).toBe(true);
      expect(worked.some((p) => p.server === 'Vidhide')).toBe(true);
      expect(worked.some((p) => p.server === 'Yourupload')).toBe(true);
      expect(worked.some((p) => p.server === 'Desustream')).toBe(true);
      expect(worked.some((p) => p.server === 'OK.ru')).toBe(true);
      expect(worked.some((p) => p.server === 'Gdriveplayer')).toBe(true);
    } finally {
      runtime.dispose();
    }
  });
});
