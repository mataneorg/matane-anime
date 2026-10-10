import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadSource } from '../../../packages/extension-cli/src/run';

// Talks to the real site, so it only runs on request: `pnpm test:live`.
const USER_AGENT = (JSON.parse(readFileSync('manifest.json', 'utf8')) as { userAgent: string }).userAgent;
const LIVE = process.env['LIVE'] === '1';

interface Probe {
  server: string;
  quality: number | undefined;
  host: string;
  status: number | string;
  type: string;
}

describe.skipIf(!LIVE)('anisail (live)', () => {
  it('browses, searches, reads details and episodes', { timeout: 120_000 }, async () => {
    const { client, runtime, call } = await loadSource('.', { prefs: [] });
    try {
      const latest = await client.getLatest(1, call);
      expect(latest.items.length).toBeGreaterThan(5);
      expect((await client.getLatest(2, call)).items.length).toBeGreaterThan(5);
      // Every series derived from an episode card must exist.
      for (const item of latest.items.slice(0, 4)) {
        expect((await client.getAnimeDetails(item, call)).title.length).toBeGreaterThan(0);
      }
      const popular = await client.getPopular(1, call);
      expect(popular.items.length).toBeGreaterThan(3);
      expect(popular.items.some((i) => i.url === '/anime/one-piece/')).toBe(true);
      const hits = await client.search('one piece', 1, {}, call);
      expect(hits.items.some((i) => i.url === '/anime/one-piece/')).toBe(true);
      const genre = await client.search('', 1, { genre: 'action' }, call);
      expect(genre.items.length).toBeGreaterThan(20);
      expect(genre.hasNextPage).toBe(true);
      expect((await client.search('', 2, { genre: 'action' }, call)).items.length).toBeGreaterThan(20);
      expect((await client.search('', 1, { type: 'movie' }, call)).items.length).toBeGreaterThan(10);
      expect(await client.search('', 99999, { genre: 'action' }, call)).toEqual({ items: [], hasNextPage: false });

      const op = { url: '/anime/one-piece/', title: 'One Piece' };
      const details = await client.getAnimeDetails(op, call);
      expect(details).toMatchObject({ title: 'One Piece', status: 'ongoing', type: 'tv' });
      const episodes = await client.getEpisodes(op, call);
      console.log('episodes', episodes.length, episodes[0]);
      expect(episodes.length).toBeGreaterThan(1000);
      await expect(
        client.getAnimeDetails({ url: '/anime/slug-yang-tidak-ada-xyz/', title: 'x' }, call),
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
      // The newest episodes of the latest shows (all four hosts, four qualities each).
      const latest = await client.getLatest(1, call);
      const targets = [];
      for (const item of latest.items.slice(0, 3)) {
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
        // One probe per host and quality is enough.
        const seen = new Set<string>();
        for (const stream of streams) {
          const key = `${stream.server}/${stream.quality}`;
          if (seen.has(key)) continue;
          seen.add(key);
          let response: Response | Error | undefined;
          for (let attempt = 0; attempt < 2 && !(response instanceof Response); attempt++) {
            response = await fetch(stream.url, {
              headers: { 'user-agent': USER_AGENT, ...stream.headers, Range: 'bytes=0-1023' },
              signal: AbortSignal.timeout(20_000),
            }).catch((e: Error) => e);
          }
          const ok = response instanceof Response;
          probes.push({
            server: stream.server,
            quality: stream.quality,
            host: new URL(stream.url).host,
            status: ok ? response.status : String(response),
            type: ok ? (response.headers.get('content-type') ?? '') : '',
          });
        }
      }
      console.table(probes);
      expect(probes.length).toBeGreaterThan(0);
      // A stream that connects must answer 200/206 (a 403/404 means the recipe is wrong).
      for (const probe of probes) {
        if (typeof probe.status === 'string') continue;
        expect(probe.status, `${probe.server} ${probe.quality} ${probe.host}`).toSatisfy((s) => s === 200 || s === 206);
      }
      const worked = probes.filter((p) => p.status === 200 || p.status === 206);
      expect(worked.length).toBeGreaterThanOrEqual(Math.ceil(probes.length / 2));
      for (const server of ['Pixeldrain', 'Mixdrop', 'Mp4upload']) {
        expect(
          worked.some((p) => p.server === server),
          server,
        ).toBe(true);
      }
      expect(worked.some((p) => (p.quality ?? 0) >= 1080)).toBe(true);
    } finally {
      runtime.dispose();
    }
  });
});
