import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import { readGdriveplayerPlaylist } from '../src/gdriveplayer';
import {
  parseBloggerResponse,
  parseDesustreamSource,
  parseOkruVideos,
  parseVidhideLinks,
  parseYouruploadSource,
  readEmbeds,
} from '../src/streams';
import { BASE, disposeAll, fixture, load, type Route } from './harness';

afterEach(disposeAll);

// readEmbeds and the gdriveplayer reader run in the sandbox, whose `base64` is stood in for here.
beforeAll(() => {
  Object.assign(globalThis, {
    base64: {
      decode: (text: string) => Buffer.from(text, 'base64').toString('utf8'),
      decodeBytes: (text: string) => new Uint8Array(Buffer.from(text, 'base64')),
    },
  });
});

const EP = { url: '/nonton-koori-no-jouheki-season-2-episode-2/', name: 'Episode 2', number: 2 };
const BLOGGER_RPC = /^https:\/\/(?:www|draft)\.blogger\.com\/_\/BloggerVideoPlayerUi\/data\/batchexecute/;

/** Serves the episode page and the players from fixtures. */
const site =
  (episodeFixture: string, overrides: Route = () => undefined): Route =>
  (r) => {
    const own = overrides(r);
    if (own) return own;
    if (r.url.startsWith(BASE)) return { status: 200, text: fixture(episodeFixture) };
    if (BLOGGER_RPC.test(r.url)) return { status: 200, text: fixture('blogger_rpc.txt') };
    if (/^https:\/\/vidhidepro\.com\/v\//.test(r.url)) {
      // The real page redirects to a mirror domain; relative links resolve against that one.
      return { status: 200, url: 'https://callistanise.com/v/abc', text: fixture('vidhide_embed.html.txt') };
    }
    if (r.url.startsWith('https://gdriveplayer.to/'))
      return { status: 200, text: fixture('gdriveplayer_embed.html.txt') };
    if (r.url.startsWith('https://ok.ru/')) return { status: 200, text: fixture('okru_embed.html.txt') };
    if (r.url.startsWith('https://desustream.net/')) return { status: 200, text: fixture('desustream_embed.html.txt') };
    if (r.url.startsWith('https://www.yourupload.com/')) {
      const dead = r.url.endsWith('/Dnrr1d2YY4S3');
      return { status: 200, text: fixture(dead ? 'yourupload_dead.html.txt' : 'yourupload_embed.html.txt') };
    }
    return undefined;
  };

describe('parsers', () => {
  it('reads the default player and the base64 mirror options, skipping duplicates', () => {
    const urls = readEmbeds(fixture('ep_blogger_vidhide_yup.html.txt'));
    expect(urls.map((u) => new URL(u).hostname)).toEqual([
      'www.blogger.com',
      'vidhidepro.com',
      'mega.nz',
      'www.yourupload.com',
      'vidhidepro.com',
      'player.abyssplayer.com',
    ]);
    expect(readEmbeds('<html></html>')).toEqual([]);
  });

  it('prefixes protocol-relative iframes and decodes entities', () => {
    const urls = readEmbeds(fixture('ep_okru_gdrive.html.txt'));
    expect(urls.some((u) => u.startsWith('https://ok.ru/videoembed/'))).toBe(true);
    expect(urls.some((u) => u.startsWith('https://gdriveplayer.to/embed'))).toBe(true);
    expect(urls.every((u) => !u.includes('&amp;'))).toBe(true);
  });

  it('reads Blogger mp4s with their quality', () => {
    const links = parseBloggerResponse(fixture('blogger_rpc.txt'));
    expect(links.map((l) => l.quality).sort()).toEqual([360, 720]);
    expect(links.every((l) => !l.url.includes('\\'))).toBe(true);
  });

  it('reads the vidhide playlist out of the packed script (hls4, else hls2)', () => {
    const url = parseVidhideLinks(fixture('vidhide_embed.html.txt'), 'https://callistanise.com');
    expect(url[0]).toMatch(/^https:\/\/callistanise\.com\/stream\/.+\/master\.m3u8$/); // a relative link, on the mirror
    expect(url.length).toBe(2);
    expect(url[1]).toMatch(/^https:\/\/[^/]+\/hls2\/.+\/master\.m3u8\?/);
    expect(parseVidhideLinks('<html></html>', 'https://x.com')).toEqual([]);
    const hls2 = 'eval(1);var links={"hls3":"/a","hls2":"/b/master.m3u8?t=1"}';
    expect(parseVidhideLinks(hls2, 'https://x.com')).toEqual(['https://x.com/b/master.m3u8?t=1']);
  });

  it('reads the ok.ru mp4 files', () => {
    const videos = parseOkruVideos(fixture('okru_embed.html.txt'));
    expect(videos.length).toBeGreaterThan(0);
    expect(videos.every((v) => v.url.startsWith('https://'))).toBe(true);
    expect(videos.some((v) => v.quality !== undefined)).toBe(true);
    expect(parseOkruVideos('<html></html>')).toEqual([]);
  });

  it('reads desustream, yourupload and the gdriveplayer loader', () => {
    expect(parseDesustreamSource(fixture('desustream_embed.html.txt'))).toMatch(
      /^https:\/\/archive\.org\/download\/.*\.mp4$/,
    );
    expect(parseDesustreamSource('<html></html>')).toBeUndefined();
    expect(parseYouruploadSource(fixture('yourupload_embed.html.txt'))).toMatch(
      /^https:\/\/vidcache\.net:8161\/.*\/video\.mp4$/,
    );
    expect(parseYouruploadSource(fixture('yourupload_dead.html.txt'))).toBeUndefined();
    expect(readGdriveplayerPlaylist(fixture('gdriveplayer_embed.html.txt'), 'https://gdriveplayer.to')).toMatch(
      /^https:\/\/gdriveplayer\.to\/hlsplaylist\.php\?/,
    );
  });
});

