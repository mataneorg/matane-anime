import { afterEach, describe, expect, it } from 'vitest';
import {
  berkasdriveUrl,
  desustreamUrl,
  parseDesustreamSource,
  hasLinkTable,
  linksOfEpisode,
  parseVidhideLinks,
  pixeldrainFile,
} from '../src/streams';
import { BASE, disposeAll, fixture, load, type Route } from './harness';

afterEach(disposeAll);

const EP12 = { url: '/dandadan-sub-indo/#episode-12', name: 'Episode 12', number: 12 };

/** The series page and the hosts that need a request. */
const site =
  (overrides: Route = () => undefined): Route =>
  (r) => {
    const own = overrides(r);
    if (own) return own;
    if (r.url.startsWith(`${BASE}/`)) return { status: 200, text: fixture('detail_dandadan.html.txt') };
    // desudrive redirects to a vidhide domain's /f/<id>; the player is /v/<id> there.
    if (r.url.startsWith('https://desudrive.com/fl/')) {
      return {
        status: 200,
        url: 'https://callistanise.com/f/abc123',
        text: fixture('vidhide_desudrive_landing.html.txt'),
      };
    }
    if (r.url.startsWith('https://callistanise.com/v/')) {
      return { status: 200, url: r.url, text: fixture('vidhide_embed.html.txt') };
    }
    if (r.url.includes('/dstream/otakuwatch3/'))
      return { status: 200, text: fixture('desustream_otakuwatch3.html.txt') };
    if (r.url.includes('/dstream/arcg/')) return { status: 200, text: fixture('desustream_arcg.html.txt') };
    return undefined;
  };

describe('parsers', () => {
  it('finds the links of one episode in the escaped payload, without decoding the rest', () => {
    const page = fixture('detail_dandadan.html.txt');
    expect(hasLinkTable(page)).toBe(true);
    const links = linksOfEpisode(page, 12);
    expect(links).toHaveLength(32);
    expect(links.every((l) => l.kind === 'episode' && l.episode === 12)).toBe(true);
    expect(new Set(links.map((l) => l.provider))).toEqual(
      new Set(['BerkasDrive', 'UsersDrive', 'Kraken', 'PDrain', 'VidHide', 'Mega', 'Komikcast']),
    );
    expect(links.find((l) => l.provider === 'BerkasDrive')?.r2ObjectKey).toMatch(/^public\/86\/nimegami/);
    expect(linksOfEpisode(page, 99)).toEqual([]);
    expect(hasLinkTable('<html></html>')).toBe(false);
  });

  it('does not mix up episode 1 with 10-12, and survives a "}" inside a value', () => {
    const one = '{\\"id\\":\\"a\\",\\"kind\\":\\"episode\\",\\"episode\\":1,\\"filename\\":\\"x}y.mp4\\"}';
    const ten = '{\\"id\\":\\"b\\",\\"kind\\":\\"episode\\",\\"episode\\":10,\\"filename\\":\\"z\\"}';
    const page = `\\"links\\":[${one},${ten}]`;
    expect(linksOfEpisode(page, 1).map((l) => l.id)).toEqual(['a']);
    expect(linksOfEpisode(page, 10).map((l) => l.id)).toEqual(['b']);
    expect((linksOfEpisode(page, 1)[0] as { filename?: string }).filename).toBe('x}y.mp4');
  });

  it('builds the direct urls', () => {
    expect(berkasdriveUrl('public/86/nimegami/[x] ep-01.mp4')).toBe(
      'https://direct-stor.berkasdrive.com/public/86/nimegami/%5Bx%5D%20ep-01.mp4',
    );
    expect(pixeldrainFile('https://pixeldrain.com/u/dwbMRygU')).toBe('https://pixeldrain.com/api/file/dwbMRygU');
    expect(pixeldrainFile('https://pixeldrain.com/d/abc')).toBeUndefined();
    expect(desustreamUrl('https://video.x.workers.dev/https://desustream.net/dstream/arcg/?id=a')).toBe(
      'https://desustream.net/dstream/arcg/?id=a',
    );
    expect(desustreamUrl('https://mega.nz/embed/x')).toBeUndefined();
  });

  it('reads the vidhide playlists and the desustream files', () => {
    const lists = parseVidhideLinks(fixture('vidhide_embed.html.txt'), 'https://callistanise.com');
    expect(lists.length).toBeGreaterThan(0);
    expect(lists.every((u) => u.startsWith('https://') && u.includes('master.m3u8'))).toBe(true);
    expect(parseVidhideLinks('<html></html>', 'https://x.com')).toEqual([]);
    expect(parseDesustreamSource(fixture('desustream_otakuwatch3.html.txt'))).toMatch(
      /^https:\/\/rr\d+---[^/]*googlevideo\.com\/videoplayback\?/,
    );
    expect(parseDesustreamSource(fixture('desustream_otakuwatch3.html.txt'))).not.toContain('&amp;');
    expect(parseDesustreamSource(fixture('desustream_arcg.html.txt'))).toMatch(
      /^https:\/\/archive\.org\/download\/.*\.mp4$/,
    );
    expect(parseDesustreamSource('<html></html>')).toBeUndefined();
  });
});

