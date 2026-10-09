import { readFile } from 'node:fs/promises';
import { decodeResource } from './m3u8';
import type { ImageCache } from '../images/cache';
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
  /** The permanent cover of a library entry, if it was saved (LIB-7). */
  localCover?(animeId: number): { path: string; type: string } | null;
  /** The fetcher of the extension behind a source, or undefined when it is not installed. */
  fetcherFor(sourceId: string): ExtensionFetcher | undefined;
  /** Browse covers kept on disk between runs, behind the in-memory LRU. */
  imageCache?: Pick<ImageCache, 'read' | 'put'>;
}

/** What a fetch ends in: the image, or the status to answer with. */
type Loaded = Cached | { status: number };

/**
 * Serves covers to `<img>` (docs/PRD.md §8.3): the renderer may not fetch from sites, so main does, in the
 * extension's own session and rate limit. Lookup order is a small in-memory LRU, the disk cache (so a restart
 * does not refetch everything), then the site; requests for one image that overlap share a single fetch.
 * Permanent covers of library entries are served from their own file (LIB-7).
 */
export function createCoverHandler(deps: CoverDeps): (request: Request) => Promise<Response> {
  const cache = new Map<string, Cached>();
  let cacheBytes = 0;
  const inflight = new Map<string, Promise<Loaded>>();

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
    const segments = new URL(request.url).pathname.split('/').filter(Boolean);
    if (segments[0] === 'library') {
      const local = deps.localCover?.(Number(segments[1]));
      if (!local) return fail(404);
      try {
        const body = new Uint8Array(await readFile(local.path));
        // The file is replaced when the site changes the image, so the renderer must ask again.
        return new Response(body as BodyInit, {
          status: 200,
          headers: { 'content-type': local.type, 'cache-control': 'no-cache' },
        });
      } catch {
        return fail(404);
      }
    }
    const [encodedSource, encodedUrl] = segments;
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
    let pending = inflight.get(key);
    if (!pending) {
      pending = load(key, sourceId, imageUrl).finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }
    const loaded = await pending;
    return 'status' in loaded ? fail(loaded.status) : ok(loaded);
  };

  async function load(key: string, sourceId: string, imageUrl: string): Promise<Loaded> {
    const onDisk = await deps.imageCache?.read(key).catch(() => undefined);
    if (onDisk) {
      remember(key, onDisk);
      return onDisk;
    }
    const fetcher = deps.fetcherFor(sourceId);
    if (!fetcher) return { status: 404 };
    try {
      const response = await fetcher.requestBytes(
        {
          url: imageUrl,
          headers: { Referer: `${new URL(imageUrl).origin}/`, Accept: 'image/*' },
        },
        { lane: 'image' },
      );
      const type = response.headers['content-type'] ?? '';
      if (response.status !== 200) return { status: response.status === 404 ? 404 : 502 };
      if (!type.startsWith('image/')) return { status: 415 };
      if (response.body.byteLength > MAX_IMAGE_BYTES) return { status: 413 };
      const cached = { type, body: response.body };
      remember(key, cached);
      // A failed write only costs a refetch next time.
      await deps.imageCache?.put(key, 'browse_cover', cached.body, type).catch(() => undefined);
      return cached;
    } catch {
      return { status: 502 };
    }
  }
}
