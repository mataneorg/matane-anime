# 38. Ranking streams by CODECS

Status: Accepted (2026-10-10). Covered by unit tests with a fake upstream; not yet seen with real servers or on Windows and macOS.

## Context
A stream whose codecs Chromium cannot decode (HEVC without a decoder is the usual one, [0009](0009-codec-support.md)) plays audio without a picture. The player notices that after frames fail to decode and moves to the next server ([0014](0014-playback-service.md)), but by then the user has already waited and seen a black screen. The PRD asks for such streams to be ranked last (PLY-12). It was deferred because `MediaSource.isTypeSupported` only exists in the renderer, and the ranking runs in main.

## Decision
- **The renderer measures once, at start.** `CODEC_PROBES` in `@matane-anime/shared` is a fixed table of codec families (`h264`, `hevc`, `vp9`, `av1`, `aac`, `opus`, `flac`, `ac3`, `eac3`), each with one representative type string. `main.tsx` asks `MediaSource.isTypeSupported` about each (`measureCodecSupport`) and sends `{ family: boolean }` over one new channel, `playback.reportCodecs`. A family the browser throws for is left out, which means "do not judge it".
- **Main keeps it in memory.** `PlaybackService.setCodecSupport` stores the report; it is not persisted, because it depends on the Chromium build and the machine, and is measured again on every start. Until a report arrives nothing is judged.
- **The probe reads a bit more of an HLS playlist.** A playlist probe used to read 64 bytes. It now reads at most 16 KB, enough for a master playlist, and `parseVariantCodecs` lists the `CODECS` attribute of every `#EXT-X-STREAM-INF` (`SUPPLEMENTAL-CODECS` is not mistaken for it). The result carries `variants`, one list per variant; a variant without `CODECS`, or whose attribute the cap cut off, is an empty list.
- **Matching is conservative.** `codecFamily` maps a codec string to a family (`avc1`/`avc3` → `h264`, `hvc1`/`hev1` → `hevc`, `mp4a.40.*` → `aac`, and so on); anything else (Dolby Vision, `mp4a.69`) has no family. A variant is unsupported only when one of its codecs belongs to a family reported `false`. A stream is unsupported only when it has variants and **all** of them are unsupported. No report, no variants, no `CODECS` or an unmeasured family leave the stream where it was.
- **Demoted, never dropped.** The ranking of STR-1 happens before any probe, when `CODECS` are still unknown, so the demotion happens in `openFirstWorking`. A probe that answers with an unsupported stream does not win: the position goes to `playback.unsupported`, the next candidate is started as after a failure, and the stream is used only if no other candidate answers (the best-ranked of several unsupported ones). It is not marked failed and not blamed. Once known, `demote` (a stable partition in `ranking.ts`) puts those positions last in every later queue of that playback, so a fallback after a playback error tries the others first. A refresh of expired links starts again, since the positions change.
- The server list the player shows keeps the STR-1 order and the status of each stream; only the order in which streams are tried changes.

## Consequences
- A server that serves only HEVC to a machine that cannot play it no longer costs a black screen when another server works; and if it is the only one, it still plays, as before.
- It costs probes: an unsupported stream answers its probe, takes a slot and is then set aside, and when it ranked first the next one starts at once rather than after the 1.5 s head start of [0034](0034-parallel-stream-probe.md).
- Only HLS master playlists carry the information. An MP4 file, a media playlist and a master playlist without `CODECS` keep their rank, and the player's check for decoded frames remains the fallback for them.
- `isTypeSupported` can say yes to what then fails to decode (hardware decoders, DRM), and the table is a representative profile per family, not every profile and level. A false "supported" falls back on the player check; a false "unsupported" costs only an order change.
- The report is one `invoke` at start. If it fails, ranking works as before.
