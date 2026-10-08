#!/usr/bin/env bash
# Generates the small test media used by the playback spike (docs/adr/0008-media-transport.md).
# Run once with `pnpm fixtures` (needs ffmpeg and openssl) and commit the result: CI never needs ffmpeg.
# Every file is a 6 second 640x360 test pattern with a sine tone, kept tiny on purpose (except long.mp4).
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=e2e/fixtures/media
rm -rf "$OUT"
mkdir -p "$OUT"/{mp4,codec,hls-ts/v360,hls-ts/v240,hls-aes,hls-fmp4,hls-abs}

FF=(ffmpeg -hide_banner -loglevel error -y)
VIDEO=(-f lavfi -i "testsrc2=size=640x360:rate=24:duration=6")
AUDIO=(-f lavfi -i "sine=frequency=440:duration=6")
H264=(-c:v libx264 -preset veryfast -profile:v main -pix_fmt yuv420p -b:v 250k -maxrate 300k -bufsize 600k -g 48 -keyint_min 48 -sc_threshold 0)
AAC=(-c:a aac -b:a 48k)
SEGMENTED=(-f hls -hls_time 2 -hls_playlist_type vod)

echo "== progressive file for Range requests"
"${FF[@]}" "${VIDEO[@]}" "${AUDIO[@]}" "${H264[@]}" "${AAC[@]}" -movflags +faststart "$OUT/mp4/h264-aac.mp4"

echo "== a longer file (40 s, 320x180) for resume tests: positions past ten seconds need a video that long"
"${FF[@]}" -f lavfi -i "testsrc2=size=320x180:rate=12:duration=40" -f lavfi -i "sine=frequency=330:duration=40" \
  "${H264[@]}" -b:v 60k -maxrate 80k -bufsize 160k "${AAC[@]}" -movflags +faststart "$OUT/mp4/long.mp4"

echo "== HLS, MPEG-TS, master playlist with two variants"
"${FF[@]}" "${VIDEO[@]}" "${AUDIO[@]}" -map 0:v -map 1:a "${H264[@]}" "${AAC[@]}" \
  "${SEGMENTED[@]}" -hls_segment_filename "$OUT/hls-ts/v360/seg_%03d.ts" "$OUT/hls-ts/v360/index.m3u8"
"${FF[@]}" "${VIDEO[@]}" "${AUDIO[@]}" -map 0:v -map 1:a -vf scale=426:240 "${H264[@]}" -b:v 120k -maxrate 150k "${AAC[@]}" \
  "${SEGMENTED[@]}" -hls_segment_filename "$OUT/hls-ts/v240/seg_%03d.ts" "$OUT/hls-ts/v240/index.m3u8"
cat > "$OUT/hls-ts/master.m3u8" <<'EOF'
#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=320000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"
v360/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=170000,RESOLUTION=426x240,CODECS="avc1.4d4015,mp4a.40.2"
v240/index.m3u8
EOF

echo "== HLS with absolute segment URIs on another host (placeholder replaced by the fake site)"
sed 's#^seg_#__SITE_B__/hls-ts/v360/seg_#' "$OUT/hls-ts/v360/index.m3u8" > "$OUT/hls-abs/index.m3u8"

echo "== HLS with AES-128"
openssl rand 16 > "$OUT/hls-aes/enc.key"
KEYINFO="$(mktemp)"
printf 'enc.key\n%s\n%s\n' "$OUT/hls-aes/enc.key" "$(openssl rand -hex 16)" > "$KEYINFO"
"${FF[@]}" "${VIDEO[@]}" "${AUDIO[@]}" -map 0:v -map 1:a "${H264[@]}" "${AAC[@]}" \
  "${SEGMENTED[@]}" -hls_key_info_file "$KEYINFO" -hls_segment_filename "$OUT/hls-aes/seg_%03d.ts" "$OUT/hls-aes/index.m3u8"
rm -f "$KEYINFO"

echo "== HLS with fragmented MP4 (EXT-X-MAP)"
"${FF[@]}" "${VIDEO[@]}" "${AUDIO[@]}" -map 0:v -map 1:a "${H264[@]}" "${AAC[@]}" \
  "${SEGMENTED[@]}" -hls_segment_type fmp4 -hls_fmp4_init_filename init.mp4 \
  -hls_segment_filename "$OUT/hls-fmp4/seg_%03d.m4s" "$OUT/hls-fmp4/index.m3u8"

echo "== codec and container matrix"
"${FF[@]}" "${VIDEO[@]}" "${AUDIO[@]}" "${H264[@]}" "${AAC[@]}" "$OUT/codec/h264-aac.mkv"
"${FF[@]}" "${VIDEO[@]}" "${AUDIO[@]}" "${H264[@]}" -c:a libopus -b:a 48k "$OUT/codec/h264-opus.mkv"
"${FF[@]}" "${VIDEO[@]}" "${AUDIO[@]}" -c:v libx264 -preset veryfast -profile:v high10 -pix_fmt yuv420p10le -b:v 250k -g 48 "${AAC[@]}" "$OUT/codec/h264-hi10-aac.mp4"
"${FF[@]}" "${VIDEO[@]}" "${AUDIO[@]}" -c:v libx265 -preset ultrafast -x265-params log-level=error -tag:v hvc1 -pix_fmt yuv420p -b:v 250k "${AAC[@]}" "$OUT/codec/hevc-aac.mp4"
"${FF[@]}" "${VIDEO[@]}" "${AUDIO[@]}" -c:v libvpx-vp9 -b:v 250k -deadline realtime -cpu-used 8 -c:a libopus -b:a 48k "$OUT/codec/vp9-opus.webm"
"${FF[@]}" "${VIDEO[@]}" "${AUDIO[@]}" -c:v libvpx -b:v 250k -deadline realtime -cpu-used 8 -c:a libopus -b:a 48k "$OUT/codec/vp8-opus.webm"
"${FF[@]}" "${VIDEO[@]}" "${AUDIO[@]}" -c:v libsvtav1 -preset 10 -crf 45 -g 48 -pix_fmt yuv420p "${AAC[@]}" "$OUT/codec/av1-aac.mp4"
"${FF[@]}" "${AUDIO[@]}" -c:a flac "$OUT/codec/flac.flac"

du -sh "$OUT"
find "$OUT" -type f | sort | sed "s#^$OUT/##"
