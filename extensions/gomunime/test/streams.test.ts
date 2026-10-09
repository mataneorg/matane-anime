import { afterEach, describe, expect, it } from 'vitest';
import {
  driveId,
  parseBloggerResponse,
  parseMp4uploadSource,
  parseBtubeSource,
  parseCepatPlaylist,
  pixeldrainId,
  readEmbeds,
} from '../src/streams';
import { BASE, disposeAll, fixture, load, type Route } from './harness';

afterEach(disposeAll);

const EP = { url: '/tokyo-revengers-santen-sensou-hen-episode-2', name: 'Episode 2', number: 2 };
const BLOGGER_RPC = /^https:\/\/(?:www|draft)\.blogger\.com\/_\/BloggerVideoPlayerUi\/data\/batchexecute/;

/** gdplayer's embed page and its API answer (both from one real session), and the gdriveplayer page. */
const gdplayer: Route = (r) => {
  if (r.url.startsWith('https://gdplayer.to/api/')) return { status: 200, text: fixture('gdplayer_answer.txt') };
  if (r.url.startsWith('https://gdplayer.to/')) return { status: 200, text: fixture('gdplayer_embed.html.txt') };
  return undefined;
};
const gdriveplayer: Route = (r) =>
  r.url.startsWith('https://gdriveplayer.to/')
    ? { status: 200, text: fixture('gdriveplayer_embed.html.txt') }
    : undefined;

/** Serves the episode page and the players from fixtures. */
const site =
  (episodeFixture: string, overrides: Route = () => undefined): Route =>
  (r) => {
    const own = overrides(r);
    if (own) return own;
    if (r.url.startsWith('https://www.mp4upload.com/'))
      return { status: 200, text: fixture('mp4upload_embed.html.txt') };
    if (r.url.startsWith('https://drive.usercontent.google.com/'))
      return { status: 206, headers: { 'content-type': 'video/mp4' }, text: 'x' };
    if (r.url.startsWith(BASE)) return { status: 200, text: fixture(episodeFixture) };
    if (BLOGGER_RPC.test(r.url)) return { status: 200, text: fixture('blogger_rpc.txt') };
    if (r.url.startsWith('https://play.xtwap.top/btube3.php'))
      return { status: 200, text: fixture('xtwap_btube_embed.html.txt') };
    if (r.url.startsWith('https://play.xtwap.top/cepat2.php'))
      return { status: 200, text: fixture('xtwap_cepat_embed.html.txt') };
    return undefined;
  };

describe('parsers', () => {
  it('reads the servers of an episode page with their labels', () => {
    const embeds = readEmbeds(fixture('ep_pixeldrain.html.txt'));
    expect(embeds.map((e) => [e.label, new URL(e.url).host])).toEqual([
      ['GDRIVE', 'gdplayer.to'],
      ['B-TUBE', 'play.xtwap.top'],
      ['pdrn 360p', 'pixeldrain.com'],
      ['pdrn 480p', 'pixeldrain.com'],
      ['pdrn 720p', 'pixeldrain.com'],
    ]);
    expect(embeds[2]?.url).toBe('https://pixeldrain.com/u/RAsMv9JS');
    expect(readEmbeds('<html></html>')).toEqual([]);
  });

  it('decodes entities and keeps the double-encoded cepat address as it is', () => {
    const cepat = readEmbeds(fixture('ep_gd_btube_cepat.html.txt')).find((e) => e.label === 'CEPAT');
    expect(cepat?.url).toContain('cepat2.php?url=');
    expect(cepat?.url).toContain('%252B');
    expect(cepat?.url).not.toContain('&amp;');
  });

  it('reads the btube mp4 and the cepat playlist', () => {
    const mp4 = parseBtubeSource(fixture('xtwap_btube_embed.html.txt'));
    expect(mp4).toMatch(/^https:\/\/rr\d+---[^/]*googlevideo\.com\/videoplayback\?/);
    expect(mp4).not.toContain('&amp;');
    expect(parseCepatPlaylist(fixture('xtwap_cepat_embed.html.txt'))).toMatch(
      /^https:\/\/hls\.xtwap\.top\/.*index\.m3u8$/,
    );
    expect(parseBtubeSource('<html></html>')).toBeUndefined();
    expect(parseCepatPlaylist('{"file":""}')).toBeUndefined();
  });

  it('reads Blogger mp4s with their quality', () => {
    const links = parseBloggerResponse(fixture('blogger_rpc.txt'));
    expect(links.map((l) => l.quality).sort()).toEqual([360, 720]);
    expect(links.every((l) => !l.url.includes('\\'))).toBe(true);
  });

  it('reads the mp4upload file, and none from a deleted one', () => {
    expect(parseMp4uploadSource(fixture('mp4upload_embed.html.txt'))).toMatch(
      /^https:\/\/a\d+\.mp4upload\.com:183\/d\/\w+\/video\.mp4$/,
    );
    expect(parseMp4uploadSource(fixture('mp4upload_deleted.html.txt'))).toBeUndefined();
  });

  it('reads Google Drive ids', () => {
    expect(driveId(new URL('https://drive.google.com/file/d/1aHy2yz9nEiZP_Q-bkMsIPU_XDa0aq1X_/preview'))).toBe(
      '1aHy2yz9nEiZP_Q-bkMsIPU_XDa0aq1X_',
    );
    expect(driveId(new URL('https://drive.google.com/drive/folders/x'))).toBeUndefined();
  });

  it('reads pixeldrain ids', () => {
    expect(pixeldrainId(new URL('https://pixeldrain.com/u/W11UuVuw'))).toBe('W11UuVuw');
    expect(pixeldrainId(new URL('https://pixeldrain.com/l/abc'))).toBeUndefined();
  });
});