describe('getStreams', () => {
  it('lists BerkasDrive, Pixeldrain, VidHide HLS and desustream, best quality first, from one page', async () => {
    const { client, requests } = await load(site());
    const streams = await client.getStreams(EP12);
    const servers = new Set(streams.map((s) => s.server));
    expect(servers).toEqual(new Set(['BerkasDrive', 'Pixeldrain', 'VidHide', 'VidHide 2', 'Desustream']));
    expect(streams[0]).toMatchObject({ server: 'BerkasDrive', quality: 1080, kind: 'mp4' });
    expect(streams[0]?.url).toBe(
      'https://direct-stor.berkasdrive.com/public/86/nimegami-v2/nimegami-dandadan-ep-12-1080p.mp4',
    );
    const heights = streams.filter((s) => s.quality).map((s) => s.quality ?? 0);
    expect(heights).toEqual([...heights].sort((a, b) => b - a));
    expect(streams.filter((s) => s.server.startsWith('VidHide')).every((s) => s.kind === 'hls')).toBe(true);
    // The series page once; vidhide twice (landing + player) for its best quality; desustream's two players once each.
    expect(requests.map((r) => new URL(r.url).host)).toEqual(
      expect.arrayContaining(['nimegami.id', 'desudrive.com', 'callistanise.com', 'desustream.net']),
    );
    expect(requests.filter((r) => r.url.startsWith('https://desustream.net/'))).toHaveLength(2);
    expect(requests.some((r) => /pixeldrain|berkasdrive|mega\.nz|kraken|usersdrive/.test(r.url))).toBe(false);
  });

  it('keeps the direct hosts when a resolved one fails', async () => {
    const { client, logs } = await load(
      site((r) =>
        r.url.startsWith('https://desudrive.com/') || r.url.startsWith('https://desustream.net/')
          ? { status: 523 }
          : undefined,
      ),
    );
    const streams = await client.getStreams(EP12);
    expect(new Set(streams.map((s) => s.server))).toEqual(new Set(['BerkasDrive', 'Pixeldrain']));
    expect(logs.length).toBeGreaterThan(0);
  });

  it('does not wait for a dead server once another has answered', async () => {
    const started = Date.now();
    const { client } = await load(
      site((r) => (r.url.startsWith('https://desudrive.com/') ? { delayMs: 6000 } : undefined)),
    );
    const streams = await client.getStreams(EP12);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(new Set(streams.map((s) => s.server))).toEqual(new Set(['BerkasDrive', 'Pixeldrain', 'Desustream']));
  }, 10_000);

  it('an episode that only has hosts the app cannot play says so', async () => {
    const links = JSON.stringify([
      { id: 'a', kind: 'episode', episode: 5, provider: 'Mega', url: 'https://mega.nz/file/x#y', quality: '720p' },
    ]);
    const page = `<script>self.__next_f.push([1,${JSON.stringify(`"links":${links}`)}])</script>`;
    const { client } = await load(() => ({ status: 200, text: page }));
    await expect(client.getStreams({ url: '/x-sub-indo/#episode-5', name: 'x' })).rejects.toMatchObject({
      typed: 'NotFoundError',
      message: /cannot play/,
    });
    await expect(client.getStreams({ url: '/x-sub-indo/#episode-9', name: 'x' })).rejects.toMatchObject({
      typed: 'NotFoundError',
      message: /no link yet/,
    });
  });

  it('a page without a link table is a ParseError and a url that is not an episode NotFoundError', async () => {
    const { client } = await load(() => ({ status: 200, text: '<html></html>' }));
    await expect(client.getStreams(EP12)).rejects.toMatchObject({ typed: 'ParseError' });
    await expect(client.getStreams({ url: '/x-sub-indo/', name: 'x' })).rejects.toMatchObject({
      typed: 'NotFoundError',
    });
  });
});
