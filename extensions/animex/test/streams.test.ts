import { afterEach, describe, expect, it } from 'vitest';
import { streamHeaders } from '../src/streams';
import { disposeAll, fixture, load, type Route } from './harness';

afterEach(disposeAll);

const PP = 'https://pp.animex.one';
const SUB = { url: 'attack-on-titan-2jqd0/1/sub', name: 'Episode 1', number: 1, variant: 'Sub' };
const DUB = { url: 'attack-on-titan-2jqd0/1/dub', name: 'Episode 1', number: 1, variant: 'Dub' };

const answers: Record<string, string> = {
  nero: 'sources_nero_sub.json',
  loli: 'sources_loli_sub.json',
  yuki: 'sources_yuki_sub.json',
  zuna: 'sources_zuna_sub.json',
  sora: 'sources_sora_sub.json',
};

const api =
  (overrides: Route = () => undefined): Route =>
  (r) => {
    const own = overrides(r);
    if (own) return own;
    const url = new URL(r.url);
    if (url.pathname === '/rest/api/servers') return { status: 200, text: fixture('servers_aot.json') };
    if (url.pathname === '/rest/api/sources') {
      const provider = url.searchParams.get('providerId') ?? '';
      const file =
        url.searchParams.get('type') === 'dub' && provider === 'nero' ? 'sources_nero_dub.json' : answers[provider];
      return file ? { status: 200, text: fixture(file) } : { status: 404, text: '{"error":"provider not found"}' };
    }
    return undefined;
  };

describe('stream headers', () => {
  it('keeps only Origin and Referer, as the answer gives them', () => {
    expect(
      streamHeaders('https://fetch.nexabloom.top/a/master.m3u8', {
        Origin: 'https://megaplay.buzz',
        Referer: 'https://megaplay.buzz/',
        'User-Agent': 'x',
        Cookie: 'y',
      }),
    ).toEqual({ Origin: 'https://megaplay.buzz', Referer: 'https://megaplay.buzz/' });
    expect(streamHeaders('https://x.example/a.m3u8', {})).toEqual({});
    expect(streamHeaders('https://x.example/a.m3u8', null)).toEqual({});
  });

  it('adds the Origin the krussdomi CDN checks (its answer only names a Referer)', () => {
    expect(
      streamHeaders('https://hls.krussdomi.com/manifest/x/master.m3u8', {
        Referer: 'https://kaa.lt/',
        'User-Agent': 'android',
      }),
    ).toEqual({ Origin: 'https://krussdomi.com', Referer: 'https://krussdomi.com/' });
    expect(streamHeaders('https://bl.krussdomi.com/playlist/x/master.m3u8', undefined)).toMatchObject({
      Origin: 'https://krussdomi.com',
    });
  });
});

describe('getStreams', () => {
  it('asks the providers the episode has, the ones without a separate subtitle track first', async () => {
    const { client, requests } = await load(api());
    const streams = await client.getStreams(SUB);
    // The fixture lists nero, yuki and zuna for the sub of this title.
    expect(streams.map((s) => s.server)).toEqual(['nero', 'yuki', 'zuna']);
    expect(streams.every((s) => s.kind === 'hls')).toBe(true);
    expect(streams[0]?.url).toMatch(/^https:\/\/vault-\d+\.aniwatchtv\.site\//);
    expect(streams[0]?.headers).toBeUndefined();
    expect(streams[1]?.headers).toEqual({ Origin: 'https://megaplay.buzz', Referer: 'https://megaplay.buzz/' });
    expect(streams[2]?.headers).toEqual({ Referer: 'https://zokoanime.video/' });
    expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
      '/rest/api/servers',
      '/rest/api/sources',
      '/rest/api/sources',
      '/rest/api/sources',
    ]);
    expect(requests.every((r) => r.url.startsWith(PP))).toBe(true);
  });

  it('asks for the dub with type=dub and only the dub providers', async () => {
    const { client, requests } = await load(api());
    const streams = await client.getStreams(DUB);
    expect(streams.map((s) => s.server)).toEqual(['nero', 'yuki']);
    const types = requests
      .filter((r) => r.url.includes('/sources'))
      .map((r) => new URL(r.url).searchParams.get('type'));
    expect(types).toEqual(['dub', 'dub']);
  });

  it('skips a provider that fails and keeps the others', async () => {
    const { client, logs } = await load(
      api((r) => (r.url.includes('providerId=nero') ? { status: 404, text: '{"error":"x"}' } : undefined)),
    );
    expect((await client.getStreams(SUB)).map((s) => s.server)).toEqual(['yuki', 'zuna']);
    expect(logs.some((l) => l.includes('nero'))).toBe(true);
  });

  it('says so when the episode has no dub yet, or only providers the app does not know', async () => {
    const none = await load(() => ({ status: 200, text: '{"subProviders":[{"id":"nero"}],"dubProviders":[]}' }));
    await expect(none.client.getStreams(DUB)).rejects.toMatchObject({ typed: 'NotFoundError', message: /no dub yet/ });
    const unknown = await load(() => ({ status: 200, text: '{"subProviders":[{"id":"beep"}],"dubProviders":[]}' }));
    await expect(unknown.client.getStreams(SUB)).rejects.toMatchObject({
      typed: 'NotFoundError',
      message: /does not know/,
    });
  });

  it('fails clearly when every provider fails, and refuses an url that is not an episode', async () => {
    const { client } = await load(api((r) => (r.url.includes('/sources') ? { status: 500 } : undefined)));
    await expect(client.getStreams(SUB)).rejects.toMatchObject({ typed: 'NotFoundError', message: /could be read/ });
    await expect(client.getStreams({ url: 'x', name: 'x' })).rejects.toMatchObject({ typed: 'NotFoundError' });
  });
});
