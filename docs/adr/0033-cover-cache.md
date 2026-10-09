# 33. Disk cache for browse covers

Status: Accepted (2026-10-09). Not yet seen running in the app; the order of lookups and the separate queue are covered by unit tests only.

## Context
Browse and search covers lived only in a 64 MB in-memory cache in the `anime://cover` handler ([0008](0008-media-transport.md)), so every launch fetched them again through the extension's network layer. They also waited in the same rate-limit queue as page requests ([0012](0012-network-layer.md)), so a grid of covers delayed the listing, search and detail requests the user was waiting for. The `image_cache` table (docs/PRD.md §9) existed since phase 1 but nothing used it. The design follows the image cache of the reference project (`mataneorg/matane`, `apps/desktop/src/main/images`).

## Decision
- **`ImageCache`** (`main/images/cache.ts`) keeps covers in `userData/cache/images`, one file per key (named by the SHA-1 of the key), indexed by `image_cache`. A write goes to a temporary file and is renamed, so a crash never leaves a truncated image behind a valid row. `get` marks an entry as used and drops a row whose file is gone. Eviction is least-recently-used, one pass at a time, started after every write, at startup and when the limit changes. Only `browse_cover` exists as a kind; video is never cached (docs/PRD.md §8.3).
- **Lookup order** in the handler: memory (64 MB LRU) → disk → site. A hit on disk is put in memory. Failures (any non-200, not an image, over 10 MB) are never cached, and a disk error never fails a request: it only costs a fetch.
- **One fetch per image.** Overlapping requests for the same `sourceId|url` share a single in-flight promise, so a card shown twice, or a fast scroll back, does not fetch twice.
- **Key** is `sourceId|imageUrl`, so a new image URL from the site is a new entry and a changed cover is never served stale. Old entries leave by LRU.
- **Setting** `imageCacheSizeMb` (default 1024, 100 to 51 200). Settings → Data and storage shows the size used, a limit (256 MB to 5 GB, plus any stored value outside that list) and Clear cache. IPC: `storage.cacheSize`, `storage.clearCache`. Lowering the limit evicts at once.
- **Permanent covers are unchanged** ([0017](0017-permanent-covers.md)): `userData/covers`, not in `image_cache`, never evicted or cleared here.
- **Separate rate-limit lane.** `ExtensionFetcher` has an `images` bucket at the manifest rate, next to `pages` and `media`. `requestBytes(request, { lane: 'image' })` uses it, for browse covers and for the permanent copy of a library cover. It is not the `media` bucket: that one carries HLS segments, and covers would compete with a playing video. The rate is not raised, so a site is not hit harder than before; covers only stop queuing behind other requests.
- **Backup** already drops `image_cache` ([0030](0030-backup-restore.md)); the files in `cache/images` are not part of a backup either.

## Consequences
- After the first visit a listing shows its covers without touching the site, also after a restart or while the site is slow.
- The memory cache stays in front of the disk, so scrolling back is still free. Clear cache empties the disk only; covers already in memory stay until the app closes.
- Cached covers have no age limit, only the size limit. A cover that the site replaces under the same URL stays old until it is evicted or cleared.
- The cache is not shared with the library: removing an anime from the library does not touch it.
