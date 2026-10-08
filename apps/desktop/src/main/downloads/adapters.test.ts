import type { Stream } from '@matane-anime/extension-sdk';
import { describe, expect, it } from 'vitest';
import { createDownloadUpstream, createStreamSource } from './adapters';

const streams: Stream[] = [
  { url: 'https://x/360.m3u8', server: 'A', quality: 360 },
  { url: 'https://x/1080.m3u8', server: 'A', quality: 1080 },
  { url: 'https://x/720.m3u8', server: 'B', quality: 720 },
];

function source(
  options: { manual?: { server?: string; quality?: number | null } | null; lastServer?: string | null } = {},
) {
  const asked: { fresh: boolean }[] = [];
  const make = createStreamSource({
    episodes: {
      get: (id) =>
        id === 1 ? ({ id: 1, animeId: 5, url: '/e', name: 'E', number: 1, variant: null } as never) : undefined,
    },
    anime: {
      get: () => ({ id: 5, sourceId: 'example/en' }) as never,
      playbackPrefs: () => options.manual ?? null,
    },
    settings: {
      getAppSettings: () => ({ playerQuality: '720' }) as never,
      getValue: <T>(_key: string, fallback: T) => (options.lastServer ?? fallback) as T,
    },
    extensions: {
      assertAvailable: (sourceId: string) => {
        if (sourceId !== 'example/en') throw new Error('not loaded');
      },
      streamsFor: async (_row, _episode, fresh) => {
        asked.push({ fresh });
        return streams;
      },
    },
  });
  return { make, asked };
}

describe('createStreamSource', () => {
  it('"as played" ranks like the player: the pick for this anime, then the player quality', async () => {
    const plain = await source().make(1, false, 'playback');
    expect(plain.streams.map((s) => s.quality)).toEqual([720, 360, 1080]);
    expect(plain.extensionId).toBe('example');
    const manual = await source({ manual: { server: 'A', quality: 1080 } }).make(1, false, 'playback');
    expect(manual.streams[0]?.quality).toBe(1080);
  });

  it('a fixed quality ignores what was picked while watching', async () => {
    const result = await source({ manual: { server: 'A', quality: 1080 }, lastServer: 'B' }).make(1, false, '360');
    expect(result.streams.map((s) => s.quality)).toEqual([360, 720, 1080]);
    const highest = await source().make(1, false, 'highest');
    expect(highest.streams.map((s) => s.quality)).toEqual([1080, 720, 360]);
  });

  it('passes `fresh` on and refuses unknown episodes', async () => {
    const { make, asked } = source();
    await make(1, true, 'playback');
    expect(asked).toEqual([{ fresh: true }]);
    await expect(make(2, false, 'playback')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('createDownloadUpstream', () => {
  it('hands the request to the playback upstream with a session that names the extension', async () => {
    let seen: { url: string; extensionId?: string; headers: Record<string, string> } | null = null;
    const upstream = createDownloadUpstream(async (url, init, session) => {
      seen = {
        url,
        headers: init.headers,
        ...(session.extensionId !== undefined && { extensionId: session.extensionId }),
      };
      return new Response('ok');
    });
    await upstream('https://x/a', { method: 'GET', headers: { Referer: 'https://x/' } }, { extensionId: 'example' });
    expect(seen).toEqual({ url: 'https://x/a', headers: { Referer: 'https://x/' }, extensionId: 'example' });
    await upstream('https://x/b', { method: 'GET', headers: {} }, {});
    expect((seen as unknown as { extensionId?: string }).extensionId).toBeUndefined();
  });
});
