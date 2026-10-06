# 8. Media transport: a privileged `anime://` proxy served by main

Status: Accepted on Linux (2026-10-06). Windows and macOS are verified by the `Playback spike` workflow; this ADR is final once it is green on both.

## Context
Sites that host video check `Referer` and `Origin`, send no CORS headers, and sometimes redirect to other hosts. The renderer can therefore not fetch them directly, and it must not be allowed to (CSP `connect-src` lists only `'self'` and `anime:`). Risk R1 in the PRD: hls.js and `<video>` might not work over a custom protocol on some OS. The phase 0 spike plays 14 fixtures through the real app (real preload, real CSP) against three fake sites on loopback that answer 403 without the right `Referer`.

## Decision
Main serves `anime://play/<session>/…` with `protocol.handle`. The scheme is registered as `standard, secure, stream, supportFetchAPI, corsEnabled`.

- **Sessions** are created only by main and hold the entry URL, the headers to send (`Referer`, `Origin`, `User-Agent`, …) and `hostsSeen`.
- **Playlists** are rewritten so every URI (variant, segment, `EXT-X-KEY`, `EXT-X-MAP`, `EXT-X-MEDIA`; relative or absolute, any host) becomes `anime://play/<session>/r/<base64url(absolute URL)>`. Hosts met in a playlist go into `hostsSeen`; any other host is refused with 403 `host_not_allowed` and is never contacted.
- **Other resources** are streamed through. `Range` is passed on and 206 comes back untouched, which is what makes MP4 seeking work.
- **Failures** keep their status and add an `x-error-code` header (`http_403`, `network`, `host_not_allowed`, …), exposed through CORS so the player can show a real message.
- **CSP** needs `media-src anime: blob:` and `worker-src blob:` (hls.js uses MSE and a worker), plus `connect-src 'self' anime:`.

### Setting `Referer` and `Origin` from main
Measured on Electron 44.5.1 / Chromium 152:

| Header set in main | `net.fetch` | `net.request` |
|---|---|---|
| `Referer` | ERR_BLOCKED_BY_CLIENT | ERR_BLOCKED_BY_CLIENT |
| `Origin` | ERR_FAILED | works |
| `Range`, `User-Agent` | works | works |

Both refuse `Referer`. What works is to send the headers under marker names (`x-matane-referer`, `x-matane-origin`) and rename them in `session.webRequest.onBeforeSendHeaders`, just before they go on the wire (`playback/upstream.ts`). The hook touches only requests that carry a marker. Upstream uses `net.fetch`; `net.request` (`MATANE_SPIKE_FETCH=request`) behaves the same with the bridge.

## Results (Linux)
All transport fixtures play with decoded video and resume after a seek: HLS with TS segments, absolute URIs on another host, AES-128, fragmented MP4 (`EXT-X-MAP`), and MP4 over `Range`. First frame took 30 to 290 ms and a seek about 380 ms, against targets of 3 s and 1.5 s (PRD §10.1); the fixtures are local and tiny, so this shows the proxy adds no meaningful delay, not what real sites will do. A stream that starts returning 403 fails with `http_403`. The renderer cannot reach the fake sites directly or any other host.

Per-OS tables: `pnpm --filter @matane-anime/desktop spike:report <spike-results.json>...`.

## Update (phase 1)
- The Referer/Origin bridge moved to `network/header-bridge.ts` and is installed **per session**, because each extension has its own ([0012](0012-network-layer.md)).
- Playback sessions carry the id of their extension. Upstream requests for them go through that extension's session with `session.fetch` (streaming, cookies included) and its media rate limit; only sessions without an extension, such as the spike's, use `net.fetch` on the default session ([0014](0014-playback-service.md)).
- `anime://cover/<source>/<image>` is a second handler on the same scheme: main fetches covers through the extension's session and keeps them in a small in-memory cache. The permanent covers of library entries (LIB-7) come with phase 2.

## Alternative kept in reserve
A custom hls.js loader that asks main over IPC and receives an `ArrayBuffer`. Not built: the proxy passed. It would still be needed for MP4 progressive playback, which has no loader hook, so it is a fallback only for HLS.

## Consequences
- The player only ever sees `anime://` URLs; no upstream URL or header reaches the renderer.
- Extension-supplied headers go through the same bridge, so they must be limited to what the session needs.
- Phase 1 grows `playback/` into the `PlaybackService`; the spike code under `playback/spike/` stays dev-only.
