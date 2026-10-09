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

describe.skipIf(!LIVE)('kaa (live)', () => {
  it('browses, searches, reads details and episodes (sub and dub)', { timeout: 120_000 }, async () => {
    const { client, runtime, call } = await loadSource('.', { prefs: [] });
    try {
      const latest = await client.getLatest(1, call);
      expect(latest.items.length).toBeGreaterThan(20);
      expect(latest.hasNextPage).toBe(true);
      const popular = await client.getPopular(1, call);
      expect(popular.items.length).toBeGreaterThan(20);
      expect((await client.getPopular(2, call)).items.length).toBeGreaterThan(20);
      const hits = await client.search('one piece', 1, {}, call);
      expect(hits.items.some((i) => /one piece/i.test(i.title))).toBe(true);
      const filtered = await client.search('', 1, { genre: 'Action', type: 'tv', list: 'top' }, call);
      expect(filtered.items.length).toBeGreaterThan(0);

      const op = hits.items.find((i) => /^one piece$/i.test(i.title)) ?? hits.items[0]!;
      const details = await client.getAnimeDetails(op, call);
      expect(details.genres?.length).toBeGreaterThan(0);
      const episodes = await client.getEpisodes(op, call);
      console.log('episodes', op.title, episodes.length, episodes[0], episodes.at(-1));
      expect(episodes.length).toBeGreaterThan(100);
      expect(episodes.some((e) => e.variant === 'Sub')).toBe(true);
      expect(episodes.some((e) => e.variant === 'Dub')).toBe(true);
      await expect(client.getAnimeDetails({ url: 'slug-yang-tidak-ada-xyz', title: 'x' }, call)).rejects.toMatchObject({
        typed: 'NotFoundError',
      });
    } finally {
      runtime.dispose();
    }
  });

  it('resolves streams; the master, a variant and a segment all answer', { timeout: 240_000 }, async () => {
    const { client, runtime, call } = await loadSource('.', { prefs: [] });
    try {
      const latest = await client.getLatest(1, call);
      const targets = [];
      for (const item of latest.items.slice(0, 6)) {
        const first = (await client.getEpisodes(item, call))[0];
        if (first) targets.push(first);
      }
      // The newest episode of a show that has a dub, in both variants.
      const dubbed = await client.getEpisodes({ url: 'one-piece-0948', title: 'One Piece' }, call).catch(() => []);
      targets.push(...dubbed.filter((e) => e.number === dubbed[0]?.number).slice(0, 2));

      const probes: Probe[] = [];
      let noOrigin: number | undefined;
      for (const episode of targets) {
        // A fresh episode (or an unreleased dub) may have no server: NotFoundError, never a crash.
        const streams = await client.getStreams(episode, call).catch((e: { typed?: string }) => {
          expect(e.typed).toBe('NotFoundError');
          return [];
        });
        for (const stream of streams) {
          const headers = { 'user-agent': USER_AGENT, ...stream.headers };
          const probe = async (what: string, url: string, range: boolean): Promise<string | undefined> => {
            const response = await fetch(url, {
              headers: { ...headers, ...(range ? { Range: 'bytes=0-1023' } : {}) },
              signal: AbortSignal.timeout(20_000),
            }).catch((e: Error) => e);
            const ok = response instanceof Response;
            let note = '';
            let body: string | undefined;
            if (ok && !range) body = await response.text();
            if (ok && range) {
              const bytes = new Uint8Array(await response.arrayBuffer());
              // MPEG-TS packets start with 0x47; the CDN labels them image/jpeg.
              note = bytes[0] === 0x47 ? 'MPEG-TS (0x47)' : `first byte ${bytes[0]}`;
            }
            probes.push({
              server: stream.server,
              what,
              host: new URL(url).host,
              status: ok ? response.status : String(response),
              type: ok ? (response.headers.get('content-type') ?? '') : '',
              note,
            });
            return body;
          };
          const master = await probe('master', stream.url, false);
          expect(master ?? '').toContain('#EXTM3U');
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
          if (noOrigin === undefined) {
            const bare = await fetch(stream.url, { headers: { 'user-agent': USER_AGENT } }).catch(() => undefined);
            noOrigin = bare?.status;
          }
        }
      }
      console.table(probes);
      console.log('master without Origin answers', noOrigin);
      expect(probes.length).toBeGreaterThan(0);
      for (const probe of probes) {
        if (typeof probe.status === 'string') continue;
        expect(probe.status, `${probe.server} ${probe.what} ${probe.host}`).toSatisfy((s) => s === 200 || s === 206);
      }
      expect(
        probes.filter((p) => p.what === 'segment' && (p.status === 200 || p.status === 206)).length,
      ).toBeGreaterThan(0);
      expect(probes.some((p) => p.what === 'segment' && p.note.startsWith('MPEG-TS'))).toBe(true);
    } finally {
      runtime.dispose();
    }
  });
});
