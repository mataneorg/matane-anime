import { describe, expect, it, vi } from 'vitest';
import type { ExtensionFetcher } from '../network/extension-fetcher';
import type { PlaybackSession } from './sessions';
import { createSessionUpstream, withUserAgent } from './upstream';

vi.mock('electron', () => ({ net: { fetch: vi.fn() }, session: { defaultSession: {} } }));
vi.mock('../network/header-bridge', () => ({ installHeaderBridge: vi.fn(), withMarkers: (h: unknown) => h }));

describe('withUserAgent', () => {
  it('adds the User-Agent', () => {
    expect(withUserAgent({ Referer: 'https://a.test/' }, 'UA/1')).toEqual({
      Referer: 'https://a.test/',
      'user-agent': 'UA/1',
    });
  });

  it('keeps one the stream names, whatever its case', () => {
    expect(withUserAgent({ 'User-Agent': 'Own/2' }, 'UA/1')).toEqual({ 'User-Agent': 'Own/2' });
  });
});

describe('createSessionUpstream', () => {
  it("fetches with the extension's User-Agent, the one its stream links were issued to", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 206 }));
    const fetcher = {
      userAgent: 'Plain-Chrome/1',
      media: { take: vi.fn(async () => undefined) },
      session: { fetch },
    } as unknown as ExtensionFetcher;
    const upstream = createSessionUpstream(() => fetcher);

    await upstream('https://rr1.googlevideo.com/videoplayback?x=1', { method: 'GET', headers: { Range: 'bytes=0-' } }, {
      extensionId: 'samehadaku',
    } as PlaybackSession);

    const [, init] = fetch.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(init.headers).toEqual({ Range: 'bytes=0-', 'user-agent': 'Plain-Chrome/1' });
  });
});
