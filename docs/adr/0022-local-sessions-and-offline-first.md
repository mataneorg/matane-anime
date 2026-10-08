# 22. Local sessions: a downloaded episode is played from disk first

Status: Accepted (2026-10-09)

## Context
A downloaded episode must play without the site, without a network and without the extension, also after a restart (docs/PRD.md STR-7, DL-14, US-9), and the renderer must keep one code path ([0008](0008-media-transport.md), §8.3).

## Decision
- **A third session kind, `local`**, next to `hls` and `file` in `SessionStore`, rooted at one download. It has no upstream hosts and no extension. The URLs are the usual ones: `anime://play/<id>/playlist.m3u8` and the relative files next to it for HLS, `anime://play/<id>/media.mp4` for an MP4. The player does not know the difference.
- **`PlaybackService.startInner` looks for a finished download before anything else**: a `done` row with a path whose files exist (`playlist.m3u8`, or the MP4 with `stat`). It does this *before* `assertAvailable` or any network call. If the files are gone, the row becomes `error` with `file_missing` (the path and byte counts stay, so Retry from [0021](0021-download-engine.md) resets it) and playback falls through to streaming, unchanged.
- **One synthetic candidate**, server "Downloaded", with the quality and kind of the download, so `playback.event` and `playback.switchStream` keep working (switching to index 0 returns the same session and saves no preference). A local playback never walks through servers and never refreshes a stream: an error is reported with `tried: ['Downloaded']`, and if the files vanished meanwhile the download is marked `file_missing`. Progress, history and watch sessions work as for streaming ([0015](0015-watch-service.md)).
- **The file handler** (`playback/local.ts`) streams from a file handle, never reading a whole file into memory. It answers `Range` (`a-b`, `a-`, `-n`) with 206 and a correct `Content-Range`, 416 with `bytes */size` when unsatisfiable, whole files with 200 for header values it cannot parse (including several ranges), `HEAD`, and content types for `.m3u8`, `.ts`, `.m4s`, `.mp4` and `.key`.
- **Safety**: each path segment is decoded once and refused if it is `.`, `..`, empty or contains `/`, `\` or NUL; the result is checked with `realpath` against the realpath of the root, so a symlink cannot leave the folder. Either gives 403 `path_not_allowed`; a missing file gives 404 `file_missing`.

## Consequences
- AES-128 downloads play because the key is a local file referenced by a relative URI.
- An episode that is downloaded but whose extension was uninstalled still plays; its source shows as "not installed" for everything else.
