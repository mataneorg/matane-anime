import { appendFileSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadSource } from '../../../packages/extension-cli/src/run';

// Talks to the real site, so it only runs on request: `pnpm test:live`. The CLI's host keeps to the
// manifest's 2 requests per second; the checks below are few and spaced by that limit.
// Some media hosts (googlevideo) refuse a request without a browser User-Agent; the app sends the manifest's.
const USER_AGENT = (JSON.parse(readFileSync('manifest.json', 'utf8')) as { userAgent: string }).userAgent;
const LIVE = process.env['LIVE'] === '1';
const show = (label: string, value: unknown) => {
  const line = `${label}: ${JSON.stringify(value)}`;
  console.log(line);
  if (process.env['LIVE_LOG']) appendFileSync(process.env['LIVE_LOG'], `${line}\n`);
};

describe.skipIf(!LIVE)('otakudesu.blog (live)', () => {
  it('browses, searches, reads details and episodes, and resolves streams', { timeout: 180_000 }, async () => {
    const { client, runtime, call, host } = await loadSource('.', { prefs: [] });
    try {
      const latest = await client.getLatest(1, call);
      show('getLatest(1)', { items: latest.items.length, next: latest.hasNextPage, first: latest.items[0] });
      expect(latest.items.length).toBeGreaterThan(0);
      const latest2 = await client.getLatest(2, call);
      show('getLatest(2)', { items: latest2.items.length, first: latest2.items[0]?.title });

      const done = await client.getPopular(1, call);
      show('getPopular(1)', { items: done.items.length, first: done.items[0]?.title });

      const hits = await client.search('naruto', 1, {}, call);
      show(
        'search(naruto)',
        hits.items.map((i) => `${i.title} ${i.url}`),
      );
      expect(hits.items.length).toBeGreaterThan(0);
      const none = await client.search('zzzxqwkj', 1, {}, call);
      show('search(zzzxqwkj)', none);
      expect(none.items).toHaveLength(0);
      show('search(naruto, page 2)', await client.search('naruto', 2, {}, call));
      const genre = await client.search('', 1, { genre: 'action' }, call);
      show('search("", genre=action)', {
        items: genre.items.length,
        next: genre.hasNextPage,
        first: genre.items[0]?.title,
      });

      const anime = latest.items[0]!;
      const details = await client.getAnimeDetails(anime, call);
      show('getAnimeDetails(ongoing)', { ...details, description: details.description?.slice(0, 80) });
      const episodes = await client.getEpisodes(anime, call);
      show('getEpisodes(ongoing)', { count: episodes.length, newest: episodes[0] });
      expect(episodes.length).toBeGreaterThan(0);

      const streams = await client.getStreams(episodes[0]!, call);
      show(
        'getStreams(ongoing newest)',
        streams.map((s) => ({ server: s.server, quality: s.quality, kind: s.kind, url: s.url.slice(0, 110) })),
      );
      expect(streams.length).toBeGreaterThan(0);

      // Is each link alive? One tiny ranged GET per stream, with the headers the extension asked for.
      for (const stream of streams) {
        const response = await fetch(stream.url, {
          headers: {
            'user-agent': USER_AGENT,
            ...stream.headers,
            // A playlist is small; the media files get one tiny ranged read.
            ...(stream.kind === 'hls' ? {} : { Range: 'bytes=0-1023' }),
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(20_000),
        }).catch((e: Error) => e);
        const body = response instanceof Response ? (await response.text()).slice(0, 12) : '';
        show(
          `probe ${stream.server}`,
          response instanceof Response
            ? { status: response.status, type: response.headers.get('content-type'), start: body.replace(/\W/g, '.') }
            : String(response),
        );
      }

      const finished = done.items[0]!;
      const completeEpisodes = await client.getEpisodes(finished, call);
      show('getEpisodes(completed)', {
        count: completeEpisodes.length,
        oldest: completeEpisodes.at(-1)?.name,
        newest: completeEpisodes[0]?.name,
      });
      const more = await client.getStreams(completeEpisodes.at(-1)!, call);
      show(
        'getStreams(completed oldest)',
        more.map((s) => `${s.server}|${s.quality}|${s.kind}|${new URL(s.url).host}`),
      );

      await expect(
        client.getAnimeDetails({ url: '/anime/slug-yang-tidak-ada-xyz/', title: 'x' }, call),
      ).rejects.toMatchObject({ typed: 'NotFoundError' });
      show('getAnimeDetails(missing slug)', 'NotFoundError');
      show('requests', host.stats.requests);
    } finally {
      runtime.dispose();
    }
  });
});
