import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type HlsError,
  buildLocalMaster,
  estimateBytes,
  isMasterPlaylist,
  parseMaster,
  parseMediaPlaylist,
  pickAudio,
  pickVariant,
  MAX_SEGMENTS,
} from './hls';

const MEDIA = resolve(__dirname, '../../../e2e/fixtures/media');
const fixture = (path: string): string => readFileSync(resolve(MEDIA, path), 'utf8');
const CDN = 'https://cdn.example/media';

function failure(run: () => unknown): HlsError {
  try {
    run();
  } catch (error) {
    return error as HlsError;
  }
  throw new Error('expected an HlsError');
}

describe('master playlists', () => {
  const master = parseMaster(fixture('hls-ts/master.m3u8'), `${CDN}/hls-ts/master.m3u8`);

  it('lists variants with their bandwidth and height, URIs resolved against the playlist', () => {
    expect(isMasterPlaylist(fixture('hls-ts/master.m3u8'))).toBe(true);
    expect(isMasterPlaylist(fixture('hls-ts/v360/index.m3u8'))).toBe(false);
    expect(master.variants.map((v) => [v.url, v.bandwidth, v.height])).toEqual([
      [`${CDN}/hls-ts/v360/index.m3u8`, 320000, 360],
      [`${CDN}/hls-ts/v240/index.m3u8`, 170000, 240],
    ]);
    expect(master.audio).toEqual([]);
  });

  it('picks the nearest height by the player ranking, or the tallest for "highest"', () => {
    const heights = (preference: Parameters<typeof pickVariant>[1]) => pickVariant(master.variants, preference).height;
    expect(heights('highest')).toBe(360);
    expect(heights('360')).toBe(360);
    // 240 is the nearest at or below 300; with nothing at or below, the nearest above wins.
    expect(heights('480')).toBe(360);
    expect(pickVariant([{ ...master.variants[1]!, height: 720 }], '360').height).toBe(720);
  });

  it('falls back to bandwidth when no variant has a resolution', () => {
    const variants = [
      { url: 'a', bandwidth: 100, resolution: null, height: null, codecs: null, audioGroup: null },
      { url: 'b', bandwidth: 900, resolution: null, height: null, codecs: null, audioGroup: null },
    ];
    expect(pickVariant(variants, '720').url).toBe('b');
  });

  it('chooses the DEFAULT=YES track of the variant group, or the first one', () => {
    const audio = parseMaster(fixture('hls-audio/master.m3u8'), `${CDN}/hls-audio/master.m3u8`);
    const variant = pickVariant(audio.variants, 'highest');
    expect(variant.audioGroup).toBe('aud');
    expect(audio.audio.map((a) => [a.name, a.isDefault])).toEqual([
      ['English', false],
      ['Japanese', true],
    ]);
    expect(pickAudio(audio, variant)).toMatchObject({ name: 'Japanese', url: `${CDN}/hls-audio/audio-ja/index.m3u8` });

    const noDefault = { ...audio, audio: audio.audio.map((a) => ({ ...a, isDefault: false })) };
    expect(pickAudio(noDefault, variant)?.name).toBe('English');
    expect(pickAudio(audio, { ...variant, audioGroup: null })).toBeNull();
    expect(pickAudio(audio, { ...variant, audioGroup: 'other' })).toBeNull();
  });

  it('treats a rendition without a URI as audio inside the video', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Main",DEFAULT=YES',
      '#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=1280x720,AUDIO="a"',
      'v.m3u8',
    ].join('\n');
    const parsed = parseMaster(text, `${CDN}/m.m3u8`);
    expect(pickAudio(parsed, parsed.variants[0]!)).toBeNull();
  });

  it('refuses text that is not a playlist', () => {
    expect(failure(() => parseMaster('<html></html>', CDN)).code).toBe('invalid_playlist');
    expect(failure(() => parseMaster('#EXTM3U\n#EXT-X-VERSION:3\n', CDN)).code).toBe('invalid_playlist');
  });
});