describe('getStreams', () => {
  it('ranks Blogger, vidhide HLS, then yourupload; skips mega and abyssplayer without asking them', async () => {
    const { client, requests } = await load(site('ep_blogger_vidhide_yup.html.txt'));
    const streams = await client.getStreams(EP);
    expect(streams.map((s) => [s.server, s.kind])).toEqual([
      ['Blogger', 'mp4'],
      ['Blogger', 'mp4'],
      ['Vidhide', 'hls'],
      ['Vidhide 2', 'hls'],
      ['Yourupload', 'mp4'],
    ]);
    // Two vidhide servers with the same fixture give one stream; the Referer of yourupload is its embed page.
    expect(streams[4]?.headers?.['Referer']).toMatch(/^https:\/\/www\.yourupload\.com\/embed\//);
    expect(streams[2]?.url).toMatch(/^https:\/\//);
    expect(requests.some((r) => r.url.includes('mega.nz') || r.url.includes('abyssplayer'))).toBe(false);
  });

  it('reads draft.blogger.com on its own host', async () => {
    const { client, requests } = await load(site('ep_draft_blogger.html.txt'));
    expect((await client.getStreams(EP)).length).toBeGreaterThan(0);
    expect(requests.some((r) => r.url.startsWith('https://draft.blogger.com/_/BloggerVideoPlayerUi/'))).toBe(true);
  });

  it('reads desustream as an archive.org mp4', async () => {
    const { client } = await load(site('ep_desustream.html.txt'));
    const streams = await client.getStreams(EP);
    expect(streams.find((s) => s.server === 'Desustream')?.url).toMatch(/^https:\/\/archive\.org\/download\//);
  });

  it('reads ok.ru and gdriveplayer, from protocol-relative iframes', async () => {
    const { client } = await load(site('ep_okru_gdrive.html.txt'));
    const servers = (await client.getStreams(EP)).map((s) => s.server);
    expect(servers).toContain('OK.ru');
    expect(servers).toContain('Gdriveplayer');
  });

  it('skips a failing server and keeps the working one', async () => {
    const { client, logs } = await load(
      site('ep_blogger_vidhide_yup.html.txt', (r) => (r.url.includes('vidhidepro.com') ? { status: 500 } : undefined)),
    );
    const streams = await client.getStreams(EP);
    expect(streams.map((s) => s.server)).toEqual(['Blogger', 'Blogger', 'Yourupload']);
    expect(logs.some((l) => l.includes('vidhidepro.com'))).toBe(true);
  });

  it('does not wait for a dead server once another has answered', async () => {
    const started = Date.now();
    const { client } = await load(
      site('ep_blogger_vidhide_yup.html.txt', (r) =>
        r.url.includes('vidhidepro.com') ? { delayMs: 6000 } : undefined,
      ),
    );
    const streams = await client.getStreams(EP);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(streams.map((s) => s.server)).toEqual(['Blogger', 'Blogger', 'Yourupload']);
  }, 10_000);

  it('a removed ok.ru or yourupload video is no stream and no failure', async () => {
    const page = `<div id="pembed"><iframe src="https://ok.ru/videoembed/1"></iframe></div>`;
    const { client } = await load((r) =>
      r.url.startsWith(BASE) ? { status: 200, text: page } : { status: 200, text: '<html>gone</html>' },
    );
    await expect(client.getStreams(EP)).rejects.toMatchObject({
      typed: 'NotFoundError',
      message: /no readable server/,
    });
  });

  it('says so when only unsupported hosts exist', async () => {
    const { client, requests } = await load(() => ({
      status: 200,
      text: '<div id="pembed"><iframe src="https://mega.nz/embed/abc#key"></iframe></div>',
    }));
    await expect(client.getStreams(EP)).rejects.toMatchObject({ typed: 'NotFoundError', message: /only on servers/ });
    expect(requests).toHaveLength(1);
  });

  it('fails clearly when every readable server fails', async () => {
    const { client } = await load(
      site('ep_draft_blogger.html.txt', (r) => (BLOGGER_RPC.test(r.url) ? { status: 500 } : undefined)),
    );
    await expect(client.getStreams(EP)).rejects.toMatchObject({ typed: 'NotFoundError', message: /could be read/ });
  });
});
