# 9. Codec and container support

Status: Accepted for Linux (2026-10-06). Windows and macOS columns are filled in from the `Playback spike` workflow.

## Context
Playback uses Chromium's own decoders (HTML5 video, hls.js over MSE). What plays depends on the Chromium build and the OS, so the player needs a measured baseline, not an assumption (PRD R2, PLY-6, PLY-12).

## Decision
Treat a stream as playable only if frames were actually decoded. Do **not** trust `canPlayType`: on Linux it answers `no` for FLAC, which plays. The spike checks `videoWidth` and `getVideoPlaybackQuality().totalVideoFrames` after the clock has moved.

When playback runs but no frame is decoded, the player must say so (PLY-6) instead of showing a black picture with sound. HEVC is the case that matters: the audio plays, the video does not.

## Results
Electron 44.5.1, Chromium 152, 6 s test pattern with a sine tone.

| Fixture | Linux x64 |
|---|---|
| MP4, H.264 + AAC (also HLS TS and fMP4) | plays |
| MKV, H.264 + AAC | plays |
| MKV, H.264 + Opus | plays |
| MP4, H.264 High 10 (10-bit) + AAC | plays |
| WebM, VP9 + Opus | plays |
| WebM, VP8 + Opus | plays |
| MP4, AV1 + AAC | plays |
| FLAC, audio only | plays (`canPlayType` says no) |
| MP4, HEVC + AAC | **audio only**, no video frames |

Windows and macOS: pending. HEVC is the likely difference, since hardware decoding can be available there.

## Consequences
- Extensions rank streams by `CODECS` (PLY-12); HEVC is ranked last and flagged until a platform proves otherwise.
- Hi10P anime releases do play here, but a 6 s clip says nothing about smoothness at 1080p; revisit with real material.
- MKV plays as a plain file, but HLS streams keep fMP4 or TS as the segment container.