describe('media playlists', () => {
  it('lists the segments and rewrites the playlist to local names (hls-ts)', () => {
    const playlist = parseMediaPlaylist(fixture('hls-ts/v360/index.m3u8'), `${CDN}/hls-ts/v360/index.m3u8`);
    expect(playlist.segmentCount).toBe(3);
    expect(playlist.durationSeconds).toBeCloseTo(6);
    expect(playlist.resources.map((r) => [r.kind, r.file, r.url])).toEqual([
      ['segment', 'seg_00000.ts', `${CDN}/hls-ts/v360/seg_000.ts`],
      ['segment', 'seg_00001.ts', `${CDN}/hls-ts/v360/seg_001.ts`],
      ['segment', 'seg_00002.ts', `${CDN}/hls-ts/v360/seg_002.ts`],
    ]);
    expect(playlist.localText).toContain('seg_00001.ts\n');
    expect(playlist.localText).not.toContain('cdn.example');
    expect(playlist.localText).toContain('#EXT-X-ENDLIST');
    expect(playlist.localText).toContain('#EXT-X-MEDIA-SEQUENCE:0');
  });

  it('saves the key and keeps the IV (hls-aes)', () => {
    const playlist = parseMediaPlaylist(fixture('hls-aes/index.m3u8'), `${CDN}/hls-aes/index.m3u8`);
    expect(playlist.resources.map((r) => [r.kind, r.file])).toEqual([
      ['key', 'key_0.key'],
      ['segment', 'seg_00000.ts'],
      ['segment', 'seg_00001.ts'],
      ['segment', 'seg_00002.ts'],
    ]);
    expect(playlist.localText).toContain(
      '#EXT-X-KEY:METHOD=AES-128,URI="key_0.key",IV=0xd65e3a51c402874cc308ef35b227e6fa',
    );
  });

  it('saves the init segment of fMP4 (hls-fmp4)', () => {
    const playlist = parseMediaPlaylist(fixture('hls-fmp4/index.m3u8'), `${CDN}/hls-fmp4/index.m3u8`);
    expect(playlist.resources[0]).toMatchObject({ kind: 'init', file: 'init_0.mp4', url: `${CDN}/hls-fmp4/init.mp4` });
    expect(playlist.resources.slice(1).map((r) => r.file)).toEqual(['seg_00000.m4s', 'seg_00001.m4s', 'seg_00002.m4s']);
    expect(playlist.localText).toContain('#EXT-X-MAP:URI="init_0.mp4"');
  });

  it('follows absolute URIs on another host (hls-abs)', () => {
    const text = fixture('hls-abs/index.m3u8').replaceAll('__SITE_B__', 'http://other.example:9000');
    const playlist = parseMediaPlaylist(text, `${CDN}/hls-abs/index.m3u8`);
    expect(playlist.resources.map((r) => r.url)).toEqual([
      'http://other.example:9000/hls-ts/v360/seg_000.ts',
      'http://other.example:9000/hls-ts/v360/seg_001.ts',
      'http://other.example:9000/hls-ts/v360/seg_002.ts',
    ]);
    expect(playlist.localText).not.toContain('other.example');
  });

  it('resolves ../ and keeps the audio track in its own folder (hls-audio)', () => {
    const audio = parseMediaPlaylist(
      fixture('hls-audio/audio-ja/index.m3u8'),
      `${CDN}/hls-audio/audio-ja/index.m3u8`,
      'audio',
    );
    expect(audio.resources.map((r) => r.file)).toEqual([
      'audio/seg_00000.ts',
      'audio/seg_00001.ts',
      'audio/seg_00002.ts',
      'audio/seg_00003.ts',
    ]);
    // The playlist sits in audio/ too, so its own names have no folder.
    expect(audio.localText).toContain('\nseg_00003.ts\n');
    expect(audio.localText).not.toContain('audio/');
  });

  it('turns byte ranges, with implicit offsets, into files of their own (hls-byterange)', () => {
    const playlist = parseMediaPlaylist(fixture('hls-byterange/index.m3u8'), `${CDN}/hls-byterange/index.m3u8`);
    expect(playlist.resources.map((r) => r.byteRange)).toEqual([
      { offset: 0, length: 79148 },
      { offset: 79148, length: 99828 },
      { offset: 178976, length: 83096 },
    ]);
    expect(new Set(playlist.resources.map((r) => r.url))).toEqual(new Set([`${CDN}/hls-byterange/media.ts`]));
    expect(playlist.localText).not.toContain('BYTERANGE');
    expect(playlist.localText).toContain('seg_00002.ts');

    const implicit = parseMediaPlaylist(
      '#EXTM3U\n#EXTINF:2,\n#EXT-X-BYTERANGE:100@50\nm.ts\n#EXTINF:2,\n#EXT-X-BYTERANGE:30\nm.ts\n#EXT-X-ENDLIST\n',
      `${CDN}/i.m3u8`,
    );
    expect(implicit.resources.map((r) => r.byteRange)).toEqual([
      { offset: 50, length: 100 },
      { offset: 150, length: 30 },
    ]);
  });

  it('saves every key of a rotating playlist and points each segment at its own (hls-keyrot)', () => {
    const playlist = parseMediaPlaylist(fixture('hls-keyrot/index.m3u8'), `${CDN}/hls-keyrot/index.m3u8`);
    expect(playlist.resources.filter((r) => r.kind === 'key').map((r) => [r.file, r.url])).toEqual([
      ['key_0.key', `${CDN}/hls-keyrot/key-a.key`],
      ['key_1.key', `${CDN}/hls-keyrot/key-b.key`],
    ]);
    const keyLines = playlist.localText.split('\n').filter((l) => l.startsWith('#EXT-X-KEY'));
    expect(keyLines).toEqual([
      '#EXT-X-KEY:METHOD=AES-128,URI="key_0.key",IV=0xb4c7e00165e4f51964deb113b16983b7',
      '#EXT-X-KEY:METHOD=AES-128,URI="key_1.key",IV=0xbfb1961b670d5fbe7d73fb15ea9858e3',
    ]);
    // Order in the file matters: a key applies to the segments after it.
    const order = playlist.localText.split('\n').filter((l) => /^(#EXT-X-KEY|seg_)/.test(l));
    expect(order.map((l) => l.slice(0, 9))).toEqual(['#EXT-X-KE', 'seg_00000', 'seg_00001', '#EXT-X-KE', 'seg_00002']);
  });

  it('shares a key used by many segments', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-KEY:METHOD=AES-128,URI="k.key"',
      '#EXTINF:1,',
      'a.ts',
      '#EXT-X-KEY:METHOD=AES-128,URI="k.key"',
      '#EXTINF:1,',
      'b.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');
    const playlist = parseMediaPlaylist(text, `${CDN}/p.m3u8`);
    expect(playlist.resources.filter((r) => r.kind === 'key')).toHaveLength(1);
    expect(playlist.localText).not.toContain('IV=');
  });

  it('rejects a live playlist with a typed error (hls-live)', () => {
    const error = failure(() => parseMediaPlaylist(fixture('hls-live/index.m3u8'), `${CDN}/hls-live/index.m3u8`));
    expect(error.code).toBe('live');
    expect(error.message).toMatch(/live/i);
  });

  it('rejects encryption it cannot save as plain files', () => {
    const sample = '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="k"\n#EXTINF:1,\na.ts\n#EXT-X-ENDLIST\n';
    expect(failure(() => parseMediaPlaylist(sample, CDN)).code).toBe('unsupported_encryption');
    const drm =
      '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="skd://k",KEYFORMAT="com.apple.streamingkeydelivery"\n#EXTINF:1,\na.ts\n#EXT-X-ENDLIST\n';
    expect(failure(() => parseMediaPlaylist(drm, CDN)).code).toBe('unsupported_encryption');
  });

  it('accepts METHOD=NONE and leaves it alone', () => {
    const text = '#EXTM3U\n#EXT-X-KEY:METHOD=NONE\n#EXTINF:1,\na.ts\n#EXT-X-ENDLIST\n';
    expect(parseMediaPlaylist(text, `${CDN}/p.m3u8`).localText).toContain('#EXT-X-KEY:METHOD=NONE');
  });

  it('refuses a playlist with more segments than an episode can have', () => {
    const segments = (n: number) =>
      `#EXTM3U\n${Array.from({ length: n }, (_, i) => `#EXTINF:1,\ns${i}.ts`).join('\n')}\n#EXT-X-ENDLIST\n`;
    expect(parseMediaPlaylist(segments(MAX_SEGMENTS), CDN).resources).toHaveLength(MAX_SEGMENTS);
    expect(failure(() => parseMediaPlaylist(segments(MAX_SEGMENTS + 1), CDN)).code).toBe('invalid_playlist');
  });

  it('rejects what is not a media playlist, or has nothing to download', () => {
    expect(failure(() => parseMediaPlaylist('nope', CDN)).code).toBe('invalid_playlist');
    expect(failure(() => parseMediaPlaylist(fixture('hls-ts/master.m3u8'), CDN)).code).toBe('invalid_playlist');
    expect(failure(() => parseMediaPlaylist('#EXTM3U\n#EXT-X-ENDLIST\n', CDN)).code).toBe('empty_playlist');
    expect(
      failure(() => parseMediaPlaylist('#EXTM3U\n#EXTINF:1,\ndata:text/plain,x\n#EXT-X-ENDLIST\n', CDN)).code,
    ).toBe('invalid_playlist');
  });

  it('handles CRLF line endings', () => {
    const text = fixture('hls-ts/v360/index.m3u8').replaceAll('\n', '\r\n');
    const playlist = parseMediaPlaylist(text, `${CDN}/hls-ts/v360/index.m3u8`);
    expect(playlist.segmentCount).toBe(3);
    expect(playlist.localText).not.toContain('\r');
  });
});

describe('estimates and the local master', () => {
  it('estimates bytes from bandwidth and duration, or says it cannot', () => {
    expect(estimateBytes(320000, 6)).toBe(240000);
    expect(estimateBytes(null, 6)).toBeNull();
    expect(estimateBytes(320000, 0)).toBeNull();
  });

  it('writes a master that points at the local video and audio playlists', () => {
    const master = parseMaster(fixture('hls-audio/master.m3u8'), `${CDN}/hls-audio/master.m3u8`);
    const variant = pickVariant(master.variants, 'highest');
    const text = buildLocalMaster(variant, pickAudio(master, variant)!);
    expect(text).toContain('URI="audio/index.m3u8"');
    expect(text).toContain('RESOLUTION=640x360');
    expect(text.trimEnd().endsWith('video.m3u8')).toBe(true);
    const reparsed = parseMaster(text, 'file:///x/playlist.m3u8'.replace('file', 'https'));
    expect(reparsed.variants[0]?.audioGroup).toBe('audio');
    expect(pickAudio(reparsed, reparsed.variants[0]!)?.isDefault).toBe(true);
  });
});
