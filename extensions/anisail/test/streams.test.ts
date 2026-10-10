import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { dropboxDirect, parseMixdropSource, parseMp4uploadSource, readEmbeds, unwrapEmbed } from '../src/streams';
import { BASE, disposeAll, fixture, load, type Route } from './harness';

afterEach(disposeAll);

// readEmbeds runs in the sandbox, whose `base64` is stood in for here.
beforeAll(() => {
  Object.assign(globalThis, {
    base64: { decode: (text: string) => Buffer.from(text, 'base64').toString('utf8') },
  });
});

const EP = { url: '/steel-ball-run-jojo-no-kimyou-na-bouken-episode-4/', name: 'Episode 4', number: 4 };

/** Serves the episode page and the two hosts that need a request. */
const site =
  (episodeFixture: string, overrides: Route = () => undefined): Route =>
  (r) => {
    const own = overrides(r);
    if (own) return own;
    if (r.url.startsWith(BASE)) return { status: 200, text: fixture(episodeFixture) };
    if (/^https:\/\/miiiixdrop\.net\//.test(r.url)) {
      // The real page redirects to mxdrop.top; one page for every id, with the id in the file name.
      const id = r.url.split('/').pop() ?? '';
      return { status: 200, text: fixture('mixdrop_embed.html.txt').replaceAll('xwoz87qna83jzq', id) };
    }
    if (r.url.startsWith('https://mp4upload.com/')) {
      const id = r.url.split('embed-').pop()?.replace('.html', '') ?? '';
      return { status: 200, text: fixture('mp4upload_embed.html.txt').replaceAll('/video.mp4', `/${id}.mp4`) };
    }
    return undefined;
  };

describe('parsers', () => {
  it('reads the labelled servers and unwraps the popup links', () => {
    const embeds = readEmbeds(fixture('ep_all_hosts.html.txt'));
    expect(embeds.length).toBeGreaterThan(30);
    expect(embeds.find((e) => e.label === 'mp4 1080p')?.url).toMatch(/^https:\/\/mp4upload\.com\/embed-\w+\.html$/);
    const pixel = embeds.filter((e) => e.label.startsWith('pixel'));
    expect(pixel.every((e) => /^https:\/\/pixeldrain\.com\/[ud]\/\w+$/.test(e.url))).toBe(true);
    expect(embeds.filter((e) => e.label.startsWith('pancal')).every((e) => e.url.includes('dropbox.com'))).toBe(true);
    expect(embeds.some((e) => e.url.includes('&#038;') || e.url.includes('&amp;'))).toBe(false);
    expect(readEmbeds('<html></html>')).toEqual([]);
  });

  it('unwraps only the popup wrapper', () => {
    expect(
      unwrapEmbed('https://v1.animesail.xyz/utils/player/popup/?url=https%3A%2F%2Fpixeldrain.com%2Fu%2FAbc&token=x'),
    ).toBe('https://pixeldrain.com/u/Abc');
    expect(unwrapEmbed('https://mp4upload.com/embed-x.html')).toBe('https://mp4upload.com/embed-x.html');
    expect(unwrapEmbed('not an address')).toBe('not an address');
  });

  it('turns a Dropbox share into a raw link', () => {
    const direct = dropboxDirect(new URL('https://www.dropbox.com/scl/fi/abc/file.mp4?rlkey=k&dl=0'));
    const params = new URL(direct).searchParams;
    expect(params.get('raw')).toBe('1');
    expect(params.has('dl')).toBe(false);
    expect(params.get('rlkey')).toBe('k');
  });

  it('reads the mixdrop and mp4upload files, and none from a deleted one', () => {
    expect(parseMixdropSource(fixture('mixdrop_embed.html.txt'))).toMatch(
      /^https:\/\/[^/]+\.mxcontent\.net\/v2\/[\w-]+\.mp4\?/,
    );
    expect(parseMixdropSource('<html></html>')).toBeUndefined();
    expect(parseMp4uploadSource(fixture('mp4upload_embed.html.txt'))).toMatch(
      /^https:\/\/a\d+\.mp4upload\.com:183\/d\/\w+\/video\.mp4$/,
    );
    expect(parseMp4uploadSource(fixture('mp4upload_deleted.html.txt'))).toBeUndefined();
  });
});

