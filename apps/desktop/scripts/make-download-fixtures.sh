#!/usr/bin/env bash
# Generates the HLS fixtures of the download engine (docs/plans/fase-3-download-update-beta.md).
# Unlike make-fixtures.sh it only adds folders (`hls-audio`, `hls-long`, `hls-byterange`, `hls-keyrot`, `hls-live`)
# and never touches the playback fixtures. Run with `pnpm fixtures:download` (needs ffmpeg and openssl) and commit
# the result: CI never needs ffmpeg. Everything is tiny on purpose.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=e2e/fixtures/media
rm -rf "$OUT"/{hls-audio,hls-long,hls-byterange,hls-keyrot,hls-live}
mkdir -p "$OUT"/{hls-audio/v360,hls-audio/v240,hls-audio/audio-ja,hls-audio/audio-en,hls-long,hls-byterange,hls-keyrot,hls-live}

FF=(ffmpeg -hide_banner -loglevel error -y)
VIDEO=(-f lavfi -i "testsrc2=size=640x360:rate=24:duration=6")
H264=(-c:v libx264 -preset veryfast -profile:v main -pix_fmt yuv420p -b:v 250k -maxrate 300k -bufsize 600k -g 48 -keyint_min 48 -sc_threshold 0)
AAC=(-c:a aac -b:a 48k)
SEGMENTED=(-f hls -hls_time 2 -hls_playlist_type vod)

echo "== separate audio renditions (EXT-X-MEDIA TYPE=AUDIO): video-only variants, two audio groups"
"${FF[@]}" "${VIDEO[@]}" -an "${H264[@]}" "${SEGMENTED[@]}" \
  -hls_segment_filename "$OUT/hls-audio/v360/seg_%03d.ts" "$OUT/hls-audio/v360/index.m3u8"
"${FF[@]}" "${VIDEO[@]}" -an -vf scale=426:240 "${H264[@]}" -b:v 120k -maxrate 150k "${SEGMENTED[@]}" \
  -hls_segment_filename "$OUT/hls-audio/v240/seg_%03d.ts" "$OUT/hls-audio/v240/index.m3u8"
"${FF[@]}" -f lavfi -i "sine=frequency=440:duration=6" "${AAC[@]}" "${SEGMENTED[@]}" \
  -hls_segment_filename "$OUT/hls-audio/audio-ja/seg_%03d.ts" "$OUT/hls-audio/audio-ja/index.m3u8"
"${FF[@]}" -f lavfi -i "sine=frequency=660:duration=6" "${AAC[@]}" "${SEGMENTED[@]}" \
  -hls_segment_filename "$OUT/hls-audio/audio-en/seg_%03d.ts" "$OUT/hls-audio/audio-en/index.m3u8"
cat > "$OUT/hls-audio/master.m3u8" <<'PLAYLIST'
#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=NO,AUTOSELECT=YES,URI="audio-en/index.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Japanese",LANGUAGE="ja",DEFAULT=YES,AUTOSELECT=YES,URI="audio-ja/index.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=320000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2",AUDIO="aud"
v360/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=170000,RESOLUTION=426x240,CODECS="avc1.4d4015,mp4a.40.2",AUDIO="aud"
v240/index.m3u8
PLAYLIST

echo "== a 24 segment episode (48 s, 320x180) for pause, cancel and benchmarks"
"${FF[@]}" -f lavfi -i "testsrc2=size=320x180:rate=12:duration=48" -f lavfi -i "sine=frequency=330:duration=48" \
  "${H264[@]}" -b:v 60k -maxrate 80k -bufsize 160k -g 24 -keyint_min 24 "${AAC[@]}" "${SEGMENTED[@]}" \
  -hls_segment_filename "$OUT/hls-long/seg_%03d.ts" "$OUT/hls-long/index.m3u8"

echo "== one file with EXT-X-BYTERANGE"
"${FF[@]}" "${VIDEO[@]}" -f lavfi -i "sine=frequency=440:duration=6" -map 0:v -map 1:a "${H264[@]}" "${AAC[@]}" \
  "${SEGMENTED[@]}" -hls_flags single_file -hls_segment_filename "$OUT/hls-byterange/media.ts" "$OUT/hls-byterange/index.m3u8"

echo "== AES-128 with a key that changes half way (two EXT-X-KEY lines, explicit IVs)"
TMP="$(mktemp -d)"
"${FF[@]}" "${VIDEO[@]}" -f lavfi -i "sine=frequency=440:duration=6" -map 0:v -map 1:a "${H264[@]}" "${AAC[@]}" \
  "${SEGMENTED[@]}" -hls_segment_filename "$TMP/seg_%03d.ts" "$TMP/index.m3u8"
openssl rand 16 > "$OUT/hls-keyrot/key-a.key"
openssl rand 16 > "$OUT/hls-keyrot/key-b.key"
IV_A="$(openssl rand -hex 16)"
IV_B="$(openssl rand -hex 16)"
{
  echo "#EXTM3U"
  echo "#EXT-X-VERSION:3"
  echo "#EXT-X-TARGETDURATION:2"
  echo "#EXT-X-MEDIA-SEQUENCE:0"
  echo "#EXT-X-PLAYLIST-TYPE:VOD"
  index=0
  for segment in "$TMP"/seg_*.ts; do
    name="$(basename "$segment")"
    if [ "$index" -eq 0 ]; then key=key-a; iv="$IV_A"; echo "#EXT-X-KEY:METHOD=AES-128,URI=\"key-a.key\",IV=0x$IV_A"; fi
    if [ "$index" -eq 2 ]; then key=key-b; iv="$IV_B"; echo "#EXT-X-KEY:METHOD=AES-128,URI=\"key-b.key\",IV=0x$IV_B"; fi
    openssl enc -aes-128-cbc -K "$(xxd -p -c 32 "$OUT/hls-keyrot/$key.key")" -iv "$iv" -in "$segment" -out "$OUT/hls-keyrot/$name"
    echo "#EXTINF:2.000000,"
    echo "$name"
    index=$((index + 1))
  done
  echo "#EXT-X-ENDLIST"
} > "$OUT/hls-keyrot/index.m3u8"
rm -rf "$TMP"

echo "== a live playlist: segments are the ones of hls-ts, but it never ends"
cat > "$OUT/hls-live/index.m3u8" <<'PLAYLIST'
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:2.000000,
../hls-ts/v360/seg_000.ts
#EXTINF:2.000000,
../hls-ts/v360/seg_001.ts
#EXTINF:2.000000,
../hls-ts/v360/seg_002.ts
PLAYLIST

du -sh "$OUT"/{hls-audio,hls-long,hls-byterange,hls-keyrot,hls-live}
