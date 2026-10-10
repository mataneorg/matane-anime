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

describe.skipIf(!LIVE)('samehadaku (live)', () => {
  it('browses, searches, reads details and episodes', { timeout: 120_000 }, async () => {
    const { client, runtime, call } = await loadSource('.', { prefs: [] });
    try {
      const latest = await client.getLatest(1, call);
      expect(latest.items.length).toBeGreaterThan(10);
      const popular = await client.getPopular(1, call);
      expect(popular.items.length).toBeGreaterThan(10);
      expect(popular.hasNextPage).toBe(true);
      const hits = await client.search('one piece', 1, {}, call);
      expect(hits.items.some((i) => i.url === '/anime/one-piece/')).toBe(true);
      const genre = await client.search('', 1, { genre: 'action', status: 'ongoing' }, call);
      expect(genre.items.length).toBeGreaterThan(0);
      expect(await client.getPopular(9999, call)).toEqual({ items: [], hasNextPage: false });

      const op = { url: '/anime/one-piece/', title: 'One Piece' };
      const details = await client.getAnimeDetails(op, call);
      expect(details).toMatchObject({ title: 'One Piece', year: 1999 });
      const episodes = await client.getEpisodes(op, call);
      console.log('episodes', episodes.length, episodes[0]);
      expect(episodes.length).toBeGreaterThan(90);
      expect(episodes[0]?.number).toBeGreaterThanOrEqual(1180);
      await expect(
        client.getAnimeDetails({ url: '/anime/slug-yang-tidak-ada-xyz/', title: 'x' }, call),
      ).rejects.toMatchObject({
        typed: 'NotFoundError',
      });
    } finally {
      runtime.dispose();
    }
  });

  it('resolves streams and every one of them actually answers', { timeout: 180_000 }, async () => {
    const { client, runtime, call } = await loadSource('.', { prefs: [] });
    try {
      const op = { url: '/anime/one-piece/', title: 'One Piece' };
      const episodes = await client.getEpisodes(op, call);
      // Newest One Piece (Blogger), and the newest of the latest shows (often with extra servers).
      const latest = await client.getLatest(1, call);
      const targets = [episodes[0]!];
      for (const item of latest.items.slice(0, 4)) {
        const first = (await client.getEpisodes(item, call))[0];
        if (first) targets.push(first);
      }
      const probes: Probe[] = [];
      for (const episode of targets) {
        // A fresh episode may still have no readable server; that must be a NotFoundError, never a crash.
        const streams = await client.getStreams(episode, call).catch((e: { typed?: string }) => {
          expect(e.typed).toBe('NotFoundError');
          return [];
        });
        for (const stream of streams) {
          const response = await fetch(stream.url, {
            headers: {
              'user-agent': USER_AGENT,
              ...stream.headers,
              ...(stream.kind === 'hls' ? {} : { Range: 'bytes=0-1023' }),
            },
            signal: AbortSignal.timeout(20_000),
          }).catch((e: Error) => e);
          const ok = response instanceof Response;
          probes.push({
            server: stream.server,
            kind: stream.kind,
            quality: stream.quality,
            host: new URL(stream.url).host,
            status: ok ? response.status : String(response),
            type: ok ? (response.headers.get('content-type') ?? '') : '',
          });
          if (ok && stream.kind === 'hls') {
            const text = await response.text();
            expect(text).toContain('#EXTM3U');
          }
        }
      }
      console.table(probes);
      expect(probes.length).toBeGreaterThan(0);
      // The probe results are asserted, not just printed: every stream must answer 200/206.
      for (const probe of probes)
        expect(probe.status, `${probe.server} ${probe.host}`).toSatisfy((s) => s === 200 || s === 206);
      expect(probes.some((p) => p.kind === 'mp4' && p.type.startsWith('video/'))).toBe(true);
    } finally {
      runtime.dispose();
    }
  });
});
