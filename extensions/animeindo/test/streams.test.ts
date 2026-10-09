import { afterEach, describe, expect, it } from 'vitest';
import {
  parseBtubeSource,
  parseMp4uploadSource,
  parsePlaylist,
  parseYouruploadSource,
  readEmbeds,
  unwrapEmbed,
} from '../src/streams';
import { BASE, disposeAll, fixture, load, type Route } from './harness';

afterEach(disposeAll);

const EP = { url: '/show-by-rock-stars-episode-06/', name: 'Episode 6', number: 6 };

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
    if (r.url.startsWith(BASE)) return { status: 200, text: fixture(episodeFixture) };
    if (r.url.includes('/btube3.php')) return { status: 200, text: fixture('xtwap_btube.html.txt') };
    if (r.url.includes('/cepat2.php')) return { status: 200, text: fixture('xtwap_cepat2.html.txt') };
    if (r.url.includes('/hls.php')) return { status: 200, text: fixture('xtwap_hls.html.txt') };
    // The same page for every id, with the id in the file name so that two servers are two different streams.
    const id = r.url.split(/[/-]/).pop()?.replace('.html', '');
    if (r.url.startsWith('https://www.mp4upload.com/'))
      return { status: 200, text: fixture('mp4upload_live.html.txt').replaceAll('/video.mp4', `/${id}.mp4`) };
    if (r.url.startsWith('https://www.yourupload.com/embed/Dnrr1d2YY4S3'))
      return { status: 200, text: fixture('yourupload_dead.html.txt') };
    if (r.url.startsWith('https://www.yourupload.com/'))
      return { status: 200, text: fixture('yourupload_embed.html.txt').replaceAll('/video.mp4', `/${id}.mp4`) };
    return undefined;
  };

describe('parsers', () => {
  it('reads the servers of a new episode (buttons, no duplicate of the iframe)', () => {
    const embeds = readEmbeds(fixture('ep_new.html.txt'), BASE);
    expect(embeds.map((e) => [e.label, new URL(e.url).host])).toEqual([
      ['B-TUBE', 'play.xtwap.top'],
      ['CEPAT', 'play.xtwap.top'],
      ['GDRIVE', 'gdplayer.to'],
    ]);
  });

  it('reads an old episode and unwraps yup.php', () => {
    const embeds = readEmbeds(fixture('ep_old.html.txt'), BASE);
    expect(embeds.map((e) => e.label)).toEqual(['GDRIVE', 'MP4', 'MP4 HD', 'YUP', 'YUP HD']);
    expect(embeds[3]?.url).toBe('https://www.yourupload.com/embed/1O8U6a2l82n4');
    expect(readEmbeds('<html></html>', BASE)).toEqual([]);
  });

  it('falls back to the default iframe when there are no buttons', () => {
    const page = '<iframe id="tontonin" src="https://www.mp4upload.com/embed-abc.html" allowfullscreen></iframe>';
    expect(readEmbeds(page, BASE)).toEqual([{ label: '', url: 'https://www.mp4upload.com/embed-abc.html' }]);
  });

  it('unwraps only the yup.php wrapper', () => {
    expect(unwrapEmbed('/yup.php?url=https://www.yourupload.com/embed/x', BASE)).toBe(
      'https://www.yourupload.com/embed/x',
    );
    expect(unwrapEmbed('https://play.xtwap.top/hls.php?link=a%2Fb', BASE)).toBe(
      'https://play.xtwap.top/hls.php?link=a%2Fb',
    );
  });

  it('reads btube, cepat2 and hls pages', () => {
    const mp4 = parseBtubeSource(fixture('xtwap_btube.html.txt'));
    expect(mp4).toMatch(/^https:\/\/rr\d+---[^/]*googlevideo\.com\/videoplayback\?/);
    expect(mp4).not.toContain('&amp;');
    expect(parsePlaylist(fixture('xtwap_cepat2.html.txt'))).toMatch(/^https:\/\/hls\.xtwap\.top\/.*\.m3u8$/);
    expect(parsePlaylist(fixture('xtwap_hls.html.txt'))).toMatch(
      /^https:\/\/hls\.xtwap\.top\/video\/data\/.*\/index\.m3u8$/,
    );
    expect(parseBtubeSource('<source src="">')).toBeUndefined();
    expect(parsePlaylist('{"file":""}')).toBeUndefined();
  });

  it('reads mp4upload and yourupload files, and none from dead ones', () => {
    expect(parseMp4uploadSource(fixture('mp4upload_live.html.txt'))).toMatch(
      /^https:\/\/a\d+\.mp4upload\.com:183\/d\/\w+\/video\.mp4$/,
    );
    expect(parseMp4uploadSource(fixture('mp4upload_deleted.html.txt'))).toBeUndefined();
    expect(parseYouruploadSource(fixture('yourupload_embed.html.txt'))).toMatch(
      /^https:\/\/vidcache\.net:8161\/.*\/video\.mp4$/,
    );
    expect(parseYouruploadSource(fixture('yourupload_dead.html.txt'))).toBeUndefined();
  });
});

