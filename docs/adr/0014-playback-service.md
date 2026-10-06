# 14. PlaybackService: ranking, probing and fallback in main

Status: Accepted (2026-10-07)

## Context
The extension returns every stream it can find; the app decides which to play and what to do when it breaks (docs/PRD.md §6.4). The renderer must never see an upstream URL or header ([0008](0008-media-transport.md)).

## Decision
`PlaybackService` (`apps/desktop/src/main/playback/`) owns this. The renderer asks `playback.start({ episodeId })` and gets an `anime://play/<session>/…` URL, the ranked list of servers and the neighbouring episodes.

1. **Streams** come from the extension and are kept in memory for two minutes (STR-6), never in the database.
2. **Ranking** (STR-1), a stable sort on: the user's manual pick for this anime; the quality preference (highest, or nearest at or below a height, then above); the server that last worked for this source; the extension's order. Unknown heights go last.
3. **Probe** (STR-2): a playlist must start with `#EXTM3U`, a file must answer a one-byte range, a URL that says nothing is sniffed. 8 s timeout, through the same upstream the player will use, reading only the first bytes (a server that ignores `Range` must not cost a whole file). A failed probe is silent: the next candidate is tried.
4. **Upstream** for a session goes through the extension's own network session (`session.fetch`, streaming, so a file is never held in memory) after taking a token from its media bucket; the Referer/Origin bridge applies. A session without an extension (the spike) keeps using `net.fetch` on the default session.
5. **Fallback** (STR-3, STR-4): the player reports a fatal error with the HTTP status. A 403 or 410 first asks the extension for **fresh streams once** and replays the same server and quality; otherwise, or if that fails again, the server is marked failed and the next candidate that probes is opened, keeping the position. After **three** failures the player shows the error state with the servers it tried. Calls for one playback are serialized, because a stream can raise several errors at once.
6. **Manual choice** (STR-5): picking a server or quality stores `{ server, quality }` on the anime (`playback_prefs_json`); only manual picks are remembered that way. The server that played a first frame is remembered per source in the settings.

The player also checks that frames were decoded, not only that the clock moved, so audio without a picture (HEVC without a decoder, [0009](0009-codec-support.md)) is reported as a codec error and the next server is tried.

## Deferred
- Ranking by `CODECS` (PLY-12): main cannot ask `MediaSource.isTypeSupported`; it needs a renderer capability probe.
- Offline episodes first (STR-7) and any position, progress or resume (PRG-*): phases 3 and 2.

## Consequences
- The ranking, neighbour and probe logic are pure and unit tested; expiry, refresh, fallback and total failure are covered end to end with fake streams that die after a segment.
