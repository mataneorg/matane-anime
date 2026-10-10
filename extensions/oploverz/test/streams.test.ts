import { afterEach, describe, expect, it } from 'vitest';
import { parseBloggerResponse } from '../src/streams';
import { BASE, disposeAll, fixture, load } from './harness';

afterEach(disposeAll);

const RPC =
  'https://www.blogger.com/_/BloggerVideoPlayerUi/data/batchexecute?rpcids=WcwnYd&source-path=%2Fvideo.g&rt=c';

describe('parseBloggerResponse', () => {
  it('reads the direct mp4 with its quality from the batchexecute answer', () => {
    const links = parseBloggerResponse(fixture('blogger_rpc.txt'));
    expect(links).toHaveLength(1);
    expect(links[0]?.quality).toBe(360);
    expect(links[0]?.url).toMatch(/^https:\/\/rr\d+---[^/]+\.googlevideo\.com\/videoplayback\?expire=\d+&/);
    expect(links[0]?.url).toContain('mime=video/mp4');
    expect(links[0]?.url).not.toContain('\\');
  });
});

describe('getStreams', () => {
  const old = { url: 'one-piece/1', name: 'Episode 1', number: 1 };
  const next = { url: 'one-piece/1180', name: 'Episode 1180', number: 1180 };

  it('resolves a Blogger embed through the RPC', async () => {
    const { client, requests } = await load((r) => {
      if (r.url === `${BASE}/series/one-piece/episodes/1`) return { status: 200, text: fixture('episode_detail.json') };
      if (r.url === RPC) return { status: 200, text: fixture('blogger_rpc.txt') };
      return undefined;
    });
    const streams = await client.getStreams(old);
    expect(streams).toHaveLength(1);
    expect(streams[0]).toMatchObject({ server: 'Blogger', kind: 'mp4', quality: 360 });
    const rpc = requests.find((r) => r.url === RPC);
    expect(rpc?.method).toBe('POST');
    expect(decodeURIComponent(String(rpc?.body))).toContain('WcwnYd');
  });

  it('fails with a clear message when only unreadable hosts (upbolt) exist', async () => {
    const { client, requests } = await load((r) =>
      r.url === `${BASE}/series/one-piece/episodes/1180`
        ? { status: 200, text: fixture('episode_new.json') }
        : undefined,
    );
    await expect(client.getStreams(next)).rejects.toThrow(/only on servers/);
    expect(requests).toHaveLength(1);
  });

  it('puts Dailymotion HLS first and survives a failing server', async () => {
    const detail = {
      data: {
        streamUrl: [
          { source: 'sd', url: 'https://www.blogger.com/video.g?token=dead' },
          { source: 'HD', url: 'https://filedon.co/embed/abc' },
          { source: 'HD', url: 'https://geo.dailymotion.com/player.html?video=k5ltbUFE062WDxKod6S&' },
          { source: 'HD', url: 'not a url' },
        ],
      },
    };
    const { client } = await load((r) => {
      if (r.url === `${BASE}/series/one-piece/episodes/1`) return { status: 200, text: JSON.stringify(detail) };
      if (r.url.startsWith('https://www.dailymotion.com/player/metadata/video/k5ltbUFE062WDxKod6S'))
        return { status: 200, text: fixture('dailymotion_metadata.json') };
      if (r.url === RPC) return { status: 200, text: ')]}\'\n\n[["wrb.fr","WcwnYd",null]]' };
      return undefined;
    });
    const streams = await client.getStreams(old);
    expect(streams).toHaveLength(1);
    expect(streams[0]).toMatchObject({ server: 'Dailymotion', kind: 'hls' });
    expect(streams[0]?.url).toMatch(/\.m3u8/);
  });

  it('reads every server and returns all their streams, HLS first', async () => {
    const detail = {
      data: {
        streamUrl: [
          { source: 'sd', url: 'https://www.blogger.com/video.g?token=ok' },
          { source: 'HD', url: 'https://geo.dailymotion.com/player.html?video=k5ltbUFE062WDxKod6S&' },
        ],
      },
    };
    const { client, requests } = await load((r) => {
      if (r.url === `${BASE}/series/one-piece/episodes/1`) return { status: 200, text: JSON.stringify(detail) };
      if (r.url.startsWith('https://www.dailymotion.com/player/metadata/video/'))
        return { status: 200, text: fixture('dailymotion_metadata.json') };
      if (r.url === RPC) return { status: 200, text: fixture('blogger_rpc.txt') };
      return undefined;
    });
    const streams = await client.getStreams(old);
    expect(streams.map((s) => s.server)).toEqual(['Dailymotion', 'Blogger']);
    expect(requests).toHaveLength(3);
  });

  it('reports when the API has no such episode', async () => {
    const { client } = await load((r) => ({ status: 404, text: '{}', url: r.url }));
    await expect(client.getStreams(old)).rejects.toThrow();
  });
});
