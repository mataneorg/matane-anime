import { type Session, net } from 'electron';
import { type RepoHttp, RepoHttpError } from '../extensions/repo-http';
import { MAX_REDIRECTS } from './policy';

export const REPO_TIMEOUT_MS = 20_000;
export const REPO_PARTITION = 'persist:repos';

export interface RepoFetcherOptions {
  session: Session;
  userAgent: () => string;
  isOnline: () => boolean;
  timeoutMs?: number;
}

/**
 * Fetches repository files (index, signature, archives, icons). It is not an extension's fetcher: its own
 * session, no cookies, no rate limit, no Cloudflare solving, and every response has a byte cap.
 */
export class RepoFetcher implements RepoHttp {
  constructor(private readonly options: RepoFetcherOptions) {}

  get(
    url: string,
    { maxBytes, signal }: { maxBytes: number; signal?: AbortSignal },
  ): Promise<{ status: number; url: string; bytes: Uint8Array }> {
    const { session, userAgent, isOnline, timeoutMs = REPO_TIMEOUT_MS } = this.options;
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new RepoHttpError('aborted', 'The request was cancelled'));
      if (!isOnline()) return reject(new RepoHttpError('offline', 'You are offline'));
      let target: URL;
      try {
        target = new URL(url);
      } catch {
        return reject(new RepoHttpError('network', 'The repository address is not a valid URL'));
      }
      if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        return reject(new RepoHttpError('network', 'Repository addresses must use http or https'));
      }

      const client = net.request({
        method: 'GET',
        url: target.href,
        session,
        useSessionCookies: false,
        redirect: 'manual',
      });
      client.setHeader('user-agent', userAgent());
      let settled = false;
      let hops = 0;
      let currentUrl = target.href;
      const finish = (action: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        action();
      };
      const fail = (error: RepoHttpError): void =>
        finish(() => {
          client.abort();
          reject(offlineAware(error));
        });
      const offlineAware = (error: RepoHttpError): RepoHttpError =>
        error.code === 'network' && !isOnline() ? new RepoHttpError('offline', 'You are offline') : error;
      const onAbort = (): void => fail(new RepoHttpError('aborted', 'The request was cancelled'));
      const timer = setTimeout(
        () =>
          fail(new RepoHttpError('network', `${new URL(currentUrl).host} did not answer within ${timeoutMs / 1000} s`)),
        timeoutMs,
      );
      signal?.addEventListener('abort', onAbort, { once: true });

      client.on('redirect', (_status, _method, redirectUrl) => {
        let next: URL;
        try {
          next = new URL(redirectUrl);
        } catch {
          return fail(new RepoHttpError('network', 'The server redirected to an invalid address'));
        }
        if (next.protocol !== 'http:' && next.protocol !== 'https:') {
          return fail(new RepoHttpError('network', `Refusing a redirect to ${next.protocol}`));
        }
        if (++hops > MAX_REDIRECTS) return fail(new RepoHttpError('network', 'Too many redirects'));
        currentUrl = next.href;
        client.followRedirect();
      });
      client.on('response', (response) => {
        const status = response.statusCode;
        if (status < 200 || status >= 300)
          return fail(new RepoHttpError(`http_${status}`, `The server answered ${status}`));
        const declared = Number(firstHeader(response.headers['content-length']));
        if (Number.isFinite(declared) && declared > maxBytes) {
          return fail(new RepoHttpError('too_large', 'The file is larger than allowed'));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) return fail(new RepoHttpError('too_large', 'The file is larger than allowed'));
          chunks.push(chunk);
        });
        response.on('end', () => finish(() => resolve({ status, url: currentUrl, bytes: Buffer.concat(chunks) })));
        response.on('error', (error: Error) => fail(new RepoHttpError('network', error.message)));
      });
      client.on('error', (error) => fail(new RepoHttpError('network', error.message.replace(/^net::/, ''))));
      client.on('abort', () => fail(new RepoHttpError('aborted', 'The request was aborted')));
      client.end();
    });
  }
}

function firstHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}
