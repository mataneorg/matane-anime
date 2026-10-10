import type { Stream } from '@matane-anime/extension-sdk';
import type { PlaybackSession } from './sessions';
import type { UpstreamFetch } from './proxy';
import { parseVariantCodecs } from './codecs';
import { guessKind } from './ranking';

/** `variants` are the `CODECS` of each variant of an HLS master playlist (empty when it has none). */
export type ProbeResult =
  { ok: true; kind: 'hls' | 'mp4'; variants?: string[][] } | { ok: false; reason: string; httpStatus: number | null };

export const PROBE_TIMEOUT_MS = 8000;
const HEAD_BYTES = 4096;
/** How much of a playlist is read to find the `CODECS` of its variants; a master playlist is a few KB. */
const PLAYLIST_BYTES = 16 * 1024;

/** Reads at most `max` bytes of a body and drops the rest: a server that ignores `Range` must not cost a whole file. */
export async function readHead(response: Response, max: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < max) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(Math.min(size, max));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, Math.min(chunk.byteLength, out.byteLength - offset));
    out.set(part, offset);
    offset += part.byteLength;
    if (offset >= out.byteLength) break;
  }
  return out;
}

const looksLikePlaylist = (head: Uint8Array): boolean =>
  new TextDecoder().decode(head.subarray(0, 64)).trimStart().startsWith('#EXTM3U');

const playlistResult = (head: Uint8Array): ProbeResult => ({
  ok: true,
  kind: 'hls',
  variants: parseVariantCodecs(new TextDecoder().decode(head)),
});

/**
 * Checks that a stream answers before the player is pointed at it (docs/PRD.md STR-2): a playlist must be
 * a playlist, a file must answer a one-byte range. It goes through the same upstream the player will use,
 * so what the probe sees is what playback will get. A failed probe is silent: the next candidate is tried.
 * `signal` stops a probe whose answer is no longer wanted (another stream already won); it reports `cancelled`.
 */
export async function probeStream(
  stream: Stream,
  upstream: UpstreamFetch,
  session: PlaybackSession,
  timeoutMs = PROBE_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  const guessed = guessKind(stream);
  const headers: Record<string, string> = { ...stream.headers };
  if (guessed === 'mp4') headers['Range'] = 'bytes=0-1';
  if (guessed === 'auto') headers['Range'] = `bytes=0-${HEAD_BYTES - 1}`;

  let response: Response;
  try {
    const limit = AbortSignal.timeout(timeoutMs);
    response = await upstream(
      stream.url,
      { method: 'GET', headers, signal: signal ? AbortSignal.any([limit, signal]) : limit },
      session,
    );
  } catch (error) {
    if (signal?.aborted) return { ok: false, reason: 'cancelled', httpStatus: null };
    const timedOut = (error as Error).name === 'TimeoutError' || (error as Error).name === 'AbortError';
    return { ok: false, reason: timedOut ? 'timed out' : (error as Error).message || 'unreachable', httpStatus: null };
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    return { ok: false, reason: `HTTP ${response.status}`, httpStatus: response.status };
  }
  try {
    const head = await readHead(response, guessed === 'hls' ? PLAYLIST_BYTES : HEAD_BYTES);
    if (guessed === 'hls') {
      return looksLikePlaylist(head) ? playlistResult(head) : { ok: false, reason: 'not a playlist', httpStatus: null };
    }
    if (looksLikePlaylist(head)) return playlistResult(head);
    if (guessed === 'mp4')
      return head.byteLength > 0 ? { ok: true, kind: 'mp4' } : { ok: false, reason: 'empty answer', httpStatus: null };
    const type = response.headers.get('content-type') ?? '';
    return /^(video|audio)\//.test(type) || type === 'application/octet-stream'
      ? { ok: true, kind: 'mp4' }
      : { ok: false, reason: `unrecognized (${type || 'no content type'})`, httpStatus: null };
  } catch (error) {
    if (signal?.aborted) return { ok: false, reason: 'cancelled', httpStatus: null };
    return { ok: false, reason: (error as Error).message || 'the answer was cut off', httpStatus: null };
  }
}
