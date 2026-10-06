import { decodeResource } from './m3u8';
import type { ExtensionFetcher } from '../network/extension-fetcher';

/** `anime://cover/<base64url(sourceId)>/<base64url(image url)>` */
export function coverUrl(encodedSourceId: string, encodedImageUrl: string): string {
  return `anime://cover/${encodedSourceId}/${encodedImageUrl}`;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;

interface Cached {
  type: string;
  body: Uint8Array;
}

export interface CoverDeps {
  /** The fetcher of the extension behind a source, or undefined when it is not installed. */
  fetcherFor(sourceId: string): ExtensionFetcher | undefined;
}

/**
 * Serves covers to `<img>` (docs/PRD.md §8.3): the renderer may not fetch from sites, so main does, in the
 * extension's own session and rate limit. A small in-memory LRU keeps scrolling back cheap; permanent covers
 * for library entries come with phase 2 (LIB-7).
 */
export function createCoverHandler(deps: CoverDeps): (request: Request) => Promise<Response> {
  const cache = new Map<string, Cached>();
  let cacheBytes = 0;

  const remember = (key: string, value: Cached): void => {
    cache.set(key, value);
    cacheBytes += value.body.byteLength;
    for (const [oldest, entry] of cache) {
      if (cacheBytes <= MAX_CACHE_BYTES || oldest === key) break;
      cache.delete(oldest);
      cacheBytes -= entry.body.byteLength;
    }
  };
  const fail = (status: number): Response => new Response(null, { status, headers: { 'cache-control': 'no-store' } });
  const ok = ({ type, body }: Cached): Response =>
    new Response(body as BodyInit, {
      status: 200,
      headers: { 'content-type': type, 'cache-control': 'private, max-age=86400' },
    });

  return async (request) => {
    if (request.method !== 'GET') return fail(405);
    const [, encodedSource, encodedUrl] = new URL(request.url).pathname.split('/');
    const sourceId = encodedSource ? decodeResource(encodedSource) : null;
    const imageUrl = encodedUrl ? decodeResource(encodedUrl) : null;
    if (!sourceId || !imageUrl || !/^https?:\/\//i.test(imageUrl)) return fail(400);

    const key = `${sourceId}|${imageUrl}`;
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key); // refresh its place in the LRU order
      cache.set(key, hit);
      return ok(hit);
    }
    const fetcher = deps.fetcherFor(sourceId);
    if (!fetcher) return fail(404);
    try {
      const response = await fetcher.requestBytes({
        url: imageUrl,
        headers: { Referer: `${new URL(imageUrl).origin}/`, Accept: 'image/*' },
      });
      const type = response.headers['content-type'] ?? '';
      if (response.status !== 200) return fail(response.status === 404 ? 404 : 502);
      if (!type.startsWith('image/')) return fail(415);
      if (response.body.byteLength > MAX_IMAGE_BYTES) return fail(413);
      const cached = { type, body: response.body };
      remember(key, cached);
      return ok(cached);
    } catch {
      return fail(502);
    }
  };
}
