import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { UpstreamInit } from '../playback/proxy';
import { PART_SUFFIX, fileSize } from './atomic';
import type { ByteRange } from './hls';

// The downloader's network side (docs/PRD.md DL-4, DL-7, R3). It goes through an injected upstream with the
// shape playback uses (`createSessionUpstream`: the extension's session, its media rate limit and the header
// bridge), so tests run on plain `fetch`. What playback lacks is here: a timeout that counts silence, three
// retries with backoff for errors that can pass, a body that is always streamed to disk, and resuming.

/** What the upstream needs to know about who is asking; a playback session fits. */
export interface UpstreamSource {
  extensionId?: string;
}
export type DownloadUpstream = (url: string, init: UpstreamInit, source: UpstreamSource) => Promise<Response>;

export type FetchErrorCode = 'http' | 'network' | 'timeout' | 'truncated' | 'range' | 'redirect';

export class DownloadFetchError extends Error {
  constructor(
    readonly code: FetchErrorCode,
    message: string,
    readonly status: number | null,
    /** Worth another try after a pause (DL-7). */
    readonly recoverable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'DownloadFetchError';
  }

  /** The link probably expired: ask the extension for a new one (STR-4, R5). */
  get expired(): boolean {
    return this.status === 403 || this.status === 410;
  }
}

/** Thrown when the caller's signal aborts (pause, cancel, quit); never retried. */
export class DownloadAborted extends Error {
  constructor() {
    super('Download stopped');
    this.name = 'DownloadAborted';
  }
}

export interface FetchSettings {
  upstream: DownloadUpstream;
  source: UpstreamSource;
  /** The stream's Referer, Origin… The upstream puts them through the header bridge. */
  headers: Record<string, string>;
  signal: AbortSignal;
  /** Silence (no headers, no body bytes) tolerated before a request counts as timed out. */
  timeoutMs?: number;
  /** Retries after the first try. */
  retries?: number;
  backoffMs?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_RETRIES = 3;
export const DEFAULT_BACKOFF_MS = 500;
const MAX_RETRY_AFTER_MS = 30_000;
const MAX_PLAYLIST_BYTES = 8 * 1024 * 1024;

const defaultSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DownloadAborted());
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DownloadAborted());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

/** An abort signal that also fires after `ms` of silence; `touch()` is the sign of life. */
class Watchdog {
  private readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout>;
  timedOut = false;

  constructor(
    private readonly outer: AbortSignal,
    private readonly ms: number,
  ) {
    this.timer = setTimeout(() => this.fire(), ms);
    outer.addEventListener('abort', this.onOuter);
  }

  private readonly onOuter = (): void => this.controller.abort();
  private fire(): void {
    this.timedOut = true;
    this.controller.abort();
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  touch(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fire(), this.ms);
  }

  stop(): void {
    clearTimeout(this.timer);
    this.outer.removeEventListener('abort', this.onOuter);
  }

  /** Turns whatever a cut request threw into the error the retry logic understands. */
  explain(error: unknown): Error {
    if (error instanceof DownloadFetchError || error instanceof DownloadAborted) return error;
    if (this.outer.aborted) return new DownloadAborted();
    if (this.timedOut) return new DownloadFetchError('timeout', 'The server stopped answering', null, true);
    return new DownloadFetchError('network', (error as Error)?.message || 'Network error', null, true);
  }
}

function classifyStatus(response: Response): DownloadFetchError {
  const status = response.status;
  const recoverable = status === 408 || status === 425 || status === 429 || status >= 500;
  const seconds = Number(response.headers.get('retry-after'));
  const retryAfterMs =
    status === 429 && Number.isFinite(seconds) && seconds > 0
      ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
      : undefined;
  return new DownloadFetchError('http', `HTTP ${status}`, status, recoverable, retryAfterMs);
}

async function request(
  settings: FetchSettings,
  url: string,
  extraHeaders: Record<string, string>,
  watchdog: Watchdog,
): Promise<Response> {
  const pending = settings.upstream(
    url,
    { method: 'GET', headers: { ...settings.headers, ...extraHeaders }, signal: watchdog.signal },
    settings.source,
  );
  // An upstream that ignores its signal must not be able to hold a download for ever.
  const stopped = new Promise<never>((_resolve, reject) => {
    const fail = (): void => reject(new Error('aborted'));
    if (watchdog.signal.aborted) fail();
    else watchdog.signal.addEventListener('abort', fail, { once: true });
  });
  let response: Response;
  try {
    response = await Promise.race([pending, stopped]);
  } catch (error) {
    void pending.then(
      (late) => late.body?.cancel(),
      () => undefined,
    );
    throw watchdog.explain(error);
  }
  watchdog.touch();
  // Redirects are followed by the network stack, which refuses other schemes; this guards the final URL.
  if (response.url && !/^https?:/i.test(response.url)) {
    void response.body?.cancel().catch(() => undefined);
    throw new DownloadFetchError('redirect', 'Redirected to a URL that is not http(s)', null, false);
  }
  return response;
}

