import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DownloadAborted,
  DownloadFetchError,
  type DownloadUpstream,
  type FetchSettings,
  fetchHead,
  fetchResumable,
  fetchText,
  fetchToFile,
  parseContentRange,
  probeSize,
} from './fetch';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'matane-fetch-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

interface Call {
  url: string;
  headers: Record<string, string>;
  extensionId: string | undefined;
}

/** A body that arrives in pieces, optionally breaking after `breakAfter` bytes. */
function body(data: Uint8Array, options: { chunk?: number; breakAfter?: number } = {}): ReadableStream<Uint8Array> {
  const chunk = options.chunk ?? 4;
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (options.breakAfter !== undefined && sent >= options.breakAfter) {
        controller.error(new TypeError('terminated'));
        return;
      }
      if (sent >= data.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(sent + chunk, data.byteLength, options.breakAfter ?? Number.POSITIVE_INFINITY);
      controller.enqueue(data.subarray(sent, end));
      sent = end;
    },
  });
}

function respond(
  data: Uint8Array | string,
  init: ResponseInit & { breakAfter?: number; url?: string; lengthHeader?: number | null } = {},
): Response {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const headers = new Headers(init.headers);
  if (init.lengthHeader !== null) headers.set('content-length', String(init.lengthHeader ?? bytes.byteLength));
  const response = new Response(body(bytes, { breakAfter: init.breakAfter }), { ...init, headers });
  if (init.url) Object.defineProperty(response, 'url', { value: init.url });
  return response;
}

