import '@matane-anime/extension-sdk/globals';
import {
  CloudflareError,
  type HttpResponse,
  HttpError,
  NotFoundError,
  ParseError,
  RateLimitedError,
} from '@matane-anime/extension-sdk';

/** The catalogue backend (GraphQL, and the REST list of recent releases). */
export const DEFAULT_CATALOG_URL = 'https://graphql.animex.one';
/** The streams backend (episodes, servers, sources). */
export const DEFAULT_STREAMS_URL = 'https://pp.animex.one';
/** Only used to open pages in the browser; the data comes from the backends. */
export const WEB_URL = 'https://animex.one';

function address(key: string, fallback: string): string {
  const value = (prefs.get<string>(key) ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^/\s]+$/i.test(value) ? value : fallback;
}

export const catalogUrl = (): string => address('catalogUrl', DEFAULT_CATALOG_URL);
export const streamsUrl = (): string => address('streamsUrl', DEFAULT_STREAMS_URL);

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
    throw new ParseError('The backend did not answer JSON: the site changed');
  }
}

/** GETs `base + path` with the query and parses the JSON. */
export async function getJson<T>(
  base: string,
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const qs = query.toString();
  const url = `${base}${path}${qs ? `?${qs}` : ''}`;
  return parse<T>(await http.get(url, { throwOnError: false }), url);
}

interface GraphQlAnswer<T> {
  data?: T | null;
  errors?: { message?: string }[];
}

/** One GraphQL query. An `errors` answer is a changed schema, not a crash. */
export async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const url = `${catalogUrl()}/graphql`;
  const response = await http.post(url, JSON.stringify({ query, variables }), {
    headers: { 'content-type': 'application/json' },
    throwOnError: false,
  });
  const answer = parse<GraphQlAnswer<T>>(response, url);
  if (!answer.data) {
    throw new ParseError(`The catalogue answered an error: ${answer.errors?.[0]?.message ?? 'no data'}`);
  }
  return answer.data;
}