describe('getStreams', () => {
  it('ranks cepat HLS, btube mp4, then the mp4upload file that gdplayer wraps', async () => {
    const { client, requests } = await load(site('ep_new.html.txt', gdplayer));
    const streams = await client.getStreams(EP);
    expect(streams.map((s) => [s.server, s.kind])).toEqual([
      ['Cepat', 'hls'],
      ['B-Tube', 'mp4'],
      ['Mp4upload', 'mp4'],
    ]);
    expect(streams[2]?.headers).toEqual({ Referer: 'https://www.mp4upload.com/' });
    // The id came from the decrypted API answer.
    expect(requests.some((r) => r.url === 'https://www.mp4upload.com/embed-jzghjw19unjf.html')).toBe(true);
    const api = requests.find((r) => r.url === 'https://gdplayer.to/api/');
    expect(api?.method).toBe('POST');
    expect(api?.headers).toMatchObject({ 'X-Ts': '1791552484', 'X-Nc': '820a5cb8b6e33e2b01ae53d2e1a86f97' });
    const btube = requests.find((r) => r.url.includes('btube3.php'));
    expect(Object.keys(btube?.headers ?? {}).map((h) => h.toLowerCase())).not.toContain('referer');
  });

  it('a gdplayer failure does not hide the other servers, and gdplayer is skipped next to a plain mp4upload', async () => {
    const failing = await load(
      site('ep_new.html.txt', (r) => (r.url.startsWith('https://gdplayer.to/api/') ? { status: 500 } : gdplayer(r))),
    );
    expect((await failing.client.getStreams(EP)).map((s) => s.server)).toEqual(['Cepat', 'B-Tube']);
    const plain = await load(site('ep_old.html.txt', gdplayer));
    await plain.client.getStreams(EP);
    expect(plain.requests.some((r) => r.url.includes('gdplayer.to'))).toBe(false);
  });

  it('reads gdriveplayer as an HLS playlist, from its protocol-relative iframe', async () => {
    const page =
      '<div class="servers"><a class="server" data-video="//gdriveplayer.to/embed2.php?link=abc&amp;no_adult=yes">GDRIVE</a></div>';
    const { client, requests } = await load(
      site('', (r) => (r.url.startsWith(BASE) ? { status: 200, text: page } : gdriveplayer(r))),
    );
    const streams = await client.getStreams(EP);
    expect(streams).toHaveLength(1);
    expect(streams[0]).toMatchObject({ server: 'Gdriveplayer', kind: 'hls' });
    expect(streams[0]?.url).toMatch(/^https:\/\/gdriveplayer\.to\/hlsplaylist\.php\?s=.*\.m3u8$/);
    expect(requests[1]?.url).toBe('https://gdriveplayer.to/embed2.php?link=abc&no_adult=yes');
  });

  it('reads an old episode: hls.php, mp4upload with its Referer, yourupload with the embed as Referer', async () => {
    const { client } = await load(site('ep_old.html.txt'));
    const streams = await client.getStreams(EP);
    expect(streams.map((s) => s.server)).toEqual(['Cepat', 'Mp4upload', 'Mp4upload HD', 'Yourupload', 'Yourupload HD']);
    expect(streams[1]).toMatchObject({ kind: 'mp4', headers: { Referer: 'https://www.mp4upload.com/' } });
    expect(streams[3]).toMatchObject({
      kind: 'mp4',
      headers: { Referer: 'https://www.yourupload.com/embed/1O8U6a2l82n4' },
    });
  });

  it('a dead yourupload file (novideo) and a deleted mp4upload file are skipped quietly', async () => {
    const { client } = await load(
      site('ep_old.html.txt', (r) =>
        r.url.includes('mp4upload.com') ? { status: 200, text: fixture('mp4upload_deleted.html.txt') } : undefined,
      ),
    );
    const streams = await client.getStreams(EP);
    expect(streams.map((s) => s.server)).toEqual(['Cepat', 'Yourupload', 'Yourupload HD']);
    const gone = await load(
      site('ep_old.html.txt', (r) => {
        if (r.url.includes('hls.php')) return { status: 500 };
        if (r.url.includes('mp4upload.com')) return { status: 200, text: fixture('mp4upload_deleted.html.txt') };
        if (r.url.includes('yourupload.com')) return { status: 200, text: fixture('yourupload_dead.html.txt') };
        return undefined;
      }),
    );
    await expect(gone.client.getStreams(EP)).rejects.toMatchObject({
      typed: 'NotFoundError',
      message: /could be read/,
    });
  });

  it('a dead btube token (empty source) is skipped and the other servers stay', async () => {
    const { client, logs } = await load(
      site('ep_new.html.txt', (r) =>
        r.url.includes('btube3.php') ? { status: 200, text: '<source src="">' } : undefined,
      ),
    );
    const streams = await client.getStreams(EP);
    expect(streams.map((s) => s.server)).toEqual(['Cepat']);
    expect(logs.some((l) => l.includes('play.xtwap.top'))).toBe(true);
  });

  it('says so when only unsupported hosts exist, without asking them', async () => {
    const page =
      '<div class="servers"><a class="server" data-video="https://terabox.com/sharing/embed?surl=abc" href="#">TERA</a></div>';
    const { client, requests } = await load(() => ({ status: 200, text: page }));
    await expect(client.getStreams(EP)).rejects.toMatchObject({ typed: 'NotFoundError', message: /only on servers/ });
    expect(requests).toHaveLength(1);
  });

  it('an episode page without servers is a NotFoundError', async () => {
    const { client } = await load(() => ({ status: 200, text: '<html></html>' }));
    await expect(client.getStreams(EP)).rejects.toMatchObject({
      typed: 'NotFoundError',
      message: /no readable server/,
    });
  });
});
