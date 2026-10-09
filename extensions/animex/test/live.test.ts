import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadSource } from '../../../packages/extension-cli/src/run';

// Talks to the real backends, so it only runs on request: `pnpm test:live`.
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

describe.skipIf(!LIVE)('animex (live)', () => {
  it('browses, searches, reads details and episodes (sub and dub)', { timeout: 120_000 }, async () => {
    const { client, runtime, call } = await loadSource('.', { prefs: [] });
    try {
      const popular = await client.getPopular(1, call);
      expect(popular.items.length).toBeGreaterThan(20);
      expect(popular.hasNextPage).toBe(true);
      expect((await client.getPopular(2, call)).items.length).toBeGreaterThan(20);
      const latest = await client.getLatest(1, call);
      expect(latest.items.length).toBeGreaterThan(15);
      const hits = await client.search('attack on titan', 1, {}, call);
      expect(hits.items.some((i) => i.url === 'attack-on-titan-2jqd0')).toBe(true);
      const filtered = await client.search(
        '',
        1,
        { genre: 'Action', format: 'MOVIE', year: '2020', audio: 'DUB' },
        call,
      );
      expect(filtered.items.length).toBeGreaterThan(0);

      const aot = { url: 'attack-on-titan-2jqd0', title: 'Attack on Titan' };
      const details = await client.getAnimeDetails(aot, call);
      expect(details).toMatchObject({ title: 'Attack on Titan', year: 2013, status: 'completed', type: 'tv' });
      const episodes = await client.getEpisodes(aot, call);
      expect(episodes.length).toBeGreaterThanOrEqual(50);
      expect(episodes.some((e) => e.variant === 'Dub')).toBe(true);
      expect(episodes.every((e) => e.uploadedAt === undefined || e.uploadedAt > 0)).toBe(true);
      await expect(client.getAnimeDetails({ url: 'slug-yang-tidak-ada-xyz', title: 'x' }, call)).rejects.toMatchObject({
        typed: 'NotFoundError',
      });
    } finally {
      runtime.dispose();
    }
  });

  it(
    'resolves streams; the master, a variant and a segment all answer with the stream headers',
    { timeout: 300_000 },
    async () => {
      const { client, runtime, call } = await loadSource('.', { prefs: [] });
      try {
        const targets = [
          { url: 'attack-on-titan-2jqd0/1/sub', name: 'AoT 1', number: 1 },
          { url: 'attack-on-titan-2jqd0/1/dub', name: 'AoT 1 dub', number: 1 },
          // A title whose providers are loli and sora, and one with the krussdomi sora.
          { url: 'hyouken-no-majutsushi-ga-sekai-wo-suberu-ii-cfodp/1/sub', name: 'Hyouken 1', number: 1 },
          { url: 'shiguang-dailiren-iii-fh9sk/1/sub', name: 'Shiguang 1', number: 1 },
        ];
        const latest = await client.getLatest(1, call);
        for (const item of latest.items.slice(0, 2)) {
          const newest = (await client.getEpisodes(item, call))[0];
          if (newest) targets.push(newest);
        }
        const probes: Probe[] = [];
        for (const episode of targets) {
          // An episode may have no readable provider: a NotFoundError, never a crash.
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
                note = bytes[0] === 0x47 ? 'MPEG-TS (0x47)' : `first byte ${bytes[0]}`;
              }
              probes.push({
                server: `${episode.url.split('/').slice(1).join('/')} ${stream.server}`,
                what,
                host: new URL(url).host,
                status: ok ? response.status : String(response),
                type: ok ? (response.headers.get('content-type') ?? '') : '',
                note,
              });
              return body;
            };
            const master = await probe('master', stream.url, false);
            if (!(master ?? '').includes('#EXTM3U')) {
              probes[probes.length - 1]!.status = 'not a playlist';
              continue;
            }
            const variantUrl = firstUri(
              (master ?? '')
                .split('\n')
                .filter((l) => !l.startsWith('#EXT-X-MEDIA'))
                .join('\n'),
              stream.url,
            );
            const variant = variantUrl ? await probe('variant', variantUrl, false) : undefined;
            const segment = variantUrl && variant ? firstUri(variant, variantUrl) : undefined;
            if (segment) await probe('segment', segment, true);
          }
        }
        console.table(probes);
        expect(probes.length).toBeGreaterThan(0);
        // A stream that connects must answer 200/206 (a 403/404 means the headers or the recipe are wrong).
        for (const probe of probes) {
          if (typeof probe.status === 'string') continue;
          expect(probe.status, `${probe.server} ${probe.what} ${probe.host}`).toSatisfy((s) => s === 200 || s === 206);
        }
        const worked = probes.filter((p) => p.status === 200 || p.status === 206);
        expect(worked.length).toBeGreaterThanOrEqual(Math.ceil(probes.length / 2));
        for (const provider of ['nero', 'yuki']) {
          expect(
            worked.some((p) => p.server.endsWith(provider) && p.what === 'segment'),
            provider,
          ).toBe(true);
        }
        expect(worked.some((p) => p.what === 'segment' && p.note.startsWith('MPEG-TS'))).toBe(true);
      } finally {
        runtime.dispose();
      }
    },
  );
});
