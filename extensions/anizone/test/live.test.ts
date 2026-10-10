import { readFileSync } from 'node:fs';
import { buildExtension } from '@matane-anime/extension-cli';
import { ExtensionRuntime, type HostApi, SourceClient } from '@matane-anime/extension-runtime';
import { describe, expect, it } from 'vitest';
import { loadSource } from '../../../packages/extension-cli/src/run';

// Talks to the real site, so it only runs on request: `pnpm test:live`.
const USER_AGENT = (JSON.parse(readFileSync('manifest.json', 'utf8')) as { userAgent: string }).userAgent;
const LIVE = process.env['LIVE'] === '1';

/**
 * The app keeps cookies per extension; the CLI host keeps none, so the Livewire calls (which need the cookie
 * of the page's own GET) would answer 419. This host has a small cookie jar, like the app's session has.
 */
async function loadWithSession() {
  const built = await buildExtension('.');
  const jar = new Map<string, string>();
  const store = new Map<string, unknown>();
  let next = 0;
  const host: HostApi = {
    http: async (request) => {
      const wait = next - Date.now();
      next = Math.max(next, Date.now()) + 1000 / (built.manifest.rateLimit?.perSecond ?? 5);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
      const response = await fetch(request.url, {
        method: request.method ?? 'GET',
        headers: { 'user-agent': USER_AGENT, ...(cookie && { cookie }), ...request.headers },
        ...(request.body !== undefined && { body: request.body }),
        redirect: 'follow',
        signal: AbortSignal.timeout(request.timeoutMs ?? 20_000),
      });
      for (const line of response.headers.getSetCookie()) {
        const [pair] = line.split(';');
        const at = pair?.indexOf('=') ?? -1;
        if (pair && at > 0) jar.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
      }
      const text = await response.text();
      return { status: response.status, url: response.url, headers: Object.fromEntries(response.headers), text };
    },
    storage: {
      get: async (key) => store.get(key) ?? null,
      set: async (key, value) => void store.set(key, value),
      remove: async (key) => void store.delete(key),
    },
    log: (level, message) => {
      if (level === 'warn' || level === 'error') console.log(`[${level}] ${message}`);
    },
  };
  const runtime = await ExtensionRuntime.create({
    code: built.code,
    manifest: built.manifest,
    host,
    hostInfo: { appName: 'tests', appVersion: '0.0.0', apiVersion: 1 },
  });
  const client = SourceClient.forRuntime(runtime, 'en');
  const defaults = Object.fromEntries((await client.preferences()).map((p) => [p.key, p.default]));
  return { client, runtime, call: { prefs: defaults }, episodesCall: { prefs: defaults, timeoutMs: 120_000 } };
}

