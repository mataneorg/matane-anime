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

describe.skipIf(!LIVE)('animeindo (live)', () => {
  it('browses, searches, reads details and episodes', { timeout: 120_000 }, async () => {
    const { client, runtime, call } = await loadSource('.', { prefs: [] });
    try {
      const latest = await client.getLatest(1, call);
      expect(latest.items.length).toBeGreaterThan(8);
      expect(latest.hasNextPage).toBe(true);
      const latest2 = await client.getLatest(2, call);
      expect(latest2.items.length).toBeGreaterThan(8);
      const popular = await client.getPopular(1, call);
      expect(popular.items.length).toBe(7);
      const hits = await client.search('one piece', 1, {}, call);
      expect(hits.items.some((i) => i.url === '/anime/one-piece/')).toBe(true);
      const genre = await client.search('', 1, { genre: 'action' }, call);
      expect(genre.items.length).toBeGreaterThan(10);
      expect(genre.hasNextPage).toBe(true);
      const movies = await client.search('', 2, { type: 'movie' }, call);
      expect(movies.items.length).toBeGreaterThan(10);
      expect(await client.search('', 9999, { type: 'movie' }, call)).toEqual({ items: [], hasNextPage: false });

      const op = { url: '/anime/one-piece/', title: 'One Piece' };
      const details = await client.getAnimeDetails(op, call);
      expect(details.title).toBe('One Piece');
      expect(details.genres?.length).toBeGreaterThan(0);
      const episodes = await client.getEpisodes(op, call);
      console.log('episodes', episodes.length, episodes[0]);
      expect(episodes.length).toBeGreaterThan(1100);
      expect(episodes[0]?.number).toBeGreaterThanOrEqual(1151);
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
      // The newest episodes (btube, cepat) plus older ones (hls.php, mp4upload, yourupload) of a few series.
      const latest = await client.getLatest(1, call);
      const targets = [];
      for (const item of latest.items.slice(0, 3)) {
        const first = (await client.getEpisodes(item, call))[0];
        if (first) targets.push(first);
      }
      for (const url of [
        '/show-by-rock-stars-episode-06/',
        '/one-piece-episode-518/',
        '/one-piece-episode-019/',
        '/one-piece-episode-840/',
        '/sora-no-otoshimono-episode-01/',
        '/osananajimi-ga-zettai-ni-makenai-love-comedy-episode-01/',
      ])
        targets.push({ url, name: 'Episode', number: 1 });
      const probes: Probe[] = [];
      for (const episode of targets) {
        // An episode may only have dead files or servers the app cannot read: a NotFoundError, never a crash.
        const streams = await client.getStreams(episode, call).catch((e: { typed?: string; message?: string }) => {
          if (e.typed !== 'NotFoundError') console.log('FAILED', episode.url, e.typed, e.message);
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
          if (ok && stream.kind === 'hls') expect(await response.text()).toContain('#EXTM3U');
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
      expect(worked.some((p) => p.kind === 'hls')).toBe(true);
      expect(worked.some((p) => p.server === 'Yourupload')).toBe(true);
      expect(worked.some((p) => p.server.startsWith('Mp4upload'))).toBe(true);
      expect(worked.some((p) => p.kind === 'mp4' && p.type.startsWith('video/'))).toBe(true);
    } finally {
      runtime.dispose();
    }
  });
});
