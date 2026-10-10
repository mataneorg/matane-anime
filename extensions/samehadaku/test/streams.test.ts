import { afterEach, describe, expect, it } from 'vitest';
import { parseBloggerResponse, parseVkspeedSources, parseXtwapPlaylist } from '../src/streams';
import { BASE, disposeAll, fixture, load, type Route } from './harness';

afterEach(disposeAll);

const ep = (slug: string) => ({ url: `/${slug}/`, name: 'Episode 1', number: 1 });
const EP = ep('one-piece-episode-1178-subtitle-indonesia');
const BLOGGER_RPC = /^https:\/\/(?:www|draft)\.blogger\.com\/_\/BloggerVideoPlayerUi\/data\/batchexecute/;

/** Serves the episode page and the three players from fixtures. */
const site =
  (episodeFixture: string, overrides: Route = () => undefined): Route =>
  (r) => {
    const own = overrides(r);
    if (own) return own;
    if (r.url.startsWith(BASE)) return { status: 200, text: fixture(episodeFixture) };
    if (BLOGGER_RPC.test(r.url)) return { status: 200, text: fixture('blogger_rpc.txt') };
    if (r.url.startsWith('https://vkspeed.com/')) return { status: 200, text: fixture('vkspeed_embed.html.txt') };
    if (r.url.startsWith('https://play.xtwap.top/')) return { status: 200, text: fixture('xtwap_embed.html.txt') };
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
    expect(sources).toEqual([
      {
        url: 'https://vksovhj001.vkcdn5.com/olaxkjgdwduiolyobgd2huzvgs55ttnnjv2rly4676726xqmclxwmmcaroeq/v.mp4',
        quality: 360,
      },
      {
        url: 'https://vksovhj001.vkcdn5.com/olaxkjgdwduiolyobgd2huzvgs55ttnnjv2rly467w726xqmclx654cino5q/v.mp4',
        quality: 192,
      },
    ]);
  });
  it('reads the xtwap playlist', () => {
    expect(parseXtwapPlaylist(fixture('xtwap_embed.html.txt'))).toMatch(/^https:\/\/hls\.xtwap\.top\/.*index\.m3u8$/);
    expect(parseXtwapPlaylist('<html></html>')).toBeUndefined();
  });
  it('has no playlist in the btube variant of xtwap (unplayable from the client)', () => {
    expect(parseXtwapPlaylist(fixture('xtwap_btube_embed.html.txt'))).toBeUndefined();
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

  it('adds xtwap from the server buttons and ranks Blogger, HLS, then vkspeed', async () => {
    const { client } = await load(site('ep_blogger_xtwap.html.txt'));
    const streams = await client.getStreams(EP);
    expect(streams.map((s) => s.server)).toEqual(['Blogger', 'Blogger', 'xtwap']);
    expect(streams[2]?.kind).toBe('hls');
  });

  it('reads xtwap as default plus vkspeed with its own Referer', async () => {
    const { client } = await load(site('ep_xtwap_vkspeed.html.txt'));
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
      site('ep_blogger_xtwap.html.txt', (r) =>
        r.url.startsWith('https://play.xtwap.top/') ? { status: 500 } : undefined,
      ),
    );
    const streams = await client.getStreams(EP);
    expect(streams.every((s) => s.server === 'Blogger')).toBe(true);
    expect(logs.some((l) => l.includes('play.xtwap.top'))).toBe(true);
  });

  it('says so when only unsupported hosts exist (no request to them)', async () => {
    for (const name of ['ep_playerwish.html.txt', 'ep_turbovid.html.txt']) {
      const { client, requests } = await load(site(name));
      await expect(client.getStreams(EP)).rejects.toMatchObject({ typed: 'NotFoundError', message: /only on servers/ });
      expect(requests).toHaveLength(1);
      disposeAll();
    }
  });

  it('fails clearly when every readable server fails', async () => {
    const { client } = await load(
      site('ep_blogger.html.txt', (r) => (BLOGGER_RPC.test(r.url) ? { status: 500 } : undefined)),
    );
    await expect(client.getStreams(EP)).rejects.toMatchObject({ typed: 'NotFoundError', message: /could be read/ });
  });
});