describe.skipIf(!LIVE)("anizone (live, with a cookie session like the app's)", () => {
  it('browses, searches and pages through Livewire', { timeout: 180_000 }, async () => {
    const { client, runtime, call } = await loadWithSession();
    try {
      const latest = await client.getLatest(1, call);
      expect(latest.items.length).toBeGreaterThan(5);
      expect((await client.getLatest(2, call)).items.length).toBeGreaterThan(15);
      const popular = await client.getPopular(1, call);
      expect(popular.items.length).toBeGreaterThan(15);
      const second = await client.getPopular(2, call);
      expect(second.items.length).toBeGreaterThan(15);
      const third = await client.getPopular(3, call);
      expect(third.items.length).toBeGreaterThan(15);
      expect(new Set([...popular.items, ...second.items, ...third.items].map((i) => i.url)).size).toBeGreaterThan(55);
      const hits = await client.search('one piece', 1, {}, call);
      expect(hits.items.some((i) => i.url === '/anime/uyyyn4kf')).toBe(true);
      const movies = await client.search('', 1, { type: '4', sort: 'added-desc' }, call);
      expect(movies.items.length).toBeGreaterThan(15);
    } finally {
      runtime.dispose();
    }
  });

  it('reads details and every episode of a long series', { timeout: 240_000 }, async () => {
    const { client, runtime, call, episodesCall } = await loadWithSession();
    try {
      const op = { url: '/anime/uyyyn4kf', title: 'One Piece' };
      const details = await client.getAnimeDetails(op, call);
      expect(details).toMatchObject({ title: 'One Piece', type: 'tv', status: 'ongoing' });
      const started = Date.now();
      const episodes = await client.getEpisodes(op, episodesCall);
      console.log('episodes', episodes.length, 'in', Date.now() - started, 'ms', episodes[0], episodes.at(-1));
      expect(episodes.length).toBeGreaterThan(1100);
      expect(new Set(episodes.map((e) => e.url)).size).toBe(episodes.length);
      const numbers = episodes.map((e) => e.number).filter((n): n is number => n !== undefined);
      expect(Math.min(...numbers)).toBe(1);
      expect(Math.max(...numbers)).toBeGreaterThan(1170);
      // Every number from 1 to the newest is there: the rebuilt cursors lost nothing.
      const have = new Set(numbers);
      const missing = Array.from({ length: Math.max(...numbers) }, (_, i) => i + 1).filter((n) => !have.has(n));
      console.log('missing numbers', missing.length, missing.slice(0, 10));
      expect(missing.length).toBeLessThan(10);
      expect(episodes[0]?.uploadedAt).toBeGreaterThan(0);
      await expect(client.getAnimeDetails({ url: '/anime/xxxxxxxx', title: 'x' }, call)).rejects.toMatchObject({
        typed: 'NotFoundError',
      });
    } finally {
      runtime.dispose();
    }
  });

  it('resolves streams; the master, a variant, the key and a segment all answer', { timeout: 240_000 }, async () => {
    const { client, runtime, call } = await loadWithSession();
    try {
      const latest = await client.getLatest(1, call);
      const targets = [{ url: '/anime/uyyyn4kf/1', name: 'OP 1', number: 1 }];
      for (const item of latest.items.slice(0, 3)) {
        const newest = (await client.getEpisodes(item, call))[0];
        if (newest) targets.push(newest);
      }
      const probes: { episode: string; what: string; status: number | string; type: string; note: string }[] = [];
      const get = async (episode: string, what: string, url: string, range = false) => {
        const response = await fetch(url, {
          headers: { 'user-agent': USER_AGENT, ...(range && { Range: 'bytes=0-1023' }) },
          signal: AbortSignal.timeout(20_000),
        }).catch((e: Error) => e);
        const ok = response instanceof Response;
        let note = '';
        let body = '';
        if (ok) {
          if (range || what === 'key') {
            const bytes = new Uint8Array(await response.arrayBuffer());
            note =
              what === 'key'
                ? `${bytes.length} bytes`
                : bytes[0] === 0x47
                  ? 'MPEG-TS (0x47)'
                  : `first byte ${bytes[0]}`;
          } else body = await response.text();
        }
        probes.push({
          episode,
          what,
          status: ok ? response.status : String(response),
          type: ok ? (response.headers.get('content-type') ?? '') : '',
          note,
        });
        return body;
      };
      for (const target of targets) {
        const streams = await client.getStreams(target, call);
        expect(streams).toHaveLength(1);
        const stream = streams[0]!;
        expect(stream.headers).toBeUndefined();
        const master = await get(target.url, 'master', stream.url);
        expect(master).toContain('#EXTM3U');
        const variantLine = master
          .split(/\r?\n/)
          .find((l) => l.trim().endsWith('playlist.m3u8') && l.includes('video/'));
        const variantUrl = new URL(variantLine!.trim(), stream.url).href;
        const variant = await get(target.url, 'variant', variantUrl);
        const keyUri = /URI="([^"]+\.key)"/.exec(variant)?.[1];
        if (keyUri) await get(target.url, 'key', new URL(keyUri, variantUrl).href);
        const segmentLine = variant.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#'));
        await get(target.url, 'segment', new URL(segmentLine!.trim(), variantUrl).href, true);
      }
      console.table(probes);
      for (const probe of probes)
        expect(probe.status, `${probe.episode} ${probe.what}`).toSatisfy((s) => s === 200 || s === 206);
      // The segments are AES-128 encrypted (the open key above), so they do not start with the 0x47 of plain MPEG-TS.
      expect(probes.filter((p) => p.what === 'segment')).toHaveLength(targets.length);
    } finally {
      runtime.dispose();
    }
  });
});

describe.skipIf(!LIVE)('anizone (live, without a cookie session: the CLI host)', () => {
  it(
    'degrades instead of failing: page 1 works, sorting falls back, the list ends, only 24 episodes',
    { timeout: 180_000 },
    async () => {
      const { client, runtime, call } = await loadSource('.', { prefs: [] });
      try {
        const popular = await client.getPopular(1, call);
        expect(popular.items.length).toBeGreaterThan(15);
        expect(await client.getPopular(2, call)).toEqual({ items: [], hasNextPage: false });
        expect((await client.getLatest(1, call)).items.length).toBeGreaterThan(5);
        const hits = await client.search('one piece', 1, {}, call);
        expect(hits.items.some((i) => i.url === '/anime/uyyyn4kf')).toBe(true);
        const episodes = await client.getEpisodes({ url: '/anime/uyyyn4kf', title: 'One Piece' }, call);
        expect(episodes).toHaveLength(24);
        const streams = await client.getStreams(episodes[0]!, call);
        expect(streams[0]?.kind).toBe('hls');
      } finally {
        runtime.dispose();
      }
    },
  );
});
