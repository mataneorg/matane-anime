import { net, session } from 'electron';
import { installHeaderBridge, withMarkers } from '../network/header-bridge';
import type { ExtensionFetcher } from '../network/extension-fetcher';
import type { UpstreamFetch } from './proxy';

/** Upstream through `net.fetch` on the default session: what the spike used, and what a session without an extension gets. */
export const fetchWithNetFetch: UpstreamFetch = (url, init) =>
  net.fetch(url, {
    method: init.method,
    headers: withMarkers(init.headers),
    redirect: 'follow',
    bypassCustomProtocolHandlers: true,
    ...(init.signal && { signal: init.signal }),
  });

/** Upstream through `net.request`. Kept to compare with `net.fetch`; it needs the same header bridge. */
export const fetchWithNetRequest: UpstreamFetch = (url, init) =>
  new Promise<Response>((resolve, reject) => {
    const request = net.request({ url, method: init.method, redirect: 'follow' });
    for (const [name, value] of Object.entries(withMarkers(init.headers))) request.setHeader(name, value);
    request.on('response', (response) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
      }
      const status = response.statusCode;
      const bodyless = init.method === 'HEAD' || status === 204 || status === 205 || status === 304;
      const body = bodyless
        ? null
        : new ReadableStream<Uint8Array>({
            start(controller) {
              response.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
              response.on('end', () => controller.close());
              response.on('error', (error: Error) => controller.error(error));
            },
            cancel() {
              request.abort();
            },
          });
      const out = new Response(body, { status, statusText: response.statusMessage, headers });
      // `Response.url` is read-only; the final URL of a followed redirect is what hls.js resolves against.
      Object.defineProperty(out, 'url', { value: url });
      resolve(out);
    });
    request.on('error', reject);
    request.end();
  });

/**
 * Upstream for playback sessions: through the extension's own network session (its cookies, so a passed
 * Cloudflare challenge still counts), its media rate limit, and `net.fetch`'s streaming body, so a
 * multi-hundred-megabyte file is never held in memory. Sessions without an extension use the default.
 */
export function createSessionUpstream(
  fetcherFor: (extensionId: string) => ExtensionFetcher | undefined,
): UpstreamFetch {
  return async (url, init, playbackSession) => {
    const fetcher = playbackSession.extensionId ? fetcherFor(playbackSession.extensionId) : undefined;
    if (!fetcher) return selectUpstream()(url, init, playbackSession);
    await fetcher.media.take();
    installHeaderBridge(fetcher.session);
    return fetcher.session.fetch(url, {
      method: init.method,
      headers: withMarkers(init.headers),
      redirect: 'follow',
      credentials: 'include',
      bypassCustomProtocolHandlers: true,
      ...(init.signal && { signal: init.signal }),
    });
  };
}

/** Installs the header bridge and picks the upstream; `MATANE_SPIKE_FETCH=request` switches to `net.request`. */
export function selectUpstream(): UpstreamFetch {
  installHeaderBridge(session.defaultSession);
  return process.env['MATANE_SPIKE_FETCH'] === 'request' ? fetchWithNetRequest : fetchWithNetFetch;
}