function harness(script: (call: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const controller = new AbortController();
  const upstream: DownloadUpstream = async (url, init, source) => {
    calls.push({ url, headers: init.headers, extensionId: source.extensionId });
    init.signal?.addEventListener('abort', () => undefined);
    return script(calls[calls.length - 1] as Call, calls.length);
  };
  const settings: FetchSettings = {
    upstream,
    source: { extensionId: 'example' },
    headers: { Referer: 'https://site.example/' },
    signal: controller.signal,
    backoffMs: 500,
    timeoutMs: 1000,
    sleep: async (ms) => void sleeps.push(ms),
  };
  return { calls, sleeps, controller, settings };
}

const text = (path: string): string => readFileSync(path, 'utf8');

describe('fetchToFile', () => {
  it('streams the body to disk through a .part file and sends the stream headers', async () => {
    const h = harness(() => respond('0123456789abcdef'));
    const progress: number[] = [];
    const written = await fetchToFile(h.settings, 'https://cdn.example/a.ts', join(dir, 'seg.ts'), {
      onBytes: (n) => progress.push(n),
    });
    expect(written).toBe(16);
    expect(text(join(dir, 'seg.ts'))).toBe('0123456789abcdef');
    expect(readdirSync(dir)).toEqual(['seg.ts']);
    expect(progress.length).toBeGreaterThan(1);
    expect(progress.reduce((a, b) => a + b, 0)).toBe(16);
    expect(h.calls[0]).toEqual({
      url: 'https://cdn.example/a.ts',
      headers: { Referer: 'https://site.example/' },
      extensionId: 'example',
    });
  });

  it('stops a ranged piece that keeps sending past its length, without retrying, and leaves nothing behind', async () => {
    const h = harness(() => respond('0123456789', { status: 206, lengthHeader: null }));
    const error = await fetchToFile(h.settings, 'https://cdn.example/a.mp4', join(dir, 'a.bin'), {
      range: { offset: 0, length: 4 },
      onBytes: () => undefined,
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'too_large', recoverable: false });
    expect(h.calls).toHaveLength(1);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('retries a 5xx with exponential backoff, then succeeds', async () => {
    const h = harness((_c, n) => (n < 3 ? respond('', { status: 503 }) : respond('ok')));
    await fetchToFile(h.settings, 'https://cdn.example/a.ts', join(dir, 'a.ts'), { onBytes: () => undefined });
    expect(h.calls).toHaveLength(3);
    expect(h.sleeps).toEqual([500, 1000]);
    expect(text(join(dir, 'a.ts'))).toBe('ok');
  });

  it('gives up after three retries', async () => {
    const h = harness(() => respond('', { status: 500 }));
    const error = await fetchToFile(h.settings, 'https://cdn.example/a.ts', join(dir, 'a.ts'), {
      onBytes: () => undefined,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DownloadFetchError);
    expect((error as DownloadFetchError).status).toBe(500);
    expect(h.calls).toHaveLength(4);
    expect(h.sleeps).toEqual([500, 1000, 2000]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('does not retry what a retry cannot fix, and flags expired links', async () => {
    for (const status of [404, 401]) {
      const h = harness(() => respond('', { status }));
      await expect(
        fetchToFile(h.settings, 'https://x/a.ts', join(dir, 'a.ts'), { onBytes: () => undefined }),
      ).rejects.toMatchObject({ status, recoverable: false, expired: false });
      expect(h.calls).toHaveLength(1);
    }
    for (const status of [403, 410]) {
      const h = harness(() => respond('', { status }));
      await expect(
        fetchToFile(h.settings, 'https://x/a.ts', join(dir, 'a.ts'), { onBytes: () => undefined }),
      ).rejects.toMatchObject({ status, expired: true });
      expect(h.calls).toHaveLength(1);
    }
  });

  it('waits for Retry-After on a 429', async () => {
    const h = harness((_c, n) =>
      n === 1 ? respond('', { status: 429, headers: { 'retry-after': '3' } }) : respond('ok'),
    );
    await fetchToFile(h.settings, 'https://x/a.ts', join(dir, 'a.ts'), { onBytes: () => undefined });
    expect(h.sleeps).toEqual([3000]);
  });

  it('retries a body that is cut or short, and takes back the bytes of the failed try', async () => {
    const h = harness((_c, n) =>
      n === 1
        ? respond('0123456789', { breakAfter: 6 })
        : n === 2
          ? respond('0123456789', { lengthHeader: 12 })
          : respond('0123456789'),
    );
    let total = 0;
    await fetchToFile(h.settings, 'https://x/a.ts', join(dir, 'a.ts'), { onBytes: (n) => (total += n) });
    expect(h.calls).toHaveLength(3);
    expect(total).toBe(10);
    expect(text(join(dir, 'a.ts'))).toBe('0123456789');
  });

  it('retries a request that fails outright', async () => {
    const h = harness((_c, n) => {
      if (n === 1) throw new TypeError('fetch failed');
      return respond('ok');
    });
    await fetchToFile(h.settings, 'https://x/a.ts', join(dir, 'a.ts'), { onBytes: () => undefined });
    expect(h.calls).toHaveLength(2);
  });

  it('times out after silence, as a recoverable error', async () => {
    const h = harness(() => new Promise<Response>(() => undefined));
    h.settings.timeoutMs = 20;
    h.settings.retries = 1;
    const error = await fetchToFile(h.settings, 'https://x/a.ts', join(dir, 'a.ts'), {
      onBytes: () => undefined,
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'timeout', recoverable: true });
    expect(h.calls).toHaveLength(2);
  });

  it('stops at once on abort, retries nothing and leaves no .part', async () => {
    const h = harness(
      () => new Promise<Response>((resolve) => setTimeout(() => resolve(respond('late', { status: 503 })), 30)),
    );
    const run = fetchToFile(h.settings, 'https://x/a.ts', join(dir, 'a.ts'), { onBytes: () => undefined });
    setTimeout(() => h.controller.abort(), 5);
    await expect(run).rejects.toBeInstanceOf(DownloadAborted);
    expect(h.calls).toHaveLength(1);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('refuses a redirect that ends on a non-http URL', async () => {
    const h = harness(() => respond('x', { url: 'file:///etc/passwd' }));
    await expect(
      fetchToFile(h.settings, 'https://x/a.ts', join(dir, 'a.ts'), { onBytes: () => undefined }),
    ).rejects.toMatchObject({ code: 'redirect', recoverable: false });
  });

  it('asks for a byte range and accepts the 206', async () => {
    const h = harness(() => respond('cdef', { status: 206 }));
    await fetchToFile(h.settings, 'https://x/m.ts', join(dir, 'a.ts'), {
      onBytes: () => undefined,
      range: { offset: 2, length: 4 },
    });
    expect(h.calls[0]?.headers['Range']).toBe('bytes=2-5');
    expect(text(join(dir, 'a.ts'))).toBe('cdef');
  });

  it('cuts the slice itself when the server ignores Range and sends 200', async () => {
    const h = harness(() => respond('0123456789abcdef', { status: 200 }));
    let total = 0;
    await fetchToFile(h.settings, 'https://x/m.ts', join(dir, 'a.ts'), {
      onBytes: (n) => (total += n),
      range: { offset: 6, length: 5 },
    });
    expect(text(join(dir, 'a.ts'))).toBe('6789a');
    expect(total).toBe(5);
  });

  it('fails a range whose bytes never come', async () => {
    const h = harness(() => respond('abc', { status: 206 }));
    h.settings.retries = 0;
    await expect(
      fetchToFile(h.settings, 'https://x/m.ts', join(dir, 'a.ts'), {
        onBytes: () => undefined,
        range: { offset: 0, length: 9 },
      }),
    ).rejects.toMatchObject({ code: 'truncated' });
  });
});

describe('fetchText, fetchHead, probeSize', () => {
  it('reads a playlist and reports the final URL', async () => {
    const h = harness(() => respond('#EXTM3U\n', { url: 'https://cdn2.example/final.m3u8' }));
    expect(await fetchText(h.settings, 'https://x/p.m3u8')).toEqual({
      text: '#EXTM3U\n',
      url: 'https://cdn2.example/final.m3u8',
    });
    const plain = harness(() => respond('x'));
    expect((await fetchText(plain.settings, 'https://x/p.m3u8')).url).toBe('https://x/p.m3u8');
  });

  it('reads only the head of a long body', async () => {
    const h = harness(() => respond(new Uint8Array(100_000).fill(65), { status: 206 }));
    const head = await fetchHead(h.settings, 'https://x/v', 16);
    expect(head.byteLength).toBe(16);
    expect(h.calls[0]?.headers['Range']).toBe('bytes=0-15');
  });

  it('learns the size of a file from Content-Range or Content-Length', async () => {
    const ranged = harness(() => respond('x', { status: 206, headers: { 'content-range': 'bytes 0-0/12345' } }));
    expect(await probeSize(ranged.settings, 'https://x/v.mp4')).toBe(12345);
    const whole = harness(() => respond('xyz', { status: 200 }));
    expect(await probeSize(whole.settings, 'https://x/v.mp4')).toBe(3);
    const unknown = harness(() => respond('x', { status: 200, lengthHeader: null }));
    expect(await probeSize(unknown.settings, 'https://x/v.mp4')).toBeNull();
  });

  it('parses Content-Range', () => {
    expect(parseContentRange('bytes 5-9/20')).toEqual({ start: 5, end: 9, total: 20 });
    expect(parseContentRange('bytes 5-9/*')).toEqual({ start: 5, end: 9, total: null });
    expect(parseContentRange('bytes */20')).toEqual({ total: 20 });
    expect(parseContentRange('nope')).toBeNull();
    expect(parseContentRange(null)).toBeNull();
  });
});

describe('fetchResumable (MP4, DL-4)', () => {
  const file = '0123456789abcdefghij';

  it('downloads a whole file through .part', async () => {
    const h = harness(() => respond(file));
    const total = await fetchResumable(h.settings, 'https://x/v.mp4', join(dir, 'v.mp4'), { onBytes: () => undefined });
    expect(total).toBe(20);
    expect(readdirSync(dir)).toEqual(['v.mp4']);
    expect(h.calls[0]?.headers['Range']).toBeUndefined();
  });

  it('continues a .part with a Range request and appends', async () => {
    writeFileSync(join(dir, 'v.mp4.part'), file.slice(0, 8));
    const h = harness(() => respond(file.slice(8), { status: 206, headers: { 'content-range': 'bytes 8-19/20' } }));
    let delta = 0;
    await fetchResumable(h.settings, 'https://x/v.mp4', join(dir, 'v.mp4'), { onBytes: (n) => (delta += n) });
    expect(h.calls[0]?.headers['Range']).toBe('bytes=8-');
    expect(text(join(dir, 'v.mp4'))).toBe(file);
    expect(delta).toBe(12);
  });

  it('keeps what arrived when the connection breaks and resumes in the retry', async () => {
    const h = harness((call, n) =>
      n === 1
        ? respond(file, { breakAfter: 10 })
        : respond(file.slice(10), { status: 206, headers: { 'content-range': 'bytes 10-19/20' } }),
    );
    let delta = 0;
    await fetchResumable(h.settings, 'https://x/v.mp4', join(dir, 'v.mp4'), { onBytes: (n) => (delta += n) });
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]?.headers['Range']).toBe('bytes=10-');
    expect(text(join(dir, 'v.mp4'))).toBe(file);
    expect(delta).toBe(20);
  });

  it('starts over when the server ignores the range (200)', async () => {
    writeFileSync(join(dir, 'v.mp4.part'), 'stale');
    const h = harness(() => respond(file, { status: 200 }));
    let delta = 0;
    await fetchResumable(h.settings, 'https://x/v.mp4', join(dir, 'v.mp4'), { onBytes: (n) => (delta += n) });
    expect(text(join(dir, 'v.mp4'))).toBe(file);
    expect(delta).toBe(20 - 5);
  });

  it('treats a 416 for a part that is already the whole file as done', async () => {
    writeFileSync(join(dir, 'v.mp4.part'), file);
    const h = harness(() => respond('', { status: 416, headers: { 'content-range': 'bytes */20' } }));
    expect(await fetchResumable(h.settings, 'https://x/v.mp4', join(dir, 'v.mp4'), { onBytes: () => undefined })).toBe(
      20,
    );
    expect(text(join(dir, 'v.mp4'))).toBe(file);
  });

  it('discards a part that does not fit the file, and downloads again', async () => {
    writeFileSync(join(dir, 'v.mp4.part'), `${file}${file}`);
    const h = harness((_c, n) =>
      n === 1 ? respond('', { status: 416, headers: { 'content-range': 'bytes */20' } }) : respond(file),
    );
    await fetchResumable(h.settings, 'https://x/v.mp4', join(dir, 'v.mp4'), { onBytes: () => undefined });
    expect(text(join(dir, 'v.mp4'))).toBe(file);
    expect(existsSync(join(dir, 'v.mp4.part'))).toBe(false);
  });

  it('starts over when the server resumes at a different place', async () => {
    writeFileSync(join(dir, 'v.mp4.part'), file.slice(0, 8));
    const h = harness((_c, n) =>
      n === 1 ? respond(file.slice(5), { status: 206, headers: { 'content-range': 'bytes 5-19/20' } }) : respond(file),
    );
    await fetchResumable(h.settings, 'https://x/v.mp4', join(dir, 'v.mp4'), { onBytes: () => undefined });
    expect(text(join(dir, 'v.mp4'))).toBe(file);
  });

  it('leaves the .part in place when stopped, for the next run', async () => {
    const h = harness(() => respond(file, { breakAfter: 8 }));
    h.settings.retries = 0;
    await expect(
      fetchResumable(h.settings, 'https://x/v.mp4', join(dir, 'v.mp4'), { onBytes: () => undefined }),
    ).rejects.toBeInstanceOf(DownloadFetchError);
    expect(text(join(dir, 'v.mp4.part'))).toBe(file.slice(0, 8));
  });
});
