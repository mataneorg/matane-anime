import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadSource } from '../../../packages/extension-cli/src/run';

// Talks to the real site, so it only runs on request: `pnpm test:live`.
const USER_AGENT = (JSON.parse(readFileSync('manifest.json', 'utf8')) as { userAgent: string }).userAgent;
const LIVE = process.env['LIVE'] === '1';

interface Probe {
  server: string;
  what: string;
  host: string;
  status: number | string;
  type: string;
  note: string;
}

/** The first non-comment line of a playlist, as an absolute address. */
const firstUri = (playlist: string, from: string): string | undefined => {
  const line = playlist.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#'));
  return line ? new URL(line.trim(), from).href : undefined;
};

describe.skipIf(!LIVE)('gogoanime (live)', () => {
  it('browses, searches, reads details and episodes (sub and dub)', { timeout: 120_000 }, async () => {
    const { client, runtime, call } = await loadSource('.', { prefs: [] });
    try {
      const latest = await client.getLatest(1, call);
      expect(latest.items.length).toBe(20);
      expect(latest.hasNextPage).toBe(true);
      const popular = await client.getPopular(1, call);
      expect(popular.items.length).toBe(20);
      expect((await client.getPopular(2, call)).items.length).toBe(20);
      const hits = await client.search('steel ball run', 1, {}, call);
      expect(hits.items.some((i) => i.url === '/series/steel-ball-run-jojo-no-kimyou-na-bouken/')).toBe(true);
      const dubs = await client.search('one piece dubbed', 1, {}, call);
      expect(dubs.items.some((i) => /dubbed/.test(i.url))).toBe(true);
      const genre = await client.search('', 1, { genre: 'action', status: 'ongoing' }, call);
      expect(genre.items.length).toBeGreaterThan(0);
      expect(await client.getPopular(9999, call)).toEqual({ items: [], hasNextPage: false });

      const sbr = { url: '/series/steel-ball-run-jojo-no-kimyou-na-bouken/', title: 'Steel Ball Run' };
      const details = await client.getAnimeDetails(sbr, call);
      expect(details).toMatchObject({ year: 2026, status: 'ongoing', type: 'tv' });
      expect(details.genres?.length).toBeGreaterThan(0);
      const episodes = await client.getEpisodes(sbr, call);
      expect(episodes.length).toBeGreaterThanOrEqual(4);
      expect(episodes.every((e) => e.variant === 'Sub')).toBe(true);
      const dub = await client.getEpisodes(
        { url: '/series/one-piece-english-dubbed-online/', title: 'One Piece' },
        call,
      );
      expect(dub.length).toBeGreaterThan(1000);
      expect(dub[0]?.variant).toBe('Dub');
      await expect(
        client.getAnimeDetails({ url: '/series/slug-yang-tidak-ada-xyz/', title: 'x' }, call),
      ).rejects.toMatchObject({
        typed: 'NotFoundError',
      });
    } finally {
      runtime.dispose();
    }
  });

  it('resolves streams; the playlists and a segment (or the mp4) answer', { timeout: 300_000 }, async () => {
    const { client, runtime, call } = await loadSource('.', { prefs: [] });
    try {
      const targets = [
        { url: '/steel-ball-run-jojo-no-kimyou-na-bouken-episode-4-english-subbed/', name: 'SBR 4', number: 4 },
        { url: '/one-piece-episode-1123-english-dubbed/', name: 'OP dub 1123', number: 1123 },
      ];
      const latest = await client.getLatest(1, call);
      for (const item of latest.items.slice(0, 3)) {
        const newest = (await client.getEpisodes(item, call))[0];
        if (newest) targets.push(newest);
      }
      const probes: Probe[] = [];
      for (const episode of targets) {
        // An episode may have no readable server: a NotFoundError, never a crash.
        const streams = await client.getStreams(episode, call).catch((e: { typed?: string }) => {
          expect(e.typed).toBe('NotFoundError');
          return [];
        });
        for (const stream of streams) {
          const headers = { 'user-agent': USER_AGENT, ...stream.headers };
          const probe = async (what: string, url: string, range: boolean): Promise<string | undefined> => {
            let response: Response | Error | undefined;
            for (let attempt = 0; attempt < 2 && !(response instanceof Response); attempt++) {
              response = await fetch(url, {
                headers: { ...headers, ...(range ? { Range: 'bytes=0-1023' } : {}) },
                signal: AbortSignal.timeout(20_000),
              }).catch((e: Error) => e);
            }
            const ok = response instanceof Response;
            let note = '';
            let body: string | undefined;
            if (ok && !range) body = await response.text();
            if (ok && range) {
              const bytes = new Uint8Array(await response.arrayBuffer());
              note = bytes[0] === 0x47 ? 'MPEG-TS (0x47)' : bytes[4] === 0x66 ? 'mp4 (ftyp)' : `first byte ${bytes[0]}`;
            }
            probes.push({
              server: `${episode.url.slice(1, 28)} ${stream.server}`,
              what,
              host: new URL(url).host,
              status: ok ? response.status : String(response),
              type: ok ? (response.headers.get('content-type') ?? '') : '',
              note,
            });
            return body;
          };
          if (stream.kind !== 'hls') {
            await probe('mp4', stream.url, true);
            continue;
          }
          const master = await probe('playlist', stream.url, false);
          if (!(master ?? '').includes('#EXTM3U')) {
            probes[probes.length - 1]!.status = 'not a playlist';
            continue;
          }
          let media = stream.url;
          let text = master ?? '';
          // A master names variants: follow the first one to a media playlist.
          if (text.includes('#EXT-X-STREAM-INF')) {
            const variantUrl = firstUri(
              text
                .split('\n')
                .filter((l) => !l.startsWith('#EXT-X-MEDIA'))
                .join('\n'),
              stream.url,
            );
            const variant = variantUrl ? await probe('variant', variantUrl, false) : undefined;
            if (!variantUrl || !variant) continue;
            media = variantUrl;
            text = variant;
          }
          const segment = firstUri(text, media);
          if (segment) await probe('segment', segment, true);
        }
      }
      console.table(probes);
      expect(probes.length).toBeGreaterThan(0);
      // A stream that connects must answer 200/206 (a 403/404 means the recipe is wrong).
      for (const probe of probes) {
        if (typeof probe.status === 'string') continue;
        expect(probe.status, `${probe.server} ${probe.what} ${probe.host}`).toSatisfy((s) => s === 200 || s === 206);
      }
      const worked = probes.filter((p) => p.status === 200 || p.status === 206);
      expect(worked.length).toBeGreaterThanOrEqual(Math.ceil(probes.length / 2));
      // The googlevideo cache nodes are often unreachable from a given network (connect timeout): the SD mp4 is only
      // asserted when one of its probes got through.
      const mp4s = probes.filter((p) => p.what === 'mp4' && typeof p.status === 'number');
      if (mp4s.length > 0) expect(mp4s.some((p) => p.note.startsWith('mp4'))).toBe(true);
      expect(worked.some((p) => p.server.endsWith('HD') && p.what === 'segment')).toBe(true);
      expect(worked.some((p) => p.server.endsWith('Mega') && p.what === 'segment')).toBe(true);
    } finally {
      runtime.dispose();
    }
  });
});
