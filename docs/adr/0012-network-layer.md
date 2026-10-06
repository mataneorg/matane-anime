# 12. The network layer: one session, one rate limit and one fetcher per extension

Status: Accepted (2026-10-07)

## Context
Every request an extension makes goes through main (docs/PRD.md NET-1…5). Chromium also refuses to let main set `Referer` and `Origin` ([0008](0008-media-transport.md)), and sites in front of Cloudflare answer a challenge instead of a page.

## Decision
`ExtensionFetcher` (`apps/desktop/src/main/network/`), on `net.request`:
- Its own session, `persist:ext-<id>`: cookies (including a passed challenge), cache and storage are per extension and survive restarts. `useSessionCookies` is on.
- **http(s) only on every hop**: redirects are followed by hand (`redirect: 'manual'`, then `followRedirect()`), so a `Location: file:///…` is refused and the call fails with `NetworkError`. `net.fetch` cannot do this (it rejects `manual`).
- **Token buckets** per extension: pages 10/s (the manifest's `rateLimit` overrides it) and a separate, looser **media bucket** (30/s) for segments, so HLS never waits behind page requests.
- 20 s timeout (a call may ask for less, never more than 60 s), at most 20 MB read into memory, up to two retries for network errors, 5xx and 429 with exponential backoff, honoring `Retry-After` up to 30 s, and only for idempotent requests.
- User-Agent: the extension's, else the user's global one (`network.userAgent`, no UI yet), else Chrome's own **without the Electron and app tokens**. Chromium writes the app token without spaces (`MataneAnime/0.0.0`), which the first version of the sanitizer missed; an end-to-end test now checks the header the site receives.
- `Referer` and `Origin` travel under marker headers and are restored in `webRequest.onBeforeSendHeaders`. The hook is **per session** (it was global in the spike), installed when a fetcher is created.
- **Cloudflare**: a response with `cf-mitigated: challenge`, or Cloudflare's interstitial on a 403/503, opens a hidden `BrowserWindow` in the extension's session with the same User-Agent. When `cf_clearance` appears the request is repeated; after 10 s the window is shown, after 2 minutes it gives up. Requests that hit the challenge together share one attempt.
- Online status is polled (`net.online` has no event in main) and pushed to the UI; offline failures are reported as such, not as a broken site.

The pure decisions (retry delays, challenge detection, charset decoding, User-Agent cleaning, token bucket) are plain functions with unit tests; the rest is covered end to end against the fake site, including a simulated challenge.

## Consequences
- DoH, proxy and a custom User-Agent (NET-6) come in phase 5 and plug in here.
- Playback does not use `ExtensionFetcher.request` (it buffers); it streams through the same session ([0014](0014-playback-service.md)).
