import { net, session } from 'electron';
import { installHeaderBridge, withMarkers } from '../network/header-bridge';
import type { UpstreamFetch } from './proxy';

/** Upstream through `net.fetch`. */
export const fetchWithNetFetch: UpstreamFetch = (url, init) =>
  net.fetch(url, {
    method: init.method,
    headers: withMarkers(init.headers),
    redirect: 'follow',
    bypassCustomProtocolHandlers: true,
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

/** Installs the header bridge and picks the upstream; `MATANE_SPIKE_FETCH=request` switches to `net.request`. */
export function selectUpstream(): UpstreamFetch {
  installHeaderBridge(session.defaultSession);
  return process.env['MATANE_SPIKE_FETCH'] === 'request' ? fetchWithNetRequest : fetchWithNetFetch;
}
