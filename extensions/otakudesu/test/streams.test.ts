import type { HttpRequest } from '@matane-anime/extension-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { BASE, type Route, disposeAll, fixture, load } from './harness';

afterEach(disposeAll);

const EPISODE = { url: '/episode/asohia-s2-episode-1-sub-indo/', name: 'Episode 1', number: 1 };
const PAGE = `${BASE}${EPISODE.url}`;
const AJAX = `${BASE}/wp-admin/admin-ajax.php`;
const NONCE_ACTION = 'aa1208d27f29ca340c92c66d1926f13f';
const EMBED_ACTION = '2a3505c93b0035d3f455df82bf976b84';

// Mirror "<i>:<quality>" of post 206133 → the recorded admin-ajax answer. 480p has no recording: the site
// "failed" there, which a stream list must survive.
const EMBEDS: Record<string, string> = {
  '0:360p': 'ajax_embed_ongoing_360p_0.txt',
  '1:360p': 'ajax_embed_ongoing_360p_1.txt',
  '0:720p': 'ajax_embed_ongoing_720p_0.txt',
  '1:720p': 'ajax_embed_ongoing_720p_1.txt',
  '2:720p': 'ajax_embed_ongoing_720p_2.txt',
  '3:720p': 'ajax_embed_ongoing_720p_3.txt',
};

const FORM = 'application/x-www-form-urlencoded';

interface Site {
  route: Route;
  nonces: string[];
  embeds: URLSearchParams[];
}

