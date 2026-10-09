import { afterEach, describe, expect, it } from 'vitest';
import { BASE, disposeAll, fixture, load } from './harness';

afterEach(disposeAll);

const EP = { url: '/anime/fqvspc7f/1', name: 'Episode 1', number: 1 };

describe('getStreams', () => {
  it('returns the HLS master of the player, with no headers', async () => {
    const { client, requests } = await load(() => ({ status: 200, text: fixture('episode.html.txt') }));
    const streams = await client.getStreams(EP);
    expect(streams).toEqual([
      {
        url: 'https://suzaku.xin-cdn.xyz/a0b3a94e-5195-42e0-bf69-fb0eeacea170/master.m3u8',
        server: 'AniZone',
        kind: 'hls',
      },
    ]);
    expect(requests.map((r) => r.url)).toEqual([`${BASE}/anime/fqvspc7f/1`]);
  });

  it('the master is multi-audio with 360/720/1080 variants and no key to fetch (nothing for the extension to do)', () => {
    const master = fixture('master.m3u8.txt');
    expect(master).toContain('#EXT-X-MEDIA:TYPE=AUDIO');
    expect([...master.matchAll(/RESOLUTION=\d+x(\d+)/g)].map((m) => Number(m[1]))).toEqual([360, 720, 1080]);
  });

  it('a page without a player is NotFoundError, an unreadable player a ParseError', async () => {
    const none = await load(() => ({ status: 200, text: '<html><body>Coming soon</body></html>' }));
    await expect(none.client.getStreams(EP)).rejects.toMatchObject({ typed: 'NotFoundError' });
    const broken = await load(() => ({
      status: 200,
      text: '<div x-data="vidstackPlayer(JSON.parse(\'{not json\'))"></div>',
    }));
    await expect(broken.client.getStreams(EP)).rejects.toMatchObject({ typed: 'ParseError' });
    const notHls = await load(() => ({
      status: 200,
      text: '<div x-data="vidstackPlayer(JSON.parse(\'{\\u0022src\\u0022:\\u0022https:\\\\/\\\\/x.test\\\\/v.mp4\\u0022}\'))"></div>',
    }));
    await expect(notHls.client.getStreams(EP)).rejects.toMatchObject({ typed: 'ParseError' });
  });

  it('a missing episode is NotFoundError', async () => {
    const { client } = await load(() => ({ status: 404 }));
    await expect(client.getStreams(EP)).rejects.toMatchObject({ typed: 'NotFoundError' });
  });
});
