import { type FileHandle, open, realpath } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';
import { Readable } from 'node:stream';
import { CORS_HEADERS, type ErrorCode, failure } from './responses';
import type { PlaybackSession } from './sessions';

// Serves a finished download to the player (docs/PRD.md STR-7, docs/adr/0022). The session is rooted at one
// path: the download's folder (HLS) or its `.mp4`. The renderer names a file by relative path only, and
// whatever it asks for must resolve, symlinks included, to a regular file inside that root.

const CONTENT_TYPES: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.m4s': 'video/iso.segment',
  '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.vtt': 'text/vtt',
  '.key': 'application/octet-stream',
};

export const contentTypeOf = (file: string): string =>
  CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';

export interface LocalServed {
  response: Response;
  /** The file that answered (or was refused), for the request log. */
  target: string;
}

type Span = { start: number; end: number } | 'unsatisfiable' | null;

/**
 * One byte range of a `Range` header. `null` means "serve it all": no header, a syntax we do not read, or several
 * ranges (a server may ignore a Range it does not like; browsers ask for one at a time).
 */
export function parseRange(header: string | null, size: number): Span {
  const match = header ? /^bytes=(\d*)-(\d*)$/i.exec(header.trim()) : null;
  if (!match) return null;
  const [, from = '', to = ''] = match;
  if (from === '' && to === '') return null;
  if (from === '') {
    // Suffix: the last N bytes.
    const length = Number(to);
    if (length === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - length), end: size - 1 };
  }
  const start = Number(from);
  if (start >= size) return 'unsatisfiable';
  const end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
  return end < start ? 'unsatisfiable' : { start, end };
}

/** Relative path segments of a request, or null when any is not a plain file name. */
function safeSegments(rest: string[]): string[] | null {
  const segments: string[] = [];
  for (const raw of rest) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (segment === '' || segment === '.' || segment === '..' || /[/\\\0]/.test(segment)) return null;
    segments.push(segment);
  }
  return segments;
}

const refuse = (status: number, code: ErrorCode, target: string): LocalServed => ({
  response: failure(status, code),
  target,
});

/** Resolves a request to a real file inside the session's root, or the response that refuses it. */
async function locate(session: PlaybackSession, rest: string[]): Promise<{ file: string } | LocalServed> {
  const local = session.local;
  if (!local) return refuse(404, 'session_not_found', '');
  // An MP4 session is the file itself, whatever name the player asks for.
  if (local.media === 'mp4') return { file: local.path };

  const segments = safeSegments(rest);
  if (!segments) return refuse(403, 'path_not_allowed', local.path);
  const wanted = join(local.path, ...(segments.length > 0 ? segments : ['playlist.m3u8']));
  try {
    const [root, file] = await Promise.all([realpath(local.path), realpath(wanted)]);
    return file.startsWith(root + sep) ? { file } : refuse(403, 'path_not_allowed', wanted);
  } catch {
    return refuse(404, 'file_missing', wanted);
  }
}

export async function serveLocal(session: PlaybackSession, rest: string[], request: Request): Promise<LocalServed> {
  const found = await locate(session, rest);
  if ('response' in found) return found;
  const { file } = found;

  let handle: FileHandle | null = null;
  try {
    handle = await open(file, 'r');
    const stats = await handle.stat();
    if (!stats.isFile()) {
      await handle.close();
      return refuse(404, 'file_missing', file);
    }
    const size = stats.size;
    const span = parseRange(request.headers.get('range'), size);
    const headers: Record<string, string> = {
      ...CORS_HEADERS,
      'content-type': contentTypeOf(file),
      'accept-ranges': 'bytes',
      'last-modified': stats.mtime.toUTCString(),
      'cache-control': 'no-store',
    };
    if (span === 'unsatisfiable') {
      await handle.close();
      return {
        response: new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } }),
        target: file,
      };
    }
    const start = span?.start ?? 0;
    const end = span?.end ?? size - 1;
    const length = size === 0 ? 0 : end - start + 1;
    headers['content-length'] = String(length);
    if (span) headers['content-range'] = `bytes ${start}-${end}/${size}`;
    const status = span ? 206 : 200;

    if (request.method === 'HEAD' || length === 0) {
      await handle.close();
      return { response: new Response(null, { status, headers }), target: file };
    }
    // The stream closes the handle when it ends, errors or is cancelled (the player seeking away).
    const stream = handle.createReadStream({ start, end, autoClose: true });
    handle = null;
    return {
      response: new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers }),
      target: file,
    };
  } catch {
    await handle?.close().catch(() => undefined);
    return refuse(404, 'file_missing', file);
  }
}