/** Streams the body in order. A read error becomes a recoverable network or timeout error. */
async function pump(
  response: Response,
  watchdog: Watchdog,
  onChunk: (chunk: Uint8Array) => Promise<boolean | void> | boolean | void,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;
  try {
    for (;;) {
      let read;
      try {
        read = await reader.read();
      } catch (error) {
        throw watchdog.explain(error);
      }
      if (read.done) return;
      watchdog.touch();
      if ((await onChunk(read.value)) === false) return;
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

async function withRetries<T>(settings: FetchSettings, attempt: () => Promise<T>): Promise<T> {
  const retries = settings.retries ?? DEFAULT_RETRIES;
  const backoff = settings.backoffMs ?? DEFAULT_BACKOFF_MS;
  const sleep = settings.sleep ?? defaultSleep;
  for (let tries = 0; ; tries++) {
    if (settings.signal.aborted) throw new DownloadAborted();
    try {
      return await attempt();
    } catch (error) {
      if (!(error instanceof DownloadFetchError) || !error.recoverable || tries >= retries) throw error;
      await sleep(Math.max(backoff * 2 ** tries, error.retryAfterMs ?? 0), settings.signal);
    }
  }
}

/** A playlist, key or other small text. Returns the final URL too, for resolving relative URIs. */
export function fetchText(settings: FetchSettings, url: string): Promise<{ text: string; url: string }> {
  return withRetries(settings, async () => {
    const watchdog = new Watchdog(settings.signal, settings.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const response = await request(settings, url, {}, watchdog);
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        throw classifyStatus(response);
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      await pump(response, watchdog, (chunk) => {
        size += chunk.byteLength;
        if (size > MAX_PLAYLIST_BYTES) throw new DownloadFetchError('http', 'The playlist is too large', null, false);
        chunks.push(chunk);
      });
      return { text: Buffer.concat(chunks).toString('utf8'), url: response.url || url };
    } finally {
      watchdog.stop();
    }
  });
}

/** Up to `max` bytes from the start of a URL, to tell a playlist from a video file. */
export function fetchHead(settings: FetchSettings, url: string, max: number): Promise<Uint8Array> {
  return withRetries(settings, async () => {
    const watchdog = new Watchdog(settings.signal, settings.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const response = await request(settings, url, { Range: `bytes=0-${max - 1}` }, watchdog);
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        throw classifyStatus(response);
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      await pump(response, watchdog, (chunk) => {
        chunks.push(chunk);
        size += chunk.byteLength;
        return size < max;
      });
      return Buffer.concat(chunks).subarray(0, max);
    } finally {
      watchdog.stop();
    }
  });
}

/** `bytes a-b/total` (or `*` + total on a 416) from a Content-Range header. */
export function parseContentRange(
  header: string | null,
): { start: number; end: number; total: number | null } | { total: number } | null {
  if (!header) return null;
  const unsatisfied = /^bytes \*\/(\d+)$/.exec(header);
  if (unsatisfied) return { total: Number(unsatisfied[1]) };
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(header);
  if (!match) return null;
  return { start: Number(match[1]), end: Number(match[2]), total: match[3] === '*' ? null : Number(match[3]) };
}

export interface FileFetch {
  /** Called with the bytes written as they arrive; negative when a failed try is taken back. */
  onBytes: (delta: number) => void;
  /** Only this part of the URL (an HLS byte range). */
  range?: ByteRange | null;
}

/**
 * Saves one URL (a segment, a key, an init segment) as `destination`, through `<destination>.part`. A try
 * that fails leaves no partial file; the retries start over, since a segment is small.
 */
export function fetchToFile(
  settings: FetchSettings,
  url: string,
  destination: string,
  options: FileFetch,
): Promise<number> {
  const part = `${destination}${PART_SUFFIX}`;
  const { range } = options;
  return withRetries(settings, async () => {
    await mkdir(dirname(destination), { recursive: true });
    const watchdog = new Watchdog(settings.signal, settings.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const handle = await open(part, 'w');
    let written = 0;
    try {
      const rangeHeader: Record<string, string> = range
        ? { Range: `bytes=${range.offset}-${range.offset + range.length - 1}` }
        : {};
      const response = await request(settings, url, rangeHeader, watchdog);
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        throw classifyStatus(response);
      }
      // A server that ignores `Range` answers 200 with the whole file: keep the slice that was asked for.
      const whole = range !== undefined && range !== null && response.status === 200;
      let seen = 0;
      await pump(response, watchdog, async (chunk) => {
        let data = chunk;
        if (whole && range) {
          const from = Math.max(range.offset - seen, 0);
          const to = Math.min(range.offset + range.length - seen, chunk.byteLength);
          seen += chunk.byteLength;
          data = from < to ? chunk.subarray(from, to) : new Uint8Array();
        }
        if (data.byteLength > 0) {
          await handle.write(data);
          written += data.byteLength;
          options.onBytes(data.byteLength);
        }
        return !(whole && range && seen >= range.offset + range.length);
      });
      const expected = range
        ? range.length
        : response.headers.get('content-encoding')
          ? null
          : Number(response.headers.get('content-length') ?? Number.NaN);
      if (expected !== null && Number.isFinite(expected) && written !== expected) {
        throw new DownloadFetchError('truncated', `Got ${written} of ${expected} bytes`, null, true);
      }
      await handle.close();
      await rename(part, destination);
      return written;
    } catch (error) {
      options.onBytes(-written);
      await handle.close().catch(() => undefined);
      await rm(part, { force: true });
      throw error;
    } finally {
      watchdog.stop();
    }
  });
}

export interface ResumableFetch {
  onBytes: (delta: number) => void;
}

/**
 * Saves a big file (an MP4) as `<destination>.part`, picking up where a stopped or failed try ended with a
 * `Range` request, then renames it (DL-4). A server that ignores ranges makes it start over; the `.part`
 * stays after a failure so the next run, even after a restart, continues from it.
 */
export function fetchResumable(
  settings: FetchSettings,
  url: string,
  destination: string,
  options: ResumableFetch,
): Promise<number> {
  const part = `${destination}${PART_SUFFIX}`;
  return withRetries(settings, async () => {
    await mkdir(dirname(destination), { recursive: true });
    const have = (await fileSize(part)) ?? 0;
    const watchdog = new Watchdog(settings.signal, settings.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const response = await request(settings, url, have > 0 ? { Range: `bytes=${have}-` } : {}, watchdog);
      if (response.status === 416 && have > 0) {
        void response.body?.cancel().catch(() => undefined);
        const info = parseContentRange(response.headers.get('content-range'));
        if (info && info.total === have) {
          await rename(part, destination);
          return have;
        }
        // The part is longer than the file, or the file changed: the part is no use.
        options.onBytes(-have);
        await rm(part, { force: true });
        throw new DownloadFetchError('range', 'The saved part does not match the file', 416, true);
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        throw classifyStatus(response);
      }

      let append = false;
      if (response.status === 206) {
        const info = parseContentRange(response.headers.get('content-range'));
        if (!info || !('start' in info) || info.start !== have) {
          void response.body?.cancel().catch(() => undefined);
          options.onBytes(-have);
          await rm(part, { force: true });
          throw new DownloadFetchError('range', 'The server answered a different range', null, true);
        }
        append = true;
      } else if (have > 0) {
        options.onBytes(-have);
      }
      const start = append ? have : 0;
      const handle = await open(part, append ? 'a' : 'w');
      let written = 0;
      try {
        await pump(response, watchdog, async (chunk) => {
          await handle.write(chunk);
          written += chunk.byteLength;
          options.onBytes(chunk.byteLength);
        });
      } finally {
        await handle.close().catch(() => undefined);
      }
      const length = Number(response.headers.get('content-length') ?? Number.NaN);
      if (!response.headers.get('content-encoding') && Number.isFinite(length) && written !== length) {
        throw new DownloadFetchError('truncated', `Got ${written} of ${length} bytes`, null, true);
      }
      await rename(part, destination);
      return start + written;
    } finally {
      watchdog.stop();
    }
  });
}

/** Total size of the file behind a URL from a one-byte range request; null when the server does not say. */
export async function probeSize(settings: FetchSettings, url: string): Promise<number | null> {
  return withRetries(settings, async () => {
    const watchdog = new Watchdog(settings.signal, settings.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const response = await request(settings, url, { Range: 'bytes=0-0' }, watchdog);
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        throw classifyStatus(response);
      }
      void response.body?.cancel().catch(() => undefined);
      const info = parseContentRange(response.headers.get('content-range'));
      if (info && info.total !== null) return info.total;
      const length = Number(response.headers.get('content-length'));
      return response.status === 200 && length > 0 ? length : null;
    } finally {
      watchdog.stop();
    }
  });
}
