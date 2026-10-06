// Typed errors an extension can throw (docs/PRD.md EXT-12). They cross the sandbox boundary by `name`,
// `message` and (for HttpError) `status`, so the host and the UI can tell them apart and show the right text.

export const EXTENSION_ERROR_NAMES = [
  'NetworkError',
  'HttpError',
  'CloudflareError',
  'RateLimitedError',
  'NotFoundError',
  'ParseError',
] as const;
export type ExtensionErrorName = (typeof EXTENSION_ERROR_NAMES)[number];

/** The site could not be reached (DNS, connection reset, timeout). */
export class NetworkError extends Error {
  override name = 'NetworkError';
}

/** The site answered with an error status. */
export class HttpError extends Error {
  override name = 'HttpError';
  constructor(
    readonly status: number,
    message?: string,
  ) {
    super(message ?? `HTTP ${status}`);
  }
}

/** The site is behind a Cloudflare challenge the host could not pass. */
export class CloudflareError extends Error {
  override name = 'CloudflareError';
}

/** The site asked the client to slow down (429), or the host's own rate limit gave up waiting. */
export class RateLimitedError extends Error {
  override name = 'RateLimitedError';
}

/** The anime, episode or stream does not exist (any more). */
export class NotFoundError extends Error {
  override name = 'NotFoundError';
}

/** The page did not look the way the extension expected (the site probably changed). */
export class ParseError extends Error {
  override name = 'ParseError';
}

export function isExtensionErrorName(name: unknown): name is ExtensionErrorName {
  return typeof name === 'string' && (EXTENSION_ERROR_NAMES as readonly string[]).includes(name);
}
