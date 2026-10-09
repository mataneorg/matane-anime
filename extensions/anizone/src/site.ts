import '@matane-anime/extension-sdk/globals';
import {
  CloudflareError,
  type HttpResponse,
  HttpError,
  NotFoundError,
  RateLimitedError,
} from '@matane-anime/extension-sdk';

/** The site's address. Domains change, hence the Site address preference. */
export const DEFAULT_BASE_URL = 'https://anizone.to';

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
