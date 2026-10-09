import '@matane-anime/extension-sdk/globals';
import {
  CloudflareError,
  type HttpResponse,
  HttpError,
  NotFoundError,
  ParseError,
  RateLimitedError,
} from '@matane-anime/extension-sdk';

export const DEFAULT_API_URL = 'https://backapi.oploverz.ac/api';
/** Only used to open pages in the browser; the data comes from the API. */
export const WEB_URL = 'https://oploverz.site';

/** The API address from the preferences, without a trailing slash; anything that is not http(s) falls back. */
export function base(): string {
  const value = (prefs.get<string>('apiUrl') ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^/\s]+(?:\/[^\s]*)?$/i.test(value) ? value : DEFAULT_API_URL;
}

export function assertOk(response: HttpResponse, url: string): void {
  if (response.status < 400) return;
  const challenge =
    response.headers['cf-mitigated'] === 'challenge' ||
    ((response.status === 403 || response.status === 503) &&
      /Just a moment|cf-browser-verification/i.test(response.text));
  if (challenge) throw new CloudflareError('The site is behind a Cloudflare challenge');
  if (response.status === 404) throw new NotFoundError(`Not found: ${url}`);
  if (response.status === 429) throw new RateLimitedError('Rate limited by the Oploverz API');
  throw new HttpError(response.status, `HTTP ${response.status} for ${url}`);
}

export interface Paged<T> {
  meta: { currentPage: number; lastPage: number; total?: number };
  data: T[];
}

/** GETs `path` (starting with "/") and parses the JSON; a body that is not JSON is a layout change, not a crash. */
export async function getJson<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const qs = query.toString();
  const url = `${base()}${path}${qs ? `?${qs}` : ''}`;
  const response = await http.get(url, { throwOnError: false });
  assertOk(response, url);
  try {
    return response.json<T>();
  } catch {
    throw new ParseError('The API did not answer JSON: the site changed');
  }
}

export async function getPage<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<Paged<T>> {
  const page = await getJson<Partial<Paged<T>>>(path, params);
  if (!Array.isArray(page.data)) throw new ParseError('The API list has no "data": the site changed');
  return {
    data: page.data,
    meta: { currentPage: page.meta?.currentPage ?? 1, lastPage: page.meta?.lastPage ?? 1, total: page.meta?.total },
  };
}
