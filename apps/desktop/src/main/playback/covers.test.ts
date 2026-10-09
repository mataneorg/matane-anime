import { describe, expect, it, vi } from 'vitest';
import type { ImageCache } from '../images/cache';
import type { ExtensionFetcher } from '../network/extension-fetcher';
import { createCoverHandler } from './covers';
import { encodeResource } from './m3u8';

const IMAGE = 'https://img.example/cover.jpg';
const request = (url = IMAGE, source = 'ext/en'): Request =>
  new Request(`anime://cover/${encodeResource(source)}/${encodeResource(url)}`);

function fetcher(overrides: { status?: number; type?: string; size?: number } = {}) {
  const requestBytes = vi.fn(async () => ({
    status: overrides.status ?? 200,
    headers: { 'content-type': overrides.type ?? 'image/jpeg' },
    body: new Uint8Array(overrides.size ?? 4).fill(1),
  }));
  return { requestBytes, instance: { requestBytes } as unknown as ExtensionFetcher };
}

function diskCache() {
  const store = new Map<string, { type: string; body: Uint8Array }>();
  const cache = {
    read: vi.fn(async (key: string) => store.get(key)),
    put: vi.fn(async (key: string, _kind: string, body: Uint8Array, type: string | null) => {
      store.set(key, { type: type ?? '', body });
      return { key, path: '', contentType: type, sizeBytes: body.byteLength };
    }),
  };
  return { store, cache: cache as unknown as Pick<ImageCache, 'read' | 'put'> };
}

describe('cover handler', () => {
  it('fetches once and then serves from memory', async () => {
    const { requestBytes, instance } = fetcher();
    const handle = createCoverHandler({ fetcherFor: () => instance });
    expect((await handle(request())).status).toBe(200);
    expect((await handle(request())).status).toBe(200);
    expect(requestBytes).toHaveBeenCalledTimes(1);
  });

  it('shares one fetch between overlapping requests', async () => {
    const { requestBytes, instance } = fetcher();
    const handle = createCoverHandler({ fetcherFor: () => instance });
    const responses = await Promise.all([handle(request()), handle(request()), handle(request())]);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(requestBytes).toHaveBeenCalledTimes(1);
  });

  it('writes a fetched cover to the disk cache', async () => {
    const { instance } = fetcher();
    const disk = diskCache();
    await createCoverHandler({ fetcherFor: () => instance, imageCache: disk.cache })(request());
    expect(disk.cache.put).toHaveBeenCalledOnce();
    expect(disk.store.size).toBe(1);
  });

  it('serves from disk after a restart without fetching', async () => {
    const { instance } = fetcher();
    const disk = diskCache();
    await createCoverHandler({ fetcherFor: () => instance, imageCache: disk.cache })(request());
    const second = fetcher();
    // A new handler has an empty memory cache, like a fresh start.
    const response = await createCoverHandler({ fetcherFor: () => second.instance, imageCache: disk.cache })(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(second.requestBytes).not.toHaveBeenCalled();
  });

  it('still answers when the disk cache fails', async () => {
    const { instance } = fetcher();
    const broken = {
      read: vi.fn(async () => Promise.reject(new Error('disk'))),
      put: vi.fn(async () => Promise.reject(new Error('disk'))),
    } as unknown as Pick<ImageCache, 'read' | 'put'>;
    const response = await createCoverHandler({ fetcherFor: () => instance, imageCache: broken })(request());
    expect(response.status).toBe(200);
  });

  it('does not cache failures', async () => {
    const bad = fetcher({ status: 500 });
    const disk = diskCache();
    const handle = createCoverHandler({ fetcherFor: () => bad.instance, imageCache: disk.cache });
    expect((await handle(request())).status).toBe(502);
    expect((await handle(request())).status).toBe(502);
    expect(bad.requestBytes).toHaveBeenCalledTimes(2);
    expect(disk.cache.put).not.toHaveBeenCalled();
  });

  it('rejects what is not an image, a bad url, or an unknown source', async () => {
    const html = fetcher({ type: 'text/html' });
    expect((await createCoverHandler({ fetcherFor: () => html.instance })(request())).status).toBe(415);
    expect((await createCoverHandler({ fetcherFor: () => html.instance })(request('file:///etc/passwd'))).status).toBe(
      400,
    );
    expect((await createCoverHandler({ fetcherFor: () => undefined })(request())).status).toBe(404);
  });
});
