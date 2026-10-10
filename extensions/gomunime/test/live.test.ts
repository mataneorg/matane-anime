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

describe.skipIf(!LIVE)('gomunime (live)', () => {
  it('browses, searches, reads details and episodes', { timeout: 120_000 }, async () => {
    const { client, runtime, call } = await loadSource('.', { prefs: [] });
    try {
      const latest = await client.getLatest(1, call);
      expect(latest.items.length).toBeGreaterThan(8);
      const latest2 = await client.getLatest(2, call);
      expect(latest2.items.length).toBeGreaterThan(10);
      const popular = await client.getPopular(1, call);
      expect(popular.items.length).toBeGreaterThan(8);
      const popular2 = await client.getPopular(2, call);
      expect(popular2.items.length).toBeGreaterThan(10);
      const hits = await client.search('one piece', 1, {}, call);
      expect(hits.items.some((i) => i.url === '/one-piece')).toBe(true);
      const genre = await client.search('', 1, { genre: 'action' }, call);
      expect(genre.items.length).toBeGreaterThan(10);
      expect(genre.hasNextPage).toBe(true);
      const movies = await client.search('', 1, { type: 'movie' }, call);
      expect(movies.items.length).toBeGreaterThan(5);
      expect(await client.search('', 9999, { status: 'completed' }, call)).toEqual({ items: [], hasNextPage: false });

      const op = { url: '/one-piece', title: 'One Piece' };
      const details = await client.getAnimeDetails(op, call);
      expect(details).toMatchObject({ title: 'One Piece', year: 1999, status: 'ongoing', type: 'tv' });
      expect(details.genres?.length).toBeGreaterThan(0);
      const episodes = await client.getEpisodes(op, call);
      console.log('episodes', episodes.length, episodes[0]);
      expect(episodes.length).toBeGreaterThan(1100);
      expect(episodes[0]?.number).toBeGreaterThanOrEqual(1159);
      await expect(client.getAnimeDetails({ url: '/slug-yang-tidak-ada-xyz', title: 'x' }, call)).rejects.toMatchObject(
        {
          typed: 'NotFoundError',
        },
      );
    } finally {
      runtime.dispose();
    }
  });

  it('resolves streams and every one of them actually answers', { timeout: 240_000 }, async () => {
    const { client, runtime, call } = await loadSource('.', { prefs: [] });
    try {
      // The newest episode of the latest shows, plus older episodes (pixeldrain, Blogger…) of a long series.
      const latest = await client.getLatest(1, call);
      const targets = [];
      for (const item of latest.items.slice(0, 4)) {
        const first = (await client.getEpisodes(item, call))[0];
        if (first) targets.push(first);
      }
      const old = await client.getEpisodes({ url: '/one-piece', title: 'One Piece' }, call);
      targets.push(old[Math.floor(old.length / 2)]!);
      // An older episode that lists pixeldrain files (found on the site; skipped if it was taken down).
      targets.push({ url: '/yano-kun-no-futsuu-no-hibi-episode-1', name: 'Episode 1', number: 1 });
      const probes: Probe[] = [];
      // Older episodes on Google Drive and mp4upload (a file may have been deleted or be over its quota: not asserted).
      for (const url of [
        '/isekai-suicide-squad-episode-9',
        '/aru-majo-ga-shinu-made-episode-1',
        '/one-piece-episode-518',
      ])
        targets.push({ url, name: 'Episode', number: 1 });
      for (const episode of targets) {
        // An episode may only have servers the app cannot read; that must be a NotFoundError, never a crash.
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
          if (ok && stream.kind === 'hls') expect(await response.text()).toContain('#EXTM3U');
        }
      }
      console.table(probes);
      expect(probes.length).toBeGreaterThan(0);
      // The probe results are asserted, not just printed: a stream that connects must answer 200/206 (a 403/404
      // means the recipe is wrong). Only a network failure (the cache node is unreachable from here) is tolerated.
      for (const probe of probes) {
        if (typeof probe.status === 'string') continue;
        expect(probe.status, `${probe.server} ${probe.host}`).toSatisfy((s) => s === 200 || s === 206);
      }
      const worked = probes.filter((p) => p.status === 200 || p.status === 206);
      expect(worked.length).toBeGreaterThanOrEqual(Math.ceil(probes.length / 2));
      expect(worked.some((p) => p.kind === 'hls')).toBe(true);
      expect(worked.some((p) => p.server === 'Pixeldrain')).toBe(true);
      // gdplayer (new episodes) and gdriveplayer (/one-piece-episode-840) are read for real.
      expect(worked.some((p) => p.server === 'Gdriveplayer')).toBe(true);
      expect(worked.filter((p) => p.server === 'Mp4upload').length).toBeGreaterThan(0);
      expect(worked.some((p) => p.kind === 'mp4' && p.type.startsWith('video/'))).toBe(true);
    } finally {
      runtime.dispose();
    }
  });
});
