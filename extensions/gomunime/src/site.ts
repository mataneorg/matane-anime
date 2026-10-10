import '@matane-anime/extension-sdk/globals';
import {
  CloudflareError,
  type HttpResponse,
  HttpError,
  NotFoundError,
  RateLimitedError,
} from '@matane-anime/extension-sdk';

/** The site address (the sister site anime-indo.lol shares its players, not its pages). */
export const DEFAULT_BASE_URL = 'https://gomunime.top';

/** The site address from the preferences, without a trailing slash; anything that is not http(s) falls back. */
export function base(): string {
  const value = (prefs.get<string>('baseUrl') ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^/\s]+$/i.test(value) ? value : DEFAULT_BASE_URL;
}

/** Throws the typed error for a failed response; a Cloudflare challenge is told apart from a plain 403/503. */
export function assertOk(response: HttpResponse, url: string): void {
  if (response.status < 400) return;
  const challenge =
    response.headers['cf-mitigated'] === 'challenge' ||
    ((response.status === 403 || response.status === 503) &&
      /Just a moment|cf-browser-verification/i.test(response.text));
  if (challenge) throw new CloudflareError('The site is behind a Cloudflare challenge');
  if (response.status === 404) throw new NotFoundError(`Not found: ${url}`);
  if (response.status === 429) throw new RateLimitedError('Rate limited by the site');
  throw new HttpError(response.status, `HTTP ${response.status} for ${url}`);
}

export async function fetchPage(url: string): Promise<HttpResponse> {
  const response = await http.get(url, { throwOnError: false });
  assertOk(response, url);
  return response;
}

/** Two calls for the same page that start together (details and episodes of an anime) share one request. */
const SHARE_MS = 5_000;
const SHARE_MAX = 8;
const shared = new Map<string, { at: number; result: Promise<unknown> }>();

/**
 * Runs `load(url)` once for every caller that asks for `url` within a few seconds; a failure is never kept.
 * The result must be plain data: the page is parsed again by each caller, because parsed nodes live for one call.
 */
export function sharedFetch<T>(url: string, load: (url: string) => Promise<T>): Promise<T> {
  const now = Date.now();
  for (const [key, entry] of shared) if (now - entry.at > SHARE_MS) shared.delete(key);
  const known = shared.get(url);
  if (known) return known.result as Promise<T>;
  if (shared.size >= SHARE_MAX) shared.delete(shared.keys().next().value as string);
  const result = load(url);
  shared.set(url, { at: now, result });
  result.catch(() => {
    if (shared.get(url)?.result === result) shared.delete(url);
  });
  return result;
}
