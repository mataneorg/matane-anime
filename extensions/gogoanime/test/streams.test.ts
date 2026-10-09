import { afterEach, describe, expect, it } from 'vitest';
import { parseFileUrl, parseIframe, parseMegaplayPlaylist, readServers } from '../src/streams';
import { BASE, disposeAll, fixture, load, type Route } from './harness';

afterEach(disposeAll);

const SUB = { url: '/steel-ball-run-jojo-no-kimyou-na-bouken-episode-4-english-subbed/', name: 'Episode 4', number: 4 };
const DUB = { url: '/one-piece-episode-1123-english-dubbed/', name: 'Episode 1123', number: 1123 };

/** Serves an episode page and, for each of its servers, the wrapper fixture saved for it. */
const site = (episode: 'ep_sub' | 'ep_dub', overrides: Route = () => undefined): Route => {
  const page = fixture(`${episode}.html.txt`);
  const wrappers = new Map(readServers(page).map((s) => [s.src, fixture(`player_${episode}_${s.label}.html.txt`)]));
  return (r) => {
    const own = overrides(r);
    if (own) return own;
    if (r.url.startsWith(`${BASE}/player/`)) return { status: 200, text: wrappers.get(r.url) ?? '' };
    if (r.url.startsWith(BASE)) return { status: 200, text: page };
    if (r.url.startsWith('https://megaplay.su/embed.php'))
      return { status: 200, text: fixture('megaplay_embed.html.txt') };
    if (r.url === 'https://megavid.buzz/mal/21/1123/dub/source')
      return { status: 200, text: fixture('megavid_dub_source.json') };
    return undefined;
  };
};

describe('parsers', () => {
  it('reads the servers of a sub and a dub episode page', () => {
    const sub = readServers(fixture('ep_sub.html.txt'));
    expect(sub.map((s) => [s.type, s.label])).toEqual([
      ['sub', 'SD'],
      ['sub', 'HD'],
    ]);
    expect(sub[0]?.src).toMatch(/^https:\/\/gogoanime\.by\/player\/\?source=blogger&url=/);
    expect(readServers(fixture('ep_dub.html.txt')).map((s) => [s.type, s.label])).toEqual([
      ['dub', 'Mega'],
      ['dub', 'SD'],
    ]);
    expect(readServers('<html></html>')).toEqual([]);
  });

  it('reads the wrapper pages', () => {
    const file = parseFileUrl(fixture('player_ep_sub_SD.html.txt'));
    expect(file).toMatch(/^https:\/\/rr\d+---[^/]*googlevideo\.com\/videoplayback\?/);
    expect(file).not.toMatch(/\\|&amp;/);
    expect(parseIframe(fixture('player_ep_sub_HD.html.txt'))).toMatch(/^https:\/\/megaplay\.su\/embed\.php\?sid=/);
    expect(parseIframe(fixture('player_ep_dub_Mega.html.txt'))).toBe('https://megavid.buzz/mal/21/1123/dub');
    expect(parseMegaplayPlaylist(fixture('megaplay_embed.html.txt'))).toMatch(
      /^https:\/\/megaplay\.su\/uploads\/hls\/[^/]+\/index\.m3u8\?v=\d+$/,
    );
    expect(parseFileUrl('<html></html>')).toBeUndefined();
    expect(parseMegaplayPlaylist('<html></html>')).toBeUndefined();
  });
});

describe('getStreams', () => {
  it('a sub: the hardsub HD playlist first, then the SD mp4', async () => {
    const { client, requests } = await load(site('ep_sub'));
    const streams = await client.getStreams(SUB);
    expect(streams.map((s) => [s.server, s.kind, s.quality])).toEqual([
      ['HD', 'hls', undefined],
      ['SD', 'mp4', 360],
    ]);
    expect(streams[0]?.url).toMatch(/^https:\/\/megaplay\.su\/uploads\/hls\//);
    // The wrappers are asked with the episode page as Referer.
    const wrapper = requests.find((r) => r.url.startsWith(`${BASE}/player/`));
    expect(wrapper?.headers?.['Referer']).toBe(`${BASE}${SUB.url}`);
  });

  it('a dub: Mega (megavid source) first, then the SD mp4', async () => {
    const { client, requests } = await load(site('ep_dub'));
    const streams = await client.getStreams(DUB);
    expect(streams.map((s) => [s.server, s.kind])).toEqual([
      ['Mega', 'hls'],
      ['SD', 'mp4'],
    ]);
    expect(streams[0]?.url).toMatch(/^https:\/\/cdnx\.aniwatchtv\.site\/uwu\//);
    expect(requests.some((r) => r.url === 'https://megavid.buzz/mal/21/1123/dub/source')).toBe(true);
  });

  it('skips a failing server and keeps the other', async () => {
    const { client, logs } = await load(
      site('ep_sub', (r) => (r.url.startsWith('https://megaplay.su/') ? { status: 500 } : undefined)),
    );
    expect((await client.getStreams(SUB)).map((s) => s.server)).toEqual(['SD']);
    expect(logs.some((l) => l.includes('HD'))).toBe(true);
  });

  it('an unknown player host and a megavid answer without a source are failures, not crashes', async () => {
    const { client } = await load(
      site('ep_dub', (r) => (r.url.endsWith('/dub/source') ? { status: 200, text: '{"status":"error"}' } : undefined)),
    );
    expect((await client.getStreams(DUB)).map((s) => s.server)).toEqual(['SD']);
    const broken = await load(
      site('ep_sub', (r) =>
        r.url.startsWith(`${BASE}/player/`)
          ? { status: 200, text: '<iframe src="https://evil.example/e"></iframe>' }
          : undefined,
      ),
    );
    await expect(broken.client.getStreams(SUB)).rejects.toMatchObject({
      typed: 'NotFoundError',
      message: /could be read/,
    });
  });

  it('an episode without servers is a NotFoundError', async () => {
    const { client } = await load(() => ({ status: 200, text: '<html></html>' }));
    await expect(client.getStreams(SUB)).rejects.toMatchObject({ typed: 'NotFoundError', message: /no server/ });
  });
});
