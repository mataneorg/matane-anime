import '@matane-anime/extension-sdk/globals';
import {
  CloudflareError,
  type HttpResponse,
  HttpError,
  NotFoundError,
  ParseError,
  RateLimitedError,
} from '@matane-anime/extension-sdk';

/** The site; its JSON API lives under `/api`. */
export const DEFAULT_BASE_URL = 'https://kaa.lt';

/** The site address from the preferences, without a trailing slash; anything that is not http(s) falls back. */
export function base(): string {
  const value = (prefs.get<string>('baseUrl') ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^/\s]+$/i.test(value) ? value : DEFAULT_BASE_URL;
}

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

function parse<T>(response: HttpResponse, url: string): T {
  assertOk(response, url);
  try {
    return response.json<T>();
  } catch {
    throw new ParseError('The API did not answer JSON: the site changed');
  }
}

/** GETs `/api<path>` and parses the JSON; a body that is not JSON is a layout change, not a crash. */
export async function getJson<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const qs = query.toString();
  const url = `${base()}/api${path}${qs ? `?${qs}` : ''}`;
  return parse<T>(await http.get(url, { throwOnError: false }), url);
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const url = `${base()}/api${path}`;
  const response = await http.post(url, JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    throwOnError: false,
  });
  return parse<T>(response, url);
}
