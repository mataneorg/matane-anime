import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseRange } from './local';
import { type UpstreamFetch, createAnimeHandler } from './proxy';
import { SessionStore } from './sessions';

const MP4 = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
const PLAYLIST = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key_0.key"\n#EXTINF:2.0,\nseg_00000.ts\n#EXT-X-ENDLIST\n';

let dir: string;
let folder: string;
let mp4: string;
const sessions = new SessionStore();
let upstreamCalls = 0;
const fetchUpstream: UpstreamFetch = async () => {
  upstreamCalls++;
  return new Response(null, { status: 500 });
};
const handler = createAnimeHandler({ sessions, fetchUpstream });

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'matane-local-'));
  folder = join(dir, 'Episode 1');
  mkdirSync(join(folder, 'audio'), { recursive: true });
  writeFileSync(join(folder, 'playlist.m3u8'), PLAYLIST);
  writeFileSync(join(folder, 'seg_00000.ts'), MP4);
  writeFileSync(join(folder, 'key_0.key'), Buffer.alloc(16, 7));
  writeFileSync(join(folder, 'init_0.mp4'), 'init');
  writeFileSync(join(folder, 'audio', 'index.m3u8'), '#EXTM3U\n');
  writeFileSync(join(dir, 'secret.txt'), 'top secret');
  mkdirSync(join(dir, 'outside'));
  writeFileSync(join(dir, 'outside', 'a.ts'), 'outside');
  symlinkSync(join(dir, 'secret.txt'), join(folder, 'link.ts'));
  symlinkSync(join(dir, 'outside'), join(folder, 'linked-dir'));
  mp4 = join(dir, 'Episode 1.mp4');
  writeFileSync(mp4, MP4);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const hls = () => sessions.createLocal({ path: folder, media: 'hls' });
const file = () => sessions.createLocal({ path: mp4, media: 'mp4' });
const get = (url: string, headers: Record<string, string> = {}, method = 'GET') =>
  handler(new Request(url, { method, headers }));
const bytes = async (response: Response) => Buffer.from(await response.arrayBuffer());

