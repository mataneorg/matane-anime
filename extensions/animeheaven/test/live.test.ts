import { readFileSync } from 'node:fs';
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import type { Stream } from '@matane-anime/extension-sdk';
import { describe, expect, it } from 'vitest';
import { loadSource } from '../../../packages/extension-cli/src/run';

// Talks to the real site, so it only runs on request: `pnpm test:live`.
const USER_AGENT = (JSON.parse(readFileSync('manifest.json', 'utf8')) as { userAgent: string }).userAgent;
// The CDN is far away: Node's 250 ms per-address connect budget is too short for it on an IPv4-only network.
setDefaultAutoSelectFamilyAttemptTimeout(3000);
const LIVE = process.env['LIVE'] === '1';

interface Probe {
  episode: string;
  host: string;
  status: number | string;
  type: string;
  range: string;
  file: string;
}

describe.skipIf(!LIVE)('animeheaven (live)', () => {
  it('browses, searches, reads details and episodes', { timeout: 120_000 }, async () => {
    const { client, runtime, call } = await loadSource('.', { prefs: [] });
    try {
      const latest = await client.getLatest(1, call);
      expect(latest.items.length).toBeGreaterThan(20);
      const popular = await client.getPopular(1, call);
      expect(popular.items.length).toBe(50);
      expect(popular.hasNextPage).toBe(true);
      const hits = await client.search('one piece', 1, {}, call);
      expect(hits.items.some((i) => /^One Piece/.test(i.title))).toBe(true);
      const tagged = await client.search('', 1, { tag: 'Action' }, call);
      expect(tagged.items.length).toBe(50);
      expect(tagged.hasNextPage).toBe(true);

      const op = hits.items.find((i) => i.title === 'One Piece') ?? hits.items[0]!;
      const details = await client.getAnimeDetails(op, call);
      expect(details.title.length).toBeGreaterThan(0);
      expect(details.genres?.length).toBeGreaterThan(0);
      const episodes = await client.getEpisodes(op, call);
      expect(episodes.length).toBeGreaterThan(100);
      expect(episodes[0]!.number!).toBeGreaterThan(episodes[episodes.length - 1]!.number!);
      expect(episodes[0]!.url).toMatch(/^[0-9a-f]{32}$/);
      await expect(client.getAnimeDetails({ url: '/anime.php?zzzzz', title: 'x' }, call)).rejects.toMatchObject({
        typed: 'NotFoundError',
      });
    } finally {
      runtime.dispose();
    }
  });

  it(
    'sends the Cookie through http.get and the mp4 answers a Range request with 206',
    { timeout: 180_000 },
    async () => {
      const { client, runtime, call } = await loadSource('.', { prefs: [] });
      try {
        const latest = await client.getLatest(1, call);
        const targets = [];
        for (const item of latest.items.slice(0, 3)) {
          const newest = (await client.getEpisodes(item, call))[0];
          if (newest) targets.push(newest);
        }
        expect(targets.length).toBeGreaterThan(0);
        const probes: Probe[] = [];
        for (const episode of targets) {
          // The site hands out one of several CDN nodes per request and some are unreachable from some networks:
          // ask again (a new node) a few times before failing.
          let stream: Stream | undefined;
          let response: Response | undefined;
          let bytes = new Uint8Array();
          for (let attempt = 0; attempt < 4 && !response; attempt++) {
            const streams = await client.getStreams(episode, call);
            expect(streams).toHaveLength(1);
            stream = streams[0]!;
            expect(stream).toMatchObject({ kind: 'mp4', quality: 1080, server: 'AnimeHeaven' });
            expect(stream.url).toContain(episode.url);
            response = await fetch(stream.url, {
              headers: { 'user-agent': USER_AGENT, Range: 'bytes=0-1023' },
              signal: AbortSignal.timeout(15_000),
            }).catch(() => undefined);
            if (response) bytes = new Uint8Array(await response.arrayBuffer());
          }
          if (!stream || !response) throw new Error(`No CDN node answered for ${episode.url}`);
          probes.push({
            episode: episode.url.slice(0, 8),
            host: new URL(stream.url).host,
            status: response.status,
            type: response.headers.get('content-type') ?? '',
            range: response.headers.get('content-range') ?? '',
            file: /filename="?([^";]+)/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? '',
          });
          expect(response.status).toBe(206);
          expect(response.headers.get('content-type')).toMatch(/video\/mp4/);
          expect(bytes.length).toBe(1024);
          expect(String.fromCharCode(...bytes.slice(4, 8))).toBe('ftyp');
        }
        console.table(probes);
        // The 1080p claim: the release name says so.
        expect(probes.some((p) => /1080p/.test(p.file))).toBe(true);
      } finally {
        runtime.dispose();
      }
    },
  );
});
