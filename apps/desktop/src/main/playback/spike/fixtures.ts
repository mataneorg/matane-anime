import type { SpikeFixture } from '@matane-anime/shared';

/** A fixture and where it lives under `e2e/fixtures/media/` (made by `pnpm fixtures`). */
export interface FixtureDef extends SpikeFixture {
  path: string;
}

const AVC_AAC = 'avc1.4d401e,mp4a.40.2';
const HLS = 'application/vnd.apple.mpegurl';

export const FIXTURES: FixtureDef[] = [
  // Transport: these must play for `anime://` to be accepted as the media transport.
  {
    id: 'hls-ts',
    label: 'HLS, MPEG-TS, master playlist',
    group: 'transport',
    kind: 'hls',
    container: HLS,
    codecs: AVC_AAC,
    expect: 'play',
    path: 'hls-ts/master.m3u8',
  },
  {
    id: 'hls-abs',
    label: 'HLS, absolute segment URIs on another host',
    group: 'transport',
    kind: 'hls',
    container: HLS,
    codecs: AVC_AAC,
    expect: 'play',
    path: 'hls-abs/index.m3u8',
  },
  {
    id: 'hls-aes',
    label: 'HLS, AES-128 encrypted segments',
    group: 'transport',
    kind: 'hls',
    container: HLS,
    codecs: AVC_AAC,
    expect: 'play',
    path: 'hls-aes/index.m3u8',
  },
  {
    id: 'hls-fmp4',
    label: 'HLS, fragmented MP4 (EXT-X-MAP)',
    group: 'transport',
    kind: 'hls',
    container: HLS,
    codecs: AVC_AAC,
    expect: 'play',
    path: 'hls-fmp4/index.m3u8',
  },
  {
    id: 'mp4-range',
    label: 'MP4, seek through Range requests',
    group: 'transport',
    kind: 'file',
    container: 'video/mp4',
    codecs: AVC_AAC,
    expect: 'play',
    path: 'mp4/h264-aac.mp4',
  },
  {
    id: 'hls-expiring',
    label: 'HLS, stream that expires (403) after the first segment',
    group: 'transport',
    kind: 'hls',
    container: HLS,
    codecs: AVC_AAC,
    expect: 'expire',
    path: 'expiring/index.m3u8',
  },

  // Codecs and containers: recorded, not asserted. The results become docs/adr/0009-codec-support.md.
  {
    id: 'mkv-h264-aac',
    label: 'MKV, H.264 + AAC',
    group: 'codec',
    kind: 'file',
    container: 'video/x-matroska',
    codecs: AVC_AAC,
    expect: 'record',
    path: 'codec/h264-aac.mkv',
  },
  {
    id: 'mkv-h264-opus',
    label: 'MKV, H.264 + Opus',
    group: 'codec',
    kind: 'file',
    container: 'video/x-matroska',
    codecs: 'avc1.4d401e,opus',
    expect: 'record',
    path: 'codec/h264-opus.mkv',
  },
  {
    id: 'mp4-h264-hi10',
    label: 'MP4, H.264 High 10 (10-bit) + AAC',
    group: 'codec',
    kind: 'file',
    container: 'video/mp4',
    codecs: 'avc1.6e001e,mp4a.40.2',
    expect: 'record',
    path: 'codec/h264-hi10-aac.mp4',
  },
  {
    id: 'mp4-hevc',
    label: 'MP4, HEVC + AAC',
    group: 'codec',
    kind: 'file',
    container: 'video/mp4',
    codecs: 'hvc1.1.6.L90.B0,mp4a.40.2',
    expect: 'record',
    path: 'codec/hevc-aac.mp4',
  },
  {
    id: 'webm-vp9',
    label: 'WebM, VP9 + Opus',
    group: 'codec',
    kind: 'file',
    container: 'video/webm',
    codecs: 'vp09.00.10.08,opus',
    expect: 'record',
    path: 'codec/vp9-opus.webm',
  },
  {
    id: 'webm-vp8',
    label: 'WebM, VP8 + Opus',
    group: 'codec',
    kind: 'file',
    container: 'video/webm',
    codecs: 'vp8,opus',
    expect: 'record',
    path: 'codec/vp8-opus.webm',
  },
  {
    id: 'mp4-av1',
    label: 'MP4, AV1 + AAC',
    group: 'codec',
    kind: 'file',
    container: 'video/mp4',
    codecs: 'av01.0.04M.08,mp4a.40.2',
    expect: 'record',
    path: 'codec/av1-aac.mp4',
  },
  {
    id: 'flac',
    label: 'FLAC audio only',
    group: 'codec',
    kind: 'file',
    container: 'audio/flac',
    codecs: 'flac',
    expect: 'record',
    path: 'codec/flac.flac',
  },
];

export function findFixture(id: string): FixtureDef | undefined {
  return FIXTURES.find((fixture) => fixture.id === id);
}
