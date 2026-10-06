import type { Session } from 'electron';
import { isBridgedHeader } from './policy';

// Spike finding (docs/adr/0008-media-transport.md): Chromium's network stack refuses `Referer` (both
// `net.fetch` and `net.request`: ERR_BLOCKED_BY_CLIENT) and `Origin` (`net.fetch`: ERR_FAILED) when main sets
// them as request headers. What works is to carry them under marker names and let `webRequest` put the real
// headers on the wire just before sending. The hook is per session: each extension has its own.
const MARKERS: Record<string, string> = { referer: 'x-matane-referer', origin: 'x-matane-origin' };
const UNMARKED: Record<string, string> = Object.fromEntries(
  Object.entries(MARKERS).map(([real, marker]) => [marker, real]),
);
const CANONICAL: Record<string, string> = { referer: 'Referer', origin: 'Origin' };

/** Renames the headers Chromium would refuse to their marker names. */
export function withMarkers(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[isBridgedHeader(name) ? (MARKERS[name.toLowerCase()] as string) : name] = value;
  }
  return out;
}

const installed = new WeakSet<Session>();

/** Turns the marker headers back into `Referer` and `Origin`. Requests without markers pass untouched. */
export function installHeaderBridge(target: Session): void {
  if (installed.has(target)) return;
  installed.add(target);
  target.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    const requestHeaders: Record<string, string> = {};
    for (const [name, value] of Object.entries(details.requestHeaders)) {
      const real = UNMARKED[name.toLowerCase()];
      requestHeaders[real ? (CANONICAL[real] as string) : name] = value;
    }
    callback({ requestHeaders });
  });
}
