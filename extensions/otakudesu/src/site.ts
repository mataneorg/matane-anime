import '@matane-anime/extension-sdk/globals';
import {
  CloudflareError,
  type HttpResponse,
  HttpError,
  NotFoundError,
  RateLimitedError,
} from '@matane-anime/extension-sdk';

export const DEFAULT_BASE_URL = 'https://otakudesu.blog';

/** The site address from the preferences, without a trailing slash; anything that is not http(s) falls back. */
export function base(): string {
  const value = (prefs.get<string>('baseUrl') ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^/\s]+$/i.test(value) ? value : DEFAULT_BASE_URL;
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};

export interface Page {
  response: HttpResponse;
  /**
   * The site answers a page that does not exist with a redirect to another domain (otakudesu.io), never a
   * 404. The host follows redirects, so that shows as another final host; a 3xx that was not followed counts too.
   */
  moved: boolean;
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
  if (response.status === 429) throw new RateLimitedError(`Rate limited by ${hostOf(url)}`);
  throw new HttpError(response.status, `HTTP ${response.status} for ${url}`);
}

export async function fetchPage(url: string): Promise<Page> {
  const response = await http.get(url, { throwOnError: false });
  const redirected = response.status >= 300 && response.status < 400;
  const otherHost = response.url !== '' && hostOf(response.url) !== hostOf(url);
  if (!redirected && !otherHost) assertOk(response, url);
  return { response, moved: redirected || otherHost };
}
