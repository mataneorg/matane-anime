// The network layer's decisions, as pure functions so they can be tested without Electron.

/** Attempts after the first (docs/PRD.md NET-3). */
export const MAX_RETRIES = 2;
/** A `Retry-After` longer than this is not waited out; the call fails instead. */
export const MAX_RETRY_WAIT_MS = 30_000;
export const DEFAULT_TIMEOUT_MS = 20_000;
export const MAX_TIMEOUT_MS = 60_000;
/** The largest body read into memory for an extension (pages and JSON, not media). */
export const MAX_BODY_BYTES = 20 * 1024 * 1024;
export const MAX_REDIRECTS = 10;

export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599 && status !== 501);
}

/**
 * How long to wait before attempt `attempt + 1` (0-based), or null to give up. Honors `Retry-After`
 * (seconds or an HTTP date); otherwise backs off 500 ms, 1 s, 2 s…
 */
export function retryDelayMs(attempt: number, retryAfter: string | undefined, now = Date.now()): number | null {
  if (attempt >= MAX_RETRIES) return null;
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const wait = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - now;
    if (Number.isFinite(wait)) return wait > MAX_RETRY_WAIT_MS ? null : Math.max(0, wait);
  }
  return 500 * 2 ** attempt;
}

/** Cloudflare says so in `cf-mitigated`, or serves its interstitial with a 403/503. */
export function looksLikeChallenge(status: number, headers: Record<string, string>, bodyHead: string): boolean {
  if (headers['cf-mitigated']?.toLowerCase() === 'challenge') return true;
  if (status !== 403 && status !== 503) return false;
  const fromCloudflare = /cloudflare/i.test(headers['server'] ?? '') || 'cf-ray' in headers;
  return fromCloudflare && /just a moment|cf-chl|challenge-platform|attention required/i.test(bodyHead);
}

/** Header values arrive as strings or lists; extensions get one lower-case string each. */
export function joinHeaders(raw: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    out[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

/** Decodes with the charset the response names (default UTF-8); an unknown charset falls back to UTF-8. */
export function decodeBody(body: Uint8Array, contentType: string | undefined): string {
  const charset = /charset\s*=\s*"?([\w-]+)"?/i.exec(contentType ?? '')?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

/**
 * Electron's UA names the app and Electron, which some sites block. Matane Anime sends the plain Chrome
 * one (docs/PRD.md NET-4).
 */
export function sanitizeUserAgent(userAgent: string, appToken: string | undefined): string {
  let cleaned = userAgent.replace(/\s+Electron\/\S+/i, '');
  if (appToken)
    cleaned = cleaned.replace(new RegExp(`\\s+${appToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`), '');
  return cleaned;
}

/** The headers Chromium refuses to let main set directly; they travel under marker names (docs/adr/0008). */
const BRIDGED = new Set(['referer', 'origin']);
export const isBridgedHeader = (name: string): boolean => BRIDGED.has(name.toLowerCase());
