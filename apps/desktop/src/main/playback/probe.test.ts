import { describe, expect, it } from 'vitest';
import { probeStream, readHead } from './probe';
import type { UpstreamFetch } from './proxy';
import type { PlaybackSession } from './sessions';

const session: PlaybackSession = { id: 's', entryUrl: 'https://x/', kind: 'hls', headers: {}, hostsSeen: new Set() };
const stream = (url: string, extra: object = {}) => ({ url, server: 'A', ...extra });
const answering =
  (body: string | Uint8Array, init: ResponseInit = {}): UpstreamFetch =>
  async () =>
    new Response(body as BodyInit, init);

describe('readHead', () => {
  it('reads only what it needs from a long body and stops the rest', async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(1024).fill(65));
        if (pulled > 1000) controller.close();
      },
    });
    const head = await readHead(new Response(body), 3000);
    expect(head.byteLength).toBe(3000);
    expect(pulled).toBeLessThan(10);
  });
});

describe('probeStream (STR-2)', () => {
  it('accepts a playlist that is one', async () => {
    const result = await probeStream(stream('https://x/a.m3u8'), answering('#EXTM3U\n#EXT-X-VERSION:3\n'), session);
    expect(result).toEqual({ ok: true, kind: 'hls' });
  });

  it('rejects an HTML page served in place of a playlist', async () => {
    const result = await probeStream(stream('https://x/a.m3u8'), answering('<html>blocked</html>'), session);
    expect(result).toMatchObject({ ok: false, reason: 'not a playlist' });
  });

  it('reports the status of a refusal, so an expired link can be told apart', async () => {
    const result = await probeStream(stream('https://x/a.m3u8'), answering('no', { status: 403 }), session);
    expect(result).toEqual({ ok: false, reason: 'HTTP 403', httpStatus: 403 });
  });

  it('asks a file for one byte, and accepts 206 or 200', async () => {
    let range: string | undefined;
    const upstream: UpstreamFetch = async (_url, init) => {
      range = init.headers['Range'];
      return new Response(new Uint8Array([0, 0]), { status: 206 });
    };
    expect(await probeStream(stream('https://x/v.mp4'), upstream, session)).toEqual({ ok: true, kind: 'mp4' });
    expect(range).toBe('bytes=0-1');
    expect(await probeStream(stream('https://x/v.mp4'), answering(new Uint8Array([1, 2, 3])), session)).toMatchObject({
      ok: true,
    });
  });

  it('sniffs a URL that says nothing: a playlist body means HLS, a video type means a file', async () => {
    expect(await probeStream(stream('https://x/play?id=1'), answering('#EXTM3U\n'), session)).toEqual({
      ok: true,
      kind: 'hls',
    });
    expect(
      await probeStream(
        stream('https://x/play?id=1'),
        answering(new Uint8Array(8), { headers: { 'content-type': 'video/mp4' } }),
        session,
      ),
    ).toEqual({ ok: true, kind: 'mp4' });
    expect(
      await probeStream(
        stream('https://x/play?id=1'),
        answering('<html>', { headers: { 'content-type': 'text/html' } }),
        session,
      ),
    ).toMatchObject({ ok: false });
  });

  it('turns a network failure and a timeout into a failed probe, never a throw', async () => {
    const broken: UpstreamFetch = async () => {
      throw new Error('ECONNRESET');
    };
    expect(await probeStream(stream('https://x/a.m3u8'), broken, session)).toMatchObject({
      ok: false,
      reason: 'ECONNRESET',
    });
    const hung: UpstreamFetch = (_url, init) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
    expect(await probeStream(stream('https://x/a.m3u8'), hung, session, 50)).toMatchObject({
      ok: false,
      reason: 'timed out',
    });
  });

  it('sends the headers the stream asked for', async () => {
    let seen: Record<string, string> = {};
    const upstream: UpstreamFetch = async (_url, init) => {
      seen = init.headers;
      return new Response('#EXTM3U');
    };
    await probeStream(stream('https://x/a.m3u8', { headers: { Referer: 'https://site.test/' } }), upstream, session);
    expect(seen).toEqual({ Referer: 'https://site.test/' });
  });
});