/** The episode page, admin-ajax with its checks (form body, current nonce) and the three kinds of player. */
function site(options: { rotateOnFirstEmbed?: boolean; page?: string } = {}): Site {
  const state: Site = { route: () => undefined, nonces: [], embeds: [] };
  let current = 'nonce-1';
  let rotated = false;
  state.route = (request: HttpRequest) => {
    const { url, method } = request;
    if (url === PAGE) return { status: 200, text: options.page ?? fixture('episode_ongoing.txt') };
    if (url === AJAX && method === 'POST') {
      const headers = Object.fromEntries(Object.entries(request.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
      // An object body would have been sent as JSON, which the real site answers with 400.
      if (headers['content-type'] !== FORM || typeof request.body !== 'string') return { status: 400, text: '0' };
      const form = new URLSearchParams(request.body);
      if (form.get('action') === NONCE_ACTION) {
        state.nonces.push(current);
        return { status: 200, text: JSON.stringify({ data: current }) };
      }
      if (form.get('action') !== EMBED_ACTION) return { status: 400, text: '0' };
      state.embeds.push(form);
      if (options.rotateOnFirstEmbed && !rotated) {
        rotated = true;
        current = 'nonce-2';
        return { status: 403, text: fixture('ajax_embed_ongoing_badnonce.txt') };
      }
      if (form.get('nonce') !== current || form.get('id') !== '206133') {
        return { status: 403, text: fixture('ajax_embed_ongoing_badnonce.txt') };
      }
      const file = EMBEDS[`${form.get('i')}:${form.get('q')}`];
      return file ? { status: 200, text: fixture(file) } : { status: 500, text: '' };
    }
    if (url.startsWith('https://odvidhide.com/embed/')) return { status: 200, text: fixture('iframe_odvidhide.txt') };
    if (url.includes('/dstream/arcg/')) return { status: 200, text: fixture('iframe_desustream_arcg_720.txt') };
    if (url.includes('/dstream/ondesu/')) return { status: 200, text: fixture('iframe_desustream_ondesuhd.txt') };
    return undefined;
  };
  return state;
}

describe('getStreams', () => {
  it('walks the page, the nonce, each mirror and each player down to direct URLs', async () => {
    const mock = site();
    const { client, requests } = await load(mock.route);
    const streams = await client.getStreams(EPISODE);

    // 720p first; within a quality the stable hosts come before the expiring googlevideo link. The 360p
    // vidhide mirror serves the same recorded player page, so its link is a duplicate and is dropped.
    expect(streams.map((s) => [s.server, s.quality, s.kind])).toEqual([
      ['odstream 720p', 720, 'mp4'],
      ['vidhide 720p', 720, 'hls'],
      ['ondesuhd 720p', 720, 'mp4'],
    ]);
    expect(streams[0]?.url).toMatch(/^https:\/\/archive\.org\/download\/.+\.mp4$/);
    expect(streams[1]?.url).toMatch(/^https:\/\/VyY3AyGtEHNQnhdR\.acek-cdn\.com\/hls2\/.+\/master\.m3u8\?/);
    expect(streams[2]?.url).toMatch(/googlevideo\.com\/videoplayback\?/);
    expect(streams[0]?.headers).toEqual({ Referer: 'https://desustream.net/' });
    expect(streams[1]?.headers).toEqual({ Referer: 'https://odvidhide.com/' });

    // One nonce for the whole episode, shared by the two mirrors asked together. Reading stops at three
    // streams: the 4th 720p mirror and the lower qualities are never asked for.
    expect(mock.nonces).toHaveLength(1);
    expect(mock.embeds.map((f) => `${f.get('i')}:${f.get('q')}`)).toEqual(['0:720p', '1:720p', '2:720p']);
    expect(requests.some((r) => r.url.includes('mega.nz'))).toBe(false);
  });

  it('keeps going down the list when the best mirrors fail, and says so in the log', async () => {
    const mock = site();
    const { client, logs } = await load((request) =>
      request.url === AJAX && typeof request.body === 'string' && request.body.includes('q=720p')
        ? { status: 500, text: '' }
        : mock.route(request),
    );
    const streams = await client.getStreams(EPISODE);
    expect(streams.length).toBeGreaterThan(0);
    const warned = (quality: string) => logs.filter((l) => l.startsWith('warn:') && l.includes(quality)).length;
    expect(warned('720p')).toBe(4);
    expect(warned('480p')).toBe(3); // no recording either: the site "failed" there too
  });

  it('asks for a fresh nonce once when the site rotates it', async () => {
    const mock = site({ rotateOnFirstEmbed: true });
    const { client } = await load(mock.route);
    const streams = await client.getStreams(EPISODE);
    expect(streams.length).toBeGreaterThan(0);
    expect(mock.nonces).toEqual(['nonce-1', 'nonce-2']);
  });

  it('follows the action names in the page script', async () => {
    const changed = fixture('episode_ongoing.txt').replaceAll(EMBED_ACTION, '0'.repeat(32));
    const { client } = await load(site({ page: changed }).route);
    // The mock only knows the old name, so every mirror is refused: the protocol, not the episode, is wrong.
    await expect(client.getStreams(EPISODE)).rejects.toMatchObject({ typed: 'ParseError' });
  });

  it('reports a theme change when the script has no actions at all', async () => {
    const stripped = fixture('episode_ongoing.txt').replaceAll(/action:"[0-9a-f]{32}"/g, 'x:1');
    const { client } = await load(site({ page: stripped }).route);
    await expect(client.getStreams(EPISODE)).rejects.toMatchObject({ typed: 'ParseError' });
  });

  it('has no playable server when only the maintenance page is left', async () => {
    const { client } = await load((request) =>
      request.url === `${BASE}/episode/hsiawmdh-episode-1-sub-indo/`
        ? { status: 200, text: fixture('episode_complete.txt') }
        : undefined,
    );
    await expect(
      client.getStreams({ url: '/episode/hsiawmdh-episode-1-sub-indo/', name: 'Episode 1' }),
    ).rejects.toMatchObject({
      typed: 'NotFoundError',
    });
  });

  it('says "not found" when the site sends the episode to another domain', async () => {
    const { client } = await load(() => ({ status: 200, url: 'https://otakudesu.io/', text: 'landing' }));
    await expect(client.getStreams(EPISODE)).rejects.toMatchObject({ typed: 'NotFoundError' });
  });

  it('falls back to the default player when the page has no mirror list', async () => {
    const bare = `<html><body><div id="pembed"><iframe src="https://desustream.net/dstream/arcg/?id=x"></iframe></div></body></html>`;
    const { client } = await load(site({ page: bare }).route);
    const streams = await client.getStreams(EPISODE);
    expect(streams).toHaveLength(1);
    expect(streams[0]?.server).toBe('default');
  });
});
