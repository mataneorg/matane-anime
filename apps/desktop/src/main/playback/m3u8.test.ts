import { describe, expect, it } from 'vitest';
import { decodeResource, encodeResource, looksLikePlaylist, resolveUri, rewriteManifest } from './m3u8';

const wrap = (url: string): string => `anime://play/S/r/${encodeResource(url)}`;
const unwrap = (wrapped: string): string => {
  const encoded = wrapped.split('/r/')[1] ?? '';
  return decodeResource(encoded) ?? '<invalid>';
};

describe('resource encoding', () => {
  it('round-trips URLs with queries and unicode', () => {
    for (const url of ['http://a.test/x.ts?token=a+b&c=d%20e', 'https://b.test:8443/ü/ファイル.m4s#frag']) {
      expect(decodeResource(encodeResource(url))).toBe(url);
    }
  });

  it('rejects text that is not canonical base64url', () => {
    expect(decodeResource('')).toBeNull();
    expect(decodeResource('not base64!')).toBeNull();
    expect(decodeResource('aHR0cDovL2EudGVzdA')).toBe('http://a.test');
    expect(decodeResource('aHR0cDovL2EudGVzdB')).toBeNull();
  });
});

describe('resolveUri', () => {
  it('resolves relative, root-relative and absolute URIs and refuses other schemes', () => {
    const base = 'http://site.test/hls/v360/index.m3u8?sig=1';
    expect(resolveUri('seg_000.ts', base)).toBe('http://site.test/hls/v360/seg_000.ts');
    expect(resolveUri('../enc.key', base)).toBe('http://site.test/hls/enc.key');
    expect(resolveUri('/abs/seg.ts', base)).toBe('http://site.test/abs/seg.ts');
    expect(resolveUri('https://cdn.test/s.ts', base)).toBe('https://cdn.test/s.ts');
    expect(resolveUri('data:text/plain;base64,AAAA', base)).toBeNull();
    expect(resolveUri('skd://key', base)).toBeNull();
    expect(resolveUri('  ', base)).toBeNull();
  });
});

describe('looksLikePlaylist', () => {
  it('uses the content type or the path', () => {
    expect(looksLikePlaylist('http://a.test/x', 'application/vnd.apple.mpegurl')).toBe(true);
    expect(looksLikePlaylist('http://a.test/x', 'audio/x-mpegURL')).toBe(true);
    expect(looksLikePlaylist('http://a.test/index.m3u8?x=1', 'text/plain')).toBe(true);
    expect(looksLikePlaylist('http://a.test/seg.ts', 'video/mp2t')).toBe(false);
  });
});

describe('rewriteManifest', () => {
  it('rewrites variant lines of a master playlist', () => {
    const master = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=520000,RESOLUTION=640x360',
      'v360/index.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=260000,RESOLUTION=426x240',
      'v240/index.m3u8',
      '',
    ].join('\n');
    const result = rewriteManifest(master, 'http://site.test/hls-ts/master.m3u8', wrap);
    const lines = result.text.split('\n');
    expect(lines[0]).toBe('#EXTM3U');
    expect(lines[1]).toBe('#EXT-X-STREAM-INF:BANDWIDTH=520000,RESOLUTION=640x360');
    expect(unwrap(lines[2] ?? '')).toBe('http://site.test/hls-ts/v360/index.m3u8');
    expect(unwrap(lines[4] ?? '')).toBe('http://site.test/hls-ts/v240/index.m3u8');
    expect(result.hosts).toEqual(['site.test']);
  });

  it('rewrites segments, keys and init maps, and keeps CRLF line endings', () => {
    const media = [
      '#EXTM3U',
      '#EXT-X-VERSION:7',
      '#EXT-X-KEY:METHOD=AES-128,URI="enc.key",IV=0x00000000000000000000000000000001',
      '#EXT-X-MAP:URI="init.mp4",BYTERANGE="720@0"',
      '#EXTINF:2.000,',
      'seg_000.m4s',
      '#EXTINF:2.000,',
      'http://cdn.test:9000/other/seg_001.m4s?t=1',
      '#EXT-X-ENDLIST',
      '',
    ].join('\r\n');
    const result = rewriteManifest(media, 'http://site.test/hls-aes/index.m3u8', wrap);
    expect(result.text).toContain('\r\n');
    const lines = result.text.split('\r\n');
    const key = /URI="([^"]+)"/.exec(lines[2] ?? '')?.[1] ?? '';
    expect(unwrap(key)).toBe('http://site.test/hls-aes/enc.key');
    expect(lines[2]).toContain('IV=0x00000000000000000000000000000001');
    expect(unwrap(/URI="([^"]+)"/.exec(lines[3] ?? '')?.[1] ?? '')).toBe('http://site.test/hls-aes/init.mp4');
    expect(lines[3]).toContain('BYTERANGE="720@0"');
    expect(unwrap(lines[5] ?? '')).toBe('http://site.test/hls-aes/seg_000.m4s');
    expect(unwrap(lines[7] ?? '')).toBe('http://cdn.test:9000/other/seg_001.m4s?t=1');
    expect(lines[8]).toBe('#EXT-X-ENDLIST');
    expect([...result.hosts].sort()).toEqual(['cdn.test:9000', 'site.test']);
  });

  it('rewrites alternative renditions and leaves non-http URIs alone', () => {
    const master = [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="ja",DEFAULT=YES,URI="audio/ja.m3u8"',
      '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://abc"',
      '#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=100000,URI="iframes.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=900000,AUDIO="aud"',
      'video.m3u8',
    ].join('\n');
    const result = rewriteManifest(master, 'https://site.test/m/master.m3u8', wrap);
    const lines = result.text.split('\n');
    expect(unwrap(/URI="([^"]+)"/.exec(lines[1] ?? '')?.[1] ?? '')).toBe('https://site.test/m/audio/ja.m3u8');
    expect(lines[2]).toContain('URI="skd://abc"');
    expect(unwrap(/URI="([^"]+)"/.exec(lines[3] ?? '')?.[1] ?? '')).toBe('https://site.test/m/iframes.m3u8');
    expect(unwrap(lines[5] ?? '')).toBe('https://site.test/m/video.m3u8');
  });
});