describe('getStreams', () => {
  it('ranks cepat HLS, btube mp4, then the mp4upload file that gdplayer wraps', async () => {
    const { client, requests } = await load(site('ep_gd_btube_cepat.html.txt', gdplayer));
    const streams = await client.getStreams(EP);
    expect(streams.map((s) => [s.server, s.kind])).toEqual([
      ['Cepat', 'hls'],
      ['B-Tube', 'mp4'],
      ['Mp4upload', 'mp4'],
    ]);
    expect(streams[2]?.headers).toEqual({ Referer: 'https://www.mp4upload.com/' });
    expect(streams[1]?.headers).toBeUndefined();
    // The id came from the decrypted API answer.
    expect(requests.some((r) => r.url === 'https://www.mp4upload.com/embed-jzghjw19unjf.html')).toBe(true);
    const api = requests.find((r) => r.url === 'https://gdplayer.to/api/');
    expect(api?.method).toBe('POST');
    expect(api?.headers).toMatchObject({ 'X-Ts': '1791552484', 'X-Nc': '820a5cb8b6e33e2b01ae53d2e1a86f97' });
    // The btube page must be asked for without a Referer: the site's own gets a 403.
    const btube = requests.find((r) => r.url.includes('btube3.php'));
    expect(Object.keys(btube?.headers ?? {}).map((h) => h.toLowerCase())).not.toContain('referer');
  });

  it('skips gdplayer when the episode lists mp4upload itself', async () => {
    const { client, requests } = await load(site('ep_mp4upload_blogger.html.txt'));
    await client.getStreams(EP);
    expect(requests.some((r) => r.url.includes('gdplayer.to'))).toBe(false);
  });

  it('a gdplayer failure does not hide the other servers', async () => {
    const { client } = await load(
      site('ep_gd_btube_cepat.html.txt', (r) =>
        r.url.startsWith('https://gdplayer.to/api/') ? { status: 500 } : gdplayer(r),
      ),
    );
    expect((await client.getStreams(EP)).map((s) => s.server)).toEqual(['Cepat', 'B-Tube']);
  });

  it('reads gdriveplayer as an HLS playlist, from its protocol-relative iframe', async () => {
    const { client, requests } = await load(site('ep_mp4upload_blogger.html.txt', gdriveplayer));
    const streams = await client.getStreams(EP);
    const hls = streams.find((s) => s.server === 'Gdriveplayer');
    expect(hls).toMatchObject({ kind: 'hls' });
    expect(hls?.url).toMatch(/^https:\/\/gdriveplayer\.to\/hlsplaylist\.php\?s=.*\.m3u8$/);
    expect(requests.some((r) => r.url.startsWith('https://gdriveplayer.to/embed2.php?link='))).toBe(true);
  });

  it('builds pixeldrain api files with the quality of the label', async () => {
    const { client, requests } = await load(site('ep_pixeldrain.html.txt'));
    const streams = await client.getStreams(EP);
    expect(streams.map((s) => [s.server, s.quality])).toEqual([
      ['B-Tube', 360],
      ['Pixeldrain', 720],
      ['Pixeldrain', 480],
      ['Pixeldrain', 360],
    ]);
    expect(streams[1]?.url).toBe('https://pixeldrain.com/api/file/sqh74Kyg');
    expect(requests.some((r) => r.url.includes('pixeldrain.com'))).toBe(false);
  });

  it('resolves a Blogger server', async () => {
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

  it('skips a failing server and keeps the working one', async () => {
    const { client, logs } = await load(
      site('ep_gd_btube_cepat.html.txt', (r) => (r.url.includes('cepat2.php') ? { status: 500 } : undefined)),
    );
    const streams = await client.getStreams(EP);
    expect(streams.map((s) => s.server)).toEqual(['B-Tube']);
    expect(logs.some((l) => l.includes('play.xtwap.top'))).toBe(true);
  });

  it('says so when only unsupported hosts exist, without asking them', async () => {
    for (const name of ['ep_mega.html.txt']) {
      const { client, requests } = await load(site(name));
      await expect(client.getStreams(EP)).rejects.toMatchObject({ typed: 'NotFoundError', message: /only on servers/ });
      expect(requests).toHaveLength(1);
      disposeAll();
    }
  });

  it('resolves Google Drive files to the direct download, one per server', async () => {
    const { client, requests } = await load(site('ep_drive.html.txt'));
    const streams = await client.getStreams(EP);
    expect(streams).toHaveLength(3);
    expect(streams[0]).toMatchObject({ server: 'Google Drive', kind: 'mp4' });
    expect(streams[0]?.url).toBe(
      'https://drive.usercontent.google.com/download?id=1aHy2yz9nEiZP_Q-bkMsIPU_XDa0aq1X_&export=download&confirm=t',
    );
    expect(requests.filter((r) => r.url.includes('usercontent'))[0]?.headers?.['Range']).toBe('bytes=0-0');
  });

  it('drops a Drive file over its quota (an HTML answer)', async () => {
    const { client } = await load(
      site('ep_drive.html.txt', (r) =>
        r.url.includes('usercontent')
          ? { status: 200, headers: { 'content-type': 'text/html' }, text: '<html>' }
          : undefined,
      ),
    );
    await expect(client.getStreams(EP)).rejects.toMatchObject({ typed: 'NotFoundError' });
  });

  it('sends mp4upload with its own Referer, next to Blogger', async () => {
    const { client } = await load(site('ep_mp4upload_blogger.html.txt'));
    const streams = await client.getStreams(EP);
    expect(streams.map((s) => s.server)).toEqual(['Blogger', 'Blogger', 'Mp4upload']);
    expect(streams[2]).toMatchObject({ kind: 'mp4', headers: { Referer: 'https://www.mp4upload.com/' } });
  });

  it('a deleted mp4upload file is no stream and no failure', async () => {
    const { client } = await load(
      site('ep_dead_hosts.html.txt', (r) =>
        r.url.startsWith('https://www.mp4upload.com/')
          ? { status: 200, text: fixture('mp4upload_deleted.html.txt') }
          : undefined,
      ),
    );
    await expect(client.getStreams(EP)).rejects.toMatchObject({ typed: 'NotFoundError', message: /only on servers/ });
  });

  it('anime-indo wrappers and the old cepat.php are skipped without a request', async () => {
    const page = `<template x-ref="emb0"><iframe src="https://anime-indo.lol/yup.php?url=https://www.yourupload.com/embed/x"></iframe></template>
      <template x-ref="emb1"><iframe src="https://xtwap.top/cepat.php?url=abc"></iframe></template>`;
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

  it('an episode page without servers is a NotFoundError', async () => {
    const { client } = await load(() => ({ status: 200, text: '<html></html>' }));
    await expect(client.getStreams(EP)).rejects.toMatchObject({ typed: 'NotFoundError', message: /no server/ });
  });
});