describe('local sessions: HLS folder', () => {
  it('has no hosts and no upstream', () => {
    const session = hls();
    expect(session.kind).toBe('local');
    expect(session.hostsSeen.size).toBe(0);
  });

  it('serves the playlist untouched, with the right type and CORS headers', async () => {
    const { id } = hls();
    const response = await get(`anime://play/${id}/playlist.m3u8`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/vnd.apple.mpegurl');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(await response.text()).toBe(PLAYLIST);
    expect(upstreamCalls).toBe(0);
  });

  it('serves segments, keys, init segments and nested playlists by their relative names', async () => {
    const { id } = hls();
    const cases: [string, string][] = [
      ['seg_00000.ts', 'video/mp2t'],
      ['key_0.key', 'application/octet-stream'],
      ['init_0.mp4', 'video/mp4'],
      ['audio/index.m3u8', 'application/vnd.apple.mpegurl'],
    ];
    for (const [name, type] of cases) {
      const response = await get(`anime://play/${id}/${name}`);
      expect(response.status, name).toBe(200);
      expect(response.headers.get('content-type'), name).toBe(type);
    }
    expect((await bytes(await get(`anime://play/${id}/seg_00000.ts`))).equals(MP4)).toBe(true);
    expect(upstreamCalls).toBe(0);
  });

  it('answers a ranged request on a segment with 206', async () => {
    const { id } = hls();
    const response = await get(`anime://play/${id}/seg_00000.ts`, { range: 'bytes=10-19' });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 10-19/1000');
    expect((await bytes(response)).equals(MP4.subarray(10, 20))).toBe(true);
  });

  it('answers 404 file_missing for a file that is not there', async () => {
    const { id } = hls();
    const response = await get(`anime://play/${id}/seg_99999.ts`);
    expect(response.status).toBe(404);
    expect(response.headers.get('x-error-code')).toBe('file_missing');
  });

  it('answers 404 for a directory', async () => {
    const { id } = hls();
    const response = await get(`anime://play/${id}/audio`);
    expect(response.status).toBe(404);
  });

  it.each([
    ['dot segments', 'a/../../secret.txt'],
    ['percent-encoded dot segments', '%2e%2e/secret.txt'],
    ['mixed-case encoded dot segments', '%2E%2e/%2e%2E/secret.txt'],
    ['encoded slash', '..%2fsecret.txt'],
    ['encoded slash inside a name', 'audio%2f..%2f..%2fsecret.txt'],
    ['encoded backslash', '..%5csecret.txt'],
    ['encoded NUL', 'seg_00000.ts%00.png'],
    ['absolute path as one segment', '%2Fetc%2Fpasswd'],
    ['double slash', '/etc/passwd'],
  ])('never reads outside the folder: %s', async (_name, path) => {
    const { id } = hls();
    const response = await get(`anime://play/${id}/${path}`);
    expect(response.status === 403 || response.status === 404 || response.status === 400).toBe(true);
    // Whatever the status, the body is never the secret file.
    const body = await response.text();
    expect(body).not.toContain('top secret');
    expect(body).not.toContain('outside');
  });

  it('refuses a ../ that survives URL parsing with 403 path_not_allowed', async () => {
    const { id } = hls();
    // Built by hand: `new Request` would normalize the dots away, a custom caller might not.
    const request = new Request(`anime://play/${id}/x`);
    Object.defineProperty(request, 'url', { value: `anime://play/${id}/%2e%2e%2fsecret.txt` });
    const response = await handler(request);
    expect(response.status).toBe(403);
    expect(response.headers.get('x-error-code')).toBe('path_not_allowed');
  });

  it('refuses a symlink that points outside the folder', async () => {
    const { id } = hls();
    for (const path of ['link.ts', 'linked-dir/a.ts']) {
      const response = await get(`anime://play/${id}/${path}`);
      expect(response.status, path).toBe(403);
      expect(response.headers.get('x-error-code')).toBe('path_not_allowed');
    }
  });

  it('answers 404 when the whole folder is gone', async () => {
    const { id } = sessions.createLocal({ path: join(dir, 'nope'), media: 'hls' });
    const response = await get(`anime://play/${id}/playlist.m3u8`);
    expect(response.status).toBe(404);
    expect(response.headers.get('x-error-code')).toBe('file_missing');
  });
});

describe('local sessions: MP4 file', () => {
  it('serves the whole file whatever name the player asks for', async () => {
    const { id } = file();
    const response = await get(`anime://play/${id}/media.mp4`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-length')).toBe('1000');
    expect((await bytes(response)).equals(MP4)).toBe(true);
  });

  it('answers HEAD with the headers and no body', async () => {
    const { id } = file();
    const response = await get(`anime://play/${id}/media.mp4`, {}, 'HEAD');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe('1000');
    expect(await response.text()).toBe('');
  });

  it('answers a bounded range with 206 and a correct Content-Range', async () => {
    const { id } = file();
    const response = await get(`anime://play/${id}/media.mp4`, { range: 'bytes=0-1' });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 0-1/1000');
    expect(response.headers.get('content-length')).toBe('2');
    expect((await bytes(response)).equals(MP4.subarray(0, 2))).toBe(true);
  });

  it('answers an open-ended range from the offset to the end', async () => {
    const { id } = file();
    const response = await get(`anime://play/${id}/media.mp4`, { range: 'bytes=990-' });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 990-999/1000');
    expect((await bytes(response)).equals(MP4.subarray(990))).toBe(true);
  });

  it('answers a suffix range with the last bytes', async () => {
    const { id } = file();
    const response = await get(`anime://play/${id}/media.mp4`, { range: 'bytes=-100' });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 900-999/1000');
    expect((await bytes(response)).equals(MP4.subarray(900))).toBe(true);
  });

  it('clamps a suffix longer than the file and an end past the end', async () => {
    const { id } = file();
    const suffix = await get(`anime://play/${id}/media.mp4`, { range: 'bytes=-5000' });
    expect(suffix.headers.get('content-range')).toBe('bytes 0-999/1000');
    const past = await get(`anime://play/${id}/media.mp4`, { range: 'bytes=500-5000' });
    expect(past.headers.get('content-range')).toBe('bytes 500-999/1000');
  });

  it('answers a range past the end with 416 and the size', async () => {
    const { id } = file();
    for (const range of ['bytes=1000-', 'bytes=2000-3000', 'bytes=-0', 'bytes=5-2']) {
      const response = await get(`anime://play/${id}/media.mp4`, { range });
      expect(response.status, range).toBe(416);
      expect(response.headers.get('content-range'), range).toBe('bytes */1000');
    }
  });

  it('serves the whole file for a Range it does not read', async () => {
    const { id } = file();
    for (const range of ['items=0-5', 'bytes=0-1,5-6', 'bytes=abc']) {
      const response = await get(`anime://play/${id}/media.mp4`, { range });
      expect(response.status, range).toBe(200);
      expect(response.headers.get('content-length')).toBe('1000');
      void response.body?.cancel();
    }
  });

  it('answers 404 file_missing once the file is deleted', async () => {
    const gone = join(dir, 'gone.mp4');
    writeFileSync(gone, 'x');
    const { id } = sessions.createLocal({ path: gone, media: 'mp4' });
    rmSync(gone);
    const response = await get(`anime://play/${id}/media.mp4`);
    expect(response.status).toBe(404);
    expect(response.headers.get('x-error-code')).toBe('file_missing');
  });

  it('rejects methods other than GET and HEAD', async () => {
    const { id } = file();
    const response = await get(`anime://play/${id}/media.mp4`, {}, 'POST');
    expect(response.status).toBe(405);
  });
});

describe('parseRange', () => {
  it.each([
    [null, 100, null],
    ['bytes=0-9', 100, { start: 0, end: 9 }],
    ['bytes=90-', 100, { start: 90, end: 99 }],
    ['bytes=-10', 100, { start: 90, end: 99 }],
    ['bytes=-', 100, null],
    ['bytes=100-', 100, 'unsatisfiable'],
    ['bytes=0-0', 0, 'unsatisfiable'],
  ])('%s of %d', (header, size, expected) => {
    expect(parseRange(header, size)).toEqual(expected);
  });
});