describe('getStreams', () => {
  it('lists every host and quality, best quality first, pixeldrain before the others at the same quality', async () => {
    const { client, requests } = await load(site('ep_all_hosts.html.txt'));
    const streams = await client.getStreams(EP);
    const servers = new Set(streams.map((s) => s.server));
    expect(servers).toEqual(new Set(['Pixeldrain', 'Dropbox', 'Mixdrop', 'Mp4upload']));
    const heights = streams.map((s) => s.quality ?? 0);
    expect(heights).toEqual([...heights].sort((a, b) => b - a));
    expect(streams[0]).toMatchObject({ quality: 1080, server: 'Pixeldrain', kind: 'mp4' });
    expect(
      streams
        .filter((s) => s.server === 'Mp4upload')
        .every((s) => s.headers?.['Referer'] === 'https://www.mp4upload.com/'),
    ).toBe(true);
    // Mixdrop's file host refuses the site's Referer: nothing is sent for it.
    expect(streams.filter((s) => s.server === 'Mixdrop').every((s) => s.headers === undefined)).toBe(true);
    // Pixeldrain and Dropbox cost no request; the unreadable hosts are never asked.
    expect(
      requests.some((r) => /pixeldrain|dropbox|doply|abyss|vikingfile|buzzheavier|animesail\.xyz/.test(r.url)),
    ).toBe(false);
    expect(streams.find((s) => s.server === 'Pixeldrain')?.url).toMatch(/^https:\/\/pixeldrain\.com\/api\/file\/\w+$/);
    expect(streams.find((s) => s.server === 'Dropbox')?.url).toContain('raw=1');
  });

  it('does not wait for a dead server once another has answered', async () => {
    const started = Date.now();
    const { client } = await load(
      site('ep_all_hosts.html.txt', (r) =>
        r.url.startsWith('https://miiiixdrop.net/') ? { delayMs: 6000 } : undefined,
      ),
    );
    const streams = await client.getStreams(EP);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(new Set(streams.map((s) => s.server))).toEqual(new Set(['Pixeldrain', 'Dropbox', 'Mp4upload']));
  }, 10_000);

  it('skips a failing host and a deleted file, keeping the rest', async () => {
    const { client, logs } = await load(
      site('ep_all_hosts.html.txt', (r) => {
        if (r.url.startsWith('https://miiiixdrop.net/')) return { status: 500 };
        if (r.url.startsWith('https://mp4upload.com/'))
          return { status: 200, text: fixture('mp4upload_deleted.html.txt') };
        return undefined;
      }),
    );
    const streams = await client.getStreams(EP);
    expect(new Set(streams.map((s) => s.server))).toEqual(new Set(['Pixeldrain', 'Dropbox']));
    expect(logs.some((l) => l.includes('miiiixdrop.net'))).toBe(true);
  });

  it('a page with no readable server at all is NotFoundError', async () => {
    const page = `<select class="mirror"><option data-em="${Buffer.from("<iframe src='https://doply.net/e/abc'></iframe>").toString('base64')}">dodo 720p</option></select>`;
    const { client, requests } = await load(() => ({ status: 200, text: page }));
    await expect(client.getStreams(EP)).rejects.toMatchObject({ typed: 'NotFoundError', message: /only on servers/ });
    expect(requests).toHaveLength(1);
    const empty = await load(() => ({ status: 200, text: '<html></html>' }));
    await expect(empty.client.getStreams(EP)).rejects.toMatchObject({
      typed: 'NotFoundError',
      message: /no readable server/,
    });
  });
});
