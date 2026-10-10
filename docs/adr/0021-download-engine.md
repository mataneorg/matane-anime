# 21. Download engine: plan, transfer, atomic folders, a persistent queue

Status: Accepted (2026-10-09)

## Context
Downloads must survive a closed app, a dropped network, an expiring stream URL and a full disk, and an episode that is on disk must play without the site (docs/PRD.md DL-1…DL-10, R3, R4, R5). HLS is the hard case: variants, separate audio renditions, AES-128 with rotating keys, fMP4 init segments, byte ranges, relative and absolute URIs.

## Decision
**One pipeline, all of it injected** (upstream fetch, `streamsFor`, clock, free space, online status, the "extensions are loaded" promise), so the queue and the file logic run in plain vitest with a real database and real files; Electron appears only in the wiring in `main/index.ts`.

1. **Plan** (`downloads/hls.ts`, pure): parse the master and media playlists, choose the variant, choose the audio, estimate the size (`BANDWIDTH` × duration), and refuse what cannot be downloaded with a typed error: a **live** playlist (no `EXT-X-ENDLIST`), `SAMPLE-AES` or any method but `AES-128`, a non-identity `KEYFORMAT`. The variant follows the player's `qualityRank` (`downloadQuality` `playback` means "what the player would pick", otherwise the nearest height).
2. **Audio rendition** (the open question of §15.2): the `DEFAULT=YES` rendition of the chosen variant's `AUDIO` group, else the first one; checked with the `hls-audio` fixture (only the Japanese track is requested).
3. **Transfer** (`transfer.ts`, `fetch.ts`): a worker pool (six segments per episode) where every file goes through `.part` and a rename into `<episode>.tmp/`, the playlists are written last, and the folder is renamed to its final name only when everything is there. MP4 is `<file>.part` with `Range` resume, then a rename. Nothing is buffered whole: the body streams to disk.
4. **Network**: the shape of the playback upstream (the extension's session, the media bucket, the header bridge), with what playback lacks: an idle-based timeout, three retries with backoff (500, 1000, 2000 ms; `Retry-After` honoured up to 30 s) for network errors, timeouts, 5xx, 408/425/429 and truncated bodies only, a scheme check on the final URL, and **one** stream refresh on 403/410 per download (R5); a second 403 is the error `expired`.
5. **Local copy**: names are relative and by position (`seg_00000.ts`, `key_N.key`, `init_N.mp4`, `audio/…`), so they survive a refreshed URL; `EXT-X-KEY` keeps its IV and AES segments stay encrypted on disk; each byte range becomes its own file (no `EXT-X-BYTERANGE`); a separate audio track gives a local master `playlist.m3u8` with `video.m3u8` and `audio/index.m3u8`. Layout `<folder>/<Source (LANG)>/<Anime>/<Episode>/` (HLS) or `…/<Episode>.mp4`, sanitised for Windows reserved names, trailing dots and spaces, a byte-length cap and NFC; collisions get " (2)". **The path is stored in `downloads.path` and never recomputed.**
6. **Resume truth comes from the disk**: each run re-adds the counters from the files that exist; a marker file in `.tmp` records the plan, and a leftover `.tmp` of another quality or encode is wiped.
7. **Queue**: persistent in the `downloads` table; one episode with six segments by default (settings); it waits while offline and goes back to `queued` when the network drops; `downloading` becomes `queued` at start; `shutdown()` is synchronous because the database is closed in the same `quit` handler. Progress is sent about four times a second per download with a five second moving average for speed and ETA, and saved about once a second without events.
8. **Limits**: free space through `fs.statfs` (the estimate must fit; with no estimate at least 2 GiB must be free); the size limit (DL-10) is checked against `committedBytes()` (what is saved plus the estimates of what is queued); `auto` and `ahead` never pass it, a manual download only with `force` or a Retry. Checks run at enqueue for up to three episodes (immediate refusals) and again at start.
9. **Housekeeping**: `purgeBrowseRows` keeps anime that have a download ([0016](0016-library-queries.md)); removing an anime from the library keeps its downloaded files; a source migration ([0019](0019-source-migration.md)) leaves the downloads on the old anime row.
10. **Moving the folder** renames each finished download to the same relative path under the new root (copy and remove across drives) and rewrites every path in one transaction; any failure rolls the moved folders back.

## Benchmark and the defaults (docs/PRD.md §15.2)
`e2e/download-bench.spec.ts` downloads three episodes of the 24-segment fixture (72 segments) from the fake site, which is HTTP/1.1 and throttles **per connection** (a latency delay plus a byte rate; there is no shared-bandwidth cap, so MB/s describe the model, not a real link). Means of two runs, after a warm-up download.

| Parallel segments (150 ms + 512 KB/s per connection) | Time (s) | Segments/s |
| --- | --- | --- |
| 1 | 14.70 | 4.9 |
| 2 | 7.45 | 9.7 |
| 4 | 3.81 | 18.9 |
| 6 | 2.57 | 28.0 |
| 8 | 2.53 | 28.5 |
| 12 | 2.52 | 28.6 |

- **Six segments stay the default.** The gain is proportional up to six and then flat. The plateau is the same with the media bucket at 30, 60 and 1000 per second, so the bucket is not the cause; the likely one is Chromium's limit of six connections per host on HTTP/1.1 (inferred from the flat rows, the connection count was not measured). A site on HTTP/2 or with several CDN hosts might gain from more; the setting still allows 1 to 16.
- **One episode at a time stays the default.** More episodes only compensate for low segment counts (two segments: 7.4 s, 5.0 s, 2.8 s for one, two and three episodes); with six segments it is 2.55, 2.54 and 2.52 s.
- **The media bucket stays at 30 per second.** It binds only above 30 segments per second: with 10 ms latency and no byte limit, 75 requests take 1.6 s at 30 per second and 0.37 s at 60. On a real link that needs roughly 360 Mbps (1.5 MB segments, under 200 ms each, six connections). It is also the politeness limit toward sites (NET-2). The extension's own rate limit applies to its page requests; segments, keys and playlists each take one media token (`playback/upstream.ts`, checked in the code, not measured). The bench asserts fewer than 120 segments per second, so changing the default fails it and forces this table to be re-read.
- **Memory does not scale with the file.** Main-process RSS (sampled every 50 ms at 32 MB/s; the sum over all processes is within 1 to 3 MB of it): a 24 MB MP4 grows 22 MB, a 192 MB MP4 54 to 56 MB, three 36 MB HLS episodes 24 MB with six segments and 38 MB with sixteen. An eight times larger file gives about 2.5 times the growth, which is chunks the garbage collector has not freed yet: the body is written chunk by chunk, never held whole (§10.1).

## Not done
- A confirmed manual download that has not started loses its confirmation after a restart (it errors with `size_limit` until Retry).
- The Windows total path length (260) is not checked, only each component.
- Only `fetch`-based stand-ins are used by the engine's unit tests; the real `net.fetch` session path is covered by the e2e.

## Consequences
- Error codes in `downloads.error` are a contract with the UI (`live`, `no_stream`, `no_extension`, `unsupported_encryption`, `size_limit`, `disk_space`, `write_failed`, `disk_full`, `expired`, `network`, `unreachable`, `http_<status>`, `redirect`, `file_missing`).
- Offline playback only has to serve files ([0022](0022-local-sessions-and-offline-first.md)).

## Amendment (2026-10-10)
- Changing the download folder with "move" rewrites each row's path right after its files moved, not all at the end, so a crash leaves every row pointing at a place that exists. A copy across drives that fails removes what it wrote.
- **Limits while transferring** (the size estimate and the free space were only checked once, from what the server said): a download stops with `too_large`, and its files are removed, once it has written more than three times its estimate or 256 MiB over it (at most 64 GiB; without an estimate, what the size limit leaves). A segment stops at 1 GiB, a ranged piece at its announced length. A media playlist with more than 30,000 segments is refused as `invalid_playlist`. Free space is not polled: a full drive already ends the download as `disk_full` and removes the file in flight.
