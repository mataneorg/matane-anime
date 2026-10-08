// What the repository code needs from the network. The real implementation is `network/repo-fetcher.ts`;
// tests use an in-memory one, so nothing here may import Electron.

export interface RepoHttp {
  /**
   * GETs a URL (http/https on every redirect hop). Resolves for 2xx only; other statuses throw
   * `http_<status>`. `maxBytes` is a hard cap on the body: a response over it fails with `too_large`.
   */
  get(
    url: string,
    options: { maxBytes: number; signal?: AbortSignal },
  ): Promise<{ status: number; url: string; bytes: Uint8Array }>;
}

export type RepoHttpErrorCode = 'offline' | 'network' | 'too_large' | 'aborted' | `http_${number}`;

export class RepoHttpError extends Error {
  override readonly name = 'RepoHttpError';

  constructor(
    readonly code: RepoHttpErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function isRepoHttpError(error: unknown): error is RepoHttpError {
  return error instanceof RepoHttpError;
}

export function httpStatusOf(error: unknown): number | null {
  if (!isRepoHttpError(error)) return null;
  const match = /^http_(\d+)$/.exec(error.code);
  return match ? Number(match[1]) : null;
}
