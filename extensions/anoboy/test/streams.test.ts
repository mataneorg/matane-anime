import { afterEach, describe, expect, it } from 'vitest';
import { parseBloggerResponse, parseBtubeSource, parseVkspeedSources, parseXtwapPlaylist } from '../src/streams';
import { BASE, disposeAll, fixture, load, type Route } from './harness';

afterEach(disposeAll);

const EP = {
  url: '/hyouken-no-majutsushi-ga-sekai-wo-suberu-ii-episode-1-subtitle-indonesia/',
  name: 'Episode 1',
  number: 1,
};
const BLOGGER_RPC = /^https:\/\/(?:www|draft)\.blogger\.com\/_\/BloggerVideoPlayerUi\/data\/batchexecute/;

/** Serves the episode page and the players from fixtures. */
const site =
  (episodeFixture: string, overrides: Route = () => undefined): Route =>
  (r) => {
    const own = overrides(r);
    if (own) return own;
    if (r.url.startsWith(BASE)) return { status: 200, text: fixture(episodeFixture) };
    if (BLOGGER_RPC.test(r.url)) return { status: 200, text: fixture('blogger_rpc.txt') };
    if (r.url.startsWith('https://vkspeed.com/')) return { status: 200, text: fixture('vkspeed_embed.html.txt') };
    if (r.url.includes('/btube3.php')) return { status: 200, text: fixture('xtwap_btube_embed.html.txt') };
    if (r.url.startsWith('https://play.xtwap.top/'))
      return { status: 200, text: fixture('xtwap_cepat2_embed.html.txt') };
    return undefined;
  };

describe('parsers', () => {
  it('reads Blogger mp4s with their quality', () => {
    const links = parseBloggerResponse(fixture('blogger_rpc.txt'));
    expect(links.map((l) => l.quality).sort()).toEqual([360, 720]);
    expect(links[0]?.url).toContain('mime=video/mp4');
    expect(links.every((l) => !l.url.includes('\\'))).toBe(true);
  });
  it('unpacks the vkspeed player', () => {
    const sources = parseVkspeedSources(fixture('vkspeed_embed.html.txt'));
    expect(sources).toHaveLength(2);
    expect(sources.map((s) => s.quality)).toEqual([360, 192]);
    expect(sources[0]?.url).toMatch(/^https:\/\/[^/]+\/\w+\/v\.mp4$/);
  });
  it('reads the cepat2 playlist and the btube mp4', () => {
    expect(parseXtwapPlaylist(fixture('xtwap_cepat2_embed.html.txt'))).toMatch(
      /^https:\/\/hls\.xtwap\.top\/.*index\.m3u8$/,
    );
    expect(parseXtwapPlaylist('<html></html>')).toBeUndefined();
    const mp4 = parseBtubeSource(fixture('xtwap_btube_embed.html.txt'));
    expect(mp4).toMatch(/^https:\/\/rr\d+---[^/]*googlevideo\.com\/videoplayback\?/);
    expect(mp4).not.toContain('&amp;');
    expect(parseBtubeSource('<source src="">')).toBeUndefined();
  });
});

