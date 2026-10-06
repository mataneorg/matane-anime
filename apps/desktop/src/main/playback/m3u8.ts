// HLS manifest rewriting for the `anime://` proxy (docs/PRD.md §8.3). Every URI in a playlist is turned
// into a URL on our own scheme, so hls.js only ever talks to `anime://` while main talks to the site
// (with the headers the stream needs).

export interface RewriteResult {
  text: string;
  /** `host:port` of every http(s) URI that was found, so the session may fetch from exactly those. */
  hosts: string[];
}

const URI_ATTRIBUTE = /URI="([^"]*)"/g;

/** Resolves a playlist URI against the playlist's own URL. Returns null for URIs that are not http(s). */
export function resolveUri(uri: string, baseUrl: string): string | null {
  const trimmed = uri.trim();
  if (trimmed === '') return null;
  let resolved: URL;
  try {
    resolved = new URL(trimmed, baseUrl);
  } catch {
    return null;
  }
  return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.href : null;
}

export function hostOf(url: string): string {
  return new URL(url).host;
}

export function encodeResource(absoluteUrl: string): string {
  return Buffer.from(absoluteUrl, 'utf8').toString('base64url');
}

export function decodeResource(encoded: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
  // Re-encoding must give the input back, otherwise it was not valid base64url to begin with.
  return Buffer.from(decoded, 'utf8').toString('base64url') === encoded ? decoded : null;
}

/** Whether a response is an HLS playlist, judged by its URL and Content-Type (not by reading the body). */
export function looksLikePlaylist(url: string, contentType: string | null): boolean {
  if (contentType && /mpegurl/i.test(contentType)) return true;
  try {
    return /\.m3u8?$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/**
 * Rewrites a playlist. `wrap` maps an absolute upstream URL to the URL hls.js must request.
 * Handles segment and variant lines, and `URI="…"` attributes of EXT-X-KEY, EXT-X-MAP, EXT-X-MEDIA,
 * EXT-X-I-FRAME-STREAM-INF, EXT-X-SESSION-KEY and similar tags. URIs that are not http(s) (for
 * example `data:` or `skd:`) are left untouched. Line endings are kept.
 */
export function rewriteManifest(text: string, baseUrl: string, wrap: (absoluteUrl: string) => string): RewriteResult {
  const hosts = new Set<string>();
  const map = (uri: string): string | null => {
    const absolute = resolveUri(uri, baseUrl);
    if (!absolute) return null;
    hosts.add(hostOf(absolute));
    return wrap(absolute);
  };

  const lines = text.split(/(\r?\n)/);
  for (let i = 0; i < lines.length; i += 2) {
    const line = lines[i] ?? '';
    if (line.trim() === '') continue;
    if (line.startsWith('#')) {
      lines[i] = line.replace(URI_ATTRIBUTE, (whole, uri: string) => {
        const mapped = map(uri);
        return mapped === null ? whole : `URI="${mapped}"`;
      });
    } else {
      lines[i] = map(line) ?? line;
    }
  }
  return { text: lines.join(''), hosts: [...hosts] };
}
