import { decodeResource, encodeResource, hostOf, looksLikePlaylist, rewriteManifest } from './m3u8';
import type { PlaybackSession, SessionStore } from './sessions';

export const ANIME_SCHEME = 'anime';

export interface UpstreamInit {
  method: 'GET' | 'HEAD';
  headers: Record<string, string>;
  signal?: AbortSignal;
}
/**
 * Fetches `url` with exactly these headers. Redirects are followed; `Response.url` is the final URL. The
 * session says whose cookies, network session and rate limit apply (docs/adr/0008).
 */
export type UpstreamFetch = (url: string, init: UpstreamInit, session: PlaybackSession) => Promise<Response>;

export interface ProxyLogEntry {
  sessionId: string;
  target: string;
  status: number;
  range: string | null;
  /** Set when the site could not be reached at all (status 502). */
  error?: string;
}

export interface AnimeHandlerDeps {
  sessions: SessionStore;
  fetchUpstream: UpstreamFetch;
  onRequest?: (entry: ProxyLogEntry) => void;
}

/** What the renderer can read on a failed response (the CORS-exposed `x-error-code` header). */
export type ErrorCode =
  'bad_request' | 'session_not_found' | 'host_not_allowed' | 'method_not_allowed' | 'network' | `http_${number}`;

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'x-error-code, content-range, content-length, accept-ranges',
};

/** Headers worth passing from the site to the player; the rest (cookies, CORS, cache) stay behind. */
const PASSED_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];

/** The URL hls.js (or `<video>`) must request for a resource of a session. */
export function resourceUrl(sessionId: string, absoluteUpstreamUrl: string): string {
  return `${ANIME_SCHEME}://play/${sessionId}/r/${encodeResource(absoluteUpstreamUrl)}`;
}

function failure(status: number, code: ErrorCode): Response {
  return new Response(null, {
    status,
    headers: { ...CORS_HEADERS, 'x-error-code': code, 'cache-control': 'no-store' },
  });
}

function parseRequestUrl(raw: string): { sessionId: string; rest: string[] } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== `${ANIME_SCHEME}:` || url.host !== 'play') return null;
  const [sessionId, ...rest] = url.pathname.split('/').filter(Boolean);
  return sessionId ? { sessionId, rest } : null;
}

function resolveTarget(session: PlaybackSession, rest: string[]): string | Response {
  if (rest[0] !== 'r') return session.entryUrl;
  const target = rest[1] ? decodeResource(rest[1]) : null;
  if (!target) return failure(400, 'bad_request');
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return failure(400, 'bad_request');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return failure(400, 'bad_request');
  return session.hostsSeen.has(url.host) ? url.href : failure(403, 'host_not_allowed');
}

/** The handler behind `protocol.handle('anime', …)`. Pure of Electron so it can be tested in Node. */
export function createAnimeHandler(deps: AnimeHandlerDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...CORS_HEADERS,
          'access-control-allow-methods': 'GET, HEAD',
          'access-control-allow-headers': 'range',
        },
      });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return failure(405, 'method_not_allowed');

    const parsed = parseRequestUrl(request.url);
    if (!parsed) return failure(400, 'bad_request');
    const session = deps.sessions.get(parsed.sessionId);
    if (!session) return failure(404, 'session_not_found');

    const target = resolveTarget(session, parsed.rest);
    if (target instanceof Response) return target;

    const range = request.headers.get('range');
    const headers: Record<string, string> = { ...session.headers };
    if (range) headers['Range'] = range;

    let upstream: Response;
    try {
      upstream = await deps.fetchUpstream(target, { method: request.method, headers }, session);
    } catch (error) {
      deps.onRequest?.({ sessionId: session.id, target, status: 502, range, error: String(error) });
      return failure(502, 'network');
    }
    deps.onRequest?.({ sessionId: session.id, target, status: upstream.status, range });

    // 206 is a success for ranged requests; everything else outside 2xx is the site refusing us.
    if (!upstream.ok) {
      void upstream.body?.cancel();
      return failure(upstream.status, `http_${upstream.status}`);
    }

    const contentType = upstream.headers.get('content-type');
    const finalUrl = upstream.url || target;
    if (session.kind === 'hls' && looksLikePlaylist(finalUrl, contentType)) {
      const text = await upstream.text();
      const rewritten = rewriteManifest(text, finalUrl, (absolute) => resourceUrl(session.id, absolute));
      for (const host of rewritten.hosts) session.hostsSeen.add(host);
      // Redirects to another host are followed, so that host is trusted for this playlist's siblings too.
      session.hostsSeen.add(hostOf(finalUrl));
      return new Response(request.method === 'HEAD' ? null : rewritten.text, {
        status: 200,
        headers: { ...CORS_HEADERS, 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store' },
      });
    }

    const out = new Headers(CORS_HEADERS);
    for (const name of PASSED_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) out.set(name, value);
    }
    const bodyless = request.method === 'HEAD' || upstream.status === 204 || upstream.status === 304;
    return new Response(bodyless ? null : upstream.body, { status: upstream.status, headers: out });
  };
}