describe('getStreams', () => {
  it('does not follow an embed on a host that merely ends like a supported one', async () => {
    const lookalike = fixture('ep_blogger.html.txt').replaceAll('//www.blogger.com/', '//evilblogger.com/');
    expect(lookalike).toContain('evilblogger.com');
    const { client, requests } = await load(
      site('ep_blogger.html.txt', (r) => (r.url.startsWith(BASE) ? { status: 200, text: lookalike } : undefined)),
    );
    await client.getStreams(EP).catch(() => undefined);
    expect(requests.filter((r) => r.url.includes('evilblogger.com'))).toEqual([]);
  });

  it('resolves the default Blogger iframe, 720p first', async () => {
    const { client, requests } = await load(site('ep_blogger.html.txt'));
    const streams = await client.getStreams(EP);
    expect(streams.map((s) => [s.server, s.kind, s.quality])).toEqual([
      ['Blogger', 'mp4', 720],
      ['Blogger', 'mp4', 360],
    ]);
    const rpc = requests.find((r) => BLOGGER_RPC.test(r.url));
    expect(rpc?.method).toBe('POST');
    expect(decodeURIComponent(String(rpc?.body))).toContain('WcwnYd');
  });

  it('reads draft.blogger.com on its own host', async () => {
    const { client, requests } = await load(site('ep_draft_blogger.html.txt'));
    expect((await client.getStreams(EP)).length).toBeGreaterThan(0);
    expect(requests.some((r) => r.url.startsWith('https://draft.blogger.com/_/BloggerVideoPlayerUi/'))).toBe(true);
  });

  it('adds cepat2 HLS from the server buttons: Blogger first, then HLS', async () => {
    const { client } = await load(site('ep_blogger_cepat2.html.txt'));
    const streams = await client.getStreams(EP);
    expect(streams.map((s) => s.server)).toEqual(['Blogger', 'Blogger', 'xtwap']);
    expect(streams[2]?.kind).toBe('hls');
  });

  it('adds the btube mp4 without any Referer', async () => {
    const { client, requests } = await load(site('ep_blogger_btube.html.txt'));
    const streams = await client.getStreams(EP);
    expect(streams.map((s) => [s.server, s.kind])).toEqual([
      ['Blogger', 'mp4'],
      ['Blogger', 'mp4'],
      ['xtwap', 'mp4'],
    ]);
    expect(streams[2]?.headers).toBeUndefined();
    const btube = requests.find((r) => r.url.includes('btube3.php'));
    expect(Object.keys(btube?.headers ?? {}).map((h) => h.toLowerCase())).not.toContain('referer');
  });

  it("reads cepat2 as default plus vkspeed with its own Referer, never the site's", async () => {
    const { client } = await load(site('ep_cepat2_vkspeed.html.txt'));
    const streams = await client.getStreams(EP);
    expect(streams.map((s) => s.server)).toEqual(['xtwap', 'vkspeed', 'vkspeed']);
    expect(streams[1]).toMatchObject({ quality: 360, headers: { Referer: 'https://vkspeed.com/' } });
  });

  it('reads a vkspeed-only episode', async () => {
    const { client } = await load(site('ep_vkspeed.html.txt'));
    const streams = await client.getStreams(EP);
    expect(streams.every((s) => s.server === 'vkspeed' && s.kind === 'mp4')).toBe(true);
  });

  it('skips a failing server and keeps the working one', async () => {
    const { client, logs } = await load(
      site('ep_blogger_cepat2.html.txt', (r) =>
        r.url.startsWith('https://play.xtwap.top/') ? { status: 500 } : undefined,
      ),
    );
    const streams = await client.getStreams(EP);
    expect(streams.every((s) => s.server === 'Blogger')).toBe(true);
    expect(logs.some((l) => l.includes('play.xtwap.top'))).toBe(true);
  });

  it('does not wait for a dead server once another has answered', async () => {
    const started = Date.now();
    const { client } = await load(
      site('ep_blogger_cepat2.html.txt', (r) =>
        r.url.startsWith('https://play.xtwap.top/') ? { delayMs: 6000 } : undefined,
      ),
    );
    const streams = await client.getStreams(EP);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(streams.length > 0 && streams.every((s) => s.server === 'Blogger')).toBe(true);
  }, 10_000);

  it('says so when only unsupported hosts exist (no request to them)', async () => {
    const page =
      '<div id="pembed"><iframe data-litespeed-src="https://hlswish.com/e/abc"></iframe></div><button class="aspd-server" data-label="HD-1" data-url="https://turbovidhls.com/t/x"></button>';
    const { client, requests } = await load(() => ({ status: 200, text: page }));
    await expect(client.getStreams(EP)).rejects.toMatchObject({ typed: 'NotFoundError', message: /only on servers/ });
    expect(requests).toHaveLength(1);
  });

  it('fails clearly when every readable server fails', async () => {
    const { client } = await load(
      site('ep_blogger.html.txt', (r) => (BLOGGER_RPC.test(r.url) ? { status: 500 } : undefined)),
    );
    await expect(client.getStreams(EP)).rejects.toMatchObject({ typed: 'NotFoundError', message: /could be read/ });
  });
});
