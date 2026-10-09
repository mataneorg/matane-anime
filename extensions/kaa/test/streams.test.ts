import { afterEach, describe, expect, it } from 'vitest';
import { parseManifest, posterUrl, unescapeHtml } from '../src/text';
import { BASE, disposeAll, fixture, load, type Route } from './harness';

afterEach(disposeAll);

const SBR = 'jojo-no-kimyou-na-bouken-part-7-steel-ball-run-472c';
const EP = { url: `${SBR}/ep-4-f3a039`, name: 'Episode 4', number: 4 };

const site =
  (episode: string, overrides: Route = () => undefined): Route =>
  (r) => {
    const own = overrides(r);
    if (own) return own;
    if (r.url.startsWith(`${BASE}/show/`)) return { status: 200, text: fixture(episode) };
    if (r.url.includes('source=vidstream')) return { status: 200, text: fixture('player_vidstream.html.txt') };
    if (r.url.includes('source=catstream')) return { status: 200, text: fixture('player_catstream.html.txt') };
    return undefined;
  };

describe('parsers', () => {
  it('reads the VidStreaming master out of the escaped Astro props', () => {
    expect(parseManifest(fixture('player_vidstream.html.txt'))).toBe(
      'https://hls.krussdomi.com/manifest/6ac8a06c402141b0cb7f7597/master.m3u8',
    );
  });
  it('reads the CatStream master and adds the missing scheme', () => {
    expect(parseManifest(fixture('player_catstream.html.txt'))).toBe(
      'https://bl.krussdomi.com/playlist/6ac7cfd8402141b0cb0e16b9/master.m3u8',
    );
    expect(parseManifest('<html></html>')).toBeUndefined();
  });
  it('unescapes entities and builds poster urls', () => {
    expect(unescapeHtml('&quot;a&quot; &amp; &#x27;b&#39;')).toBe('"a" & \'b\'');
    expect(posterUrl('https://kaa.lt', { sm: 'x-sm', hq: 'x-hq' }, 'hq')).toBe('https://kaa.lt/image/poster/x-hq.webp');
    expect(posterUrl('https://kaa.lt', undefined)).toBeUndefined();
  });
});

describe('getStreams', () => {
  it('returns the HLS master with the Origin the CDN checks, for every server', async () => {
    const { client, requests } = await load(site('episode_cat.json'));
    const streams = await client.getStreams(EP);
    expect(streams.map((s) => s.server)).toEqual(['VidStreaming', 'CatStream']);
    expect(streams.every((s) => s.kind === 'hls')).toBe(true);
    expect(streams[0]?.headers).toEqual({ Origin: 'https://krussdomi.com', Referer: 'https://krussdomi.com/' });
    expect(streams[1]?.url).toBe('https://bl.krussdomi.com/playlist/6ac7cfd8402141b0cb0e16b9/master.m3u8');
    expect(requests[0]?.url).toBe(`${BASE}/show/${SBR}/episode/ep-4-f3a039`);
  });

  it('skips a failing server and keeps the other', async () => {
    const { client, logs } = await load(
      site('episode_cat.json', (r) => (r.url.includes('source=catstream') ? { status: 500 } : undefined)),
    );
    expect((await client.getStreams(EP)).map((s) => s.server)).toEqual(['VidStreaming']);
    expect(logs.some((l) => l.includes('CatStream'))).toBe(true);
  });

  it('an episode without servers (an unreleased dub) is NotFoundError', async () => {
    const { client } = await load(() => ({ status: 200, text: JSON.stringify({ servers: [] }) }));
    await expect(client.getStreams(EP)).rejects.toMatchObject({ typed: 'NotFoundError', message: /no server yet/ });
  });

  it('refuses a player on another host without asking it', async () => {
    const body = JSON.stringify({ servers: [{ name: 'Evil', src: 'https://evil.example/player?id=1' }] });
    const { client, requests } = await load(() => ({ status: 200, text: body }));
    await expect(client.getStreams(EP)).rejects.toMatchObject({ typed: 'NotFoundError', message: /could be read/ });
    expect(requests).toHaveLength(1);
  });

  it('fails clearly when no player page has a playlist', async () => {
    const { client } = await load(
      site('episode_sbr.json', (r) => (r.url.includes('source=') ? { status: 200, text: '<html></html>' } : undefined)),
    );
    await expect(client.getStreams(EP)).rejects.toMatchObject({ typed: 'NotFoundError', message: /could be read/ });
  });

  it('an url that is not an episode is NotFoundError', async () => {
    const { client } = await load(() => undefined);
    await expect(client.getStreams({ url: 'x', name: 'x' })).rejects.toMatchObject({ typed: 'NotFoundError' });
  });
});
