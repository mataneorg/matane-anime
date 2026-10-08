# 17. Permanent covers for the library

Status: Accepted (2026-10-08)

## Context
Browse covers are fetched from the site every time and may be cached for a while. A library entry must keep its cover when the site is down, the extension is removed, or the image moves (docs/PRD.md LIB-7).

## Decision
- Adding an anime to the library downloads its cover **once** into `userData/covers/<animeId>.<ext>` through the extension's own network layer (rate limit, headers, Cloudflare handling apply). Only `image/*` answers with status 200 and at most 10 MB are kept. The path is stored in `anime.cover_path`. Removing the anime from the library deletes the file, unless it still has a history entry.
- The renderer asks `anime://cover/library/<animeId>`; the handler serves the local file when there is one and falls back to the remote route. The response is `cache-control: no-cache`, so a replaced cover shows up at once while still revalidating cheaply.
- When a refresh finds a different `thumbnail_url` for a library entry, the cover is downloaded again (`onRefreshed`). A failed download is logged and leaves the old file; a missing cover is never an error.
- Migrating to another source ([0019](0019-source-migration.md)) downloads the cover of the new entry and removes the old one's file.

## Consequences
- The library works offline and survives an extension being removed.
- Covers are not measured here; with the 10 MB cap per file the worst case is bounded by the size of the library. There is no cleanup beyond removal.
