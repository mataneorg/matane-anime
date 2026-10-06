import { net, session } from 'electron';
import type { UpstreamFetch } from './proxy';

// Spike finding (docs/adr/0008-media-transport.md): Chromium's network stack refuses `Referer` (both
// `net.fetch` and `net.request`: ERR_BLOCKED_BY_CLIENT) and `Origin` (`net.fetch`: ERR_FAILED) when main sets
// them as request headers. What works is to carry them under marker names and let `webRequest` put the real
// headers on the wire just before sending.
const MARKERS: Record<string, string> = { referer: 'x-matane-referer', origin: 'x-matane-origin' };
const UNMARKED: Record<string, string> = Object.fromEntries(
  Object.entries(MARKERS).map(([real, marker]) => [marker, real]),
);

/** Renames the headers Chromium would refuse to their marker names. */
function withMarkers(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) out[MARKERS[name.toLowerCase()] ?? name] = value;
  return out;
}

let bridgeInstalled = false;

/** Turns the marker headers back into `Referer` and `Origin`. Requests without markers pass untouched. */
export function installHeaderBridge(): void {
  if (bridgeInstalled) return;
  bridgeInstalled = true;
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      const requestHeaders: Record<string, string> = {};
      for (const [name, value] of Object.entries(details.requestHeaders)) {
        const real = UNMARKED[name.toLowerCase()];
        if (real) requestHeaders[real === 'referer' ? 'Referer' : 'Origin'] = value;
        else requestHeaders[name] = value;
      }
      callback({ requestHeaders });
    },
  );
}

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
  installHeaderBridge();
  return process.env['MATANE_SPIKE_FETCH'] === 'request' ? fetchWithNetRequest : fetchWithNetFetch;
}
