import { describe, expect, it } from 'vitest';
import { codecFamily, isStreamUnsupported, isVariantSupported, parseVariantCodecs } from './codecs';

const noHevc = { h264: true, hevc: false, aac: true, av1: false };

describe('parseVariantCodecs', () => {
  it('lists the codecs of each variant, in order', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.64001f, mp4a.40.2",RESOLUTION=1280x720',
      'a.m3u8',
      '#EXT-X-STREAM-INF:CODECS="hvc1.1.6.L93.B0",BANDWIDTH=2',
      'b.m3u8',
    ].join('\r\n');
    expect(parseVariantCodecs(playlist)).toEqual([['avc1.64001f', 'mp4a.40.2'], ['hvc1.1.6.L93.B0']]);
  });

  it('keeps a variant without CODECS as an unknown (empty) entry', () => {
    expect(parseVariantCodecs('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\na.m3u8\n')).toEqual([[]]);
  });

  it('does not take SUPPLEMENTAL-CODECS for CODECS', () => {
    expect(parseVariantCodecs('#EXT-X-STREAM-INF:SUPPLEMENTAL-CODECS="dvh1.05.06",CODECS="hvc1.2.4.L120"\nx')).toEqual([
      ['hvc1.2.4.L120'],
    ]);
    expect(parseVariantCodecs('#EXT-X-STREAM-INF:SUPPLEMENTAL-CODECS="dvh1.05.06"\nx')).toEqual([[]]);
  });

  it('finds nothing in a media playlist, and treats a CODECS cut off by the read cap as unknown', () => {
    expect(parseVariantCodecs('#EXTM3U\n#EXTINF:4,\nseg.ts\n')).toEqual([]);
    expect(parseVariantCodecs('#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.64001f,mp4a.4')).toEqual([[]]);
  });
});

describe('codecFamily', () => {
  it('groups the spellings of one codec', () => {
    expect(['avc1.640028', 'avc3.64001f'].map(codecFamily)).toEqual(['h264', 'h264']);
    expect(['hvc1.1.6.L93.B0', 'hev1.1.6.L93.B0'].map(codecFamily)).toEqual(['hevc', 'hevc']);
    expect(['vp09.00.10.08', 'av01.0.05M.08', 'mp4a.40.2', 'mp4a.40.5'].map(codecFamily)).toEqual([
      'vp9',
      'av1',
      'aac',
      'aac',
    ]);
    expect(['opus', 'flac', 'ac-3', 'ec-3', 'AVC1.64001F'].map(codecFamily)).toEqual([
      'opus',
      'flac',
      'ac3',
      'eac3',
      'h264',
    ]);
  });

  it('has no family for what it does not judge', () => {
    expect(['dvh1.05.06', 'mp4a.69', 'wvtt', ''].map(codecFamily)).toEqual([null, null, null, null]);
  });
});

describe('isVariantSupported', () => {
  it('fails on any codec of a family reported unsupported', () => {
    expect(isVariantSupported(['avc1.64001f', 'mp4a.40.2'], noHevc)).toBe(true);
    expect(isVariantSupported(['hvc1.1.6.L93.B0', 'mp4a.40.2'], noHevc)).toBe(false);
  });

  it('does not judge unknown codecs or families that were not measured', () => {
    expect(isVariantSupported(['dvh1.05.06'], noHevc)).toBe(true);
    expect(isVariantSupported(['vp09.00.10.08'], noHevc)).toBe(true);
    expect(isVariantSupported([], noHevc)).toBe(true);
  });
});

describe('isStreamUnsupported (PLY-12)', () => {
  const hevc = ['hvc1.1.6.L93.B0', 'mp4a.40.2'];
  const avc = ['avc1.64001f', 'mp4a.40.2'];

  it('is true only when every variant is unsupported', () => {
    expect(isStreamUnsupported([hevc, ['av01.0.05M.08']], noHevc)).toBe(true);
    expect(isStreamUnsupported([hevc, avc], noHevc)).toBe(false);
  });

  it('keeps a stream with a variant of unknown codecs', () => {
    expect(isStreamUnsupported([hevc, []], noHevc)).toBe(false);
  });

  it('changes nothing without a report, without variants or without CODECS', () => {
    expect(isStreamUnsupported([hevc], null)).toBe(false);
    expect(isStreamUnsupported([], noHevc)).toBe(false);
    expect(isStreamUnsupported(undefined, noHevc)).toBe(false);
  });
});
