import type { HttpRequest, HttpResult } from '@matane-anime/extension-sdk';
import { HostError } from '@matane-anime/extension-runtime/client';
import { type Session, net } from 'electron';
import type { CloudflareSolver } from './cloudflare';
import { installHeaderBridge, withMarkers } from './header-bridge';
import {
  DEFAULT_TIMEOUT_MS,
  MAX_BODY_BYTES,
  MAX_REDIRECTS,
  MAX_RETRIES,
  MAX_TIMEOUT_MS,
  decodeBody,
  isRetryableStatus,
  joinHeaders,
  looksLikeChallenge,
  retryDelayMs,
} from './policy';
import { answerProxyLogin } from './proxy-auth';
import { TokenBucket } from './token-bucket';

export interface FetcherOptions {
  extensionId: string;
  session: Session;
  /** Requests per second from the manifest (default 10). */
  perSecond: number;
  /** For segments and media: looser, so HLS never waits behind page requests (NET-2). */
  mediaPerSecond: number;
  /** Manifest `userAgent`, else the user's global one, else the default. */
  userAgent: () => string;
  solver: CloudflareSolver;
  /** Reported to the UI when a request fails while the machine is offline. */
  isOnline: () => boolean;
}

/** A cover that fails once is tried once more; the image is a nicety, so it does not get the full backoff. */
const IMAGE_RETRIES = 1;

export interface Raw {
  status: number;
  url: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

/**
 * Every request an extension makes (docs/PRD.md NET-1…5). One per extension: its own session (cookies,
 * cache), its own rate limit, http(s) only on every redirect hop, a timeout, retries for what is worth
 * retrying, and the Cloudflare challenge passed in a window when one shows up.
 */
export class ExtensionFetcher {
  private readonly pages: TokenBucket;
  /** Covers have their own bucket at the same rate, so a grid of them never delays a browse or detail request. */
  private readonly images: TokenBucket;
  readonly media: TokenBucket;

  constructor(private readonly options: FetcherOptions) {
    this.pages = new TokenBucket(options.perSecond);
    this.images = new TokenBucket(options.perSecond);
    this.media = new TokenBucket(options.mediaPerSecond);
    installHeaderBridge(options.session);
  }

  async request(request: HttpRequest): Promise<HttpResult> {
    const raw = await this.execute(request, this.pages, MAX_RETRIES);
    return {
      status: raw.status,
      url: raw.url,
      headers: raw.headers,
      text: decodeBody(raw.body, raw.headers['content-type']),
    };
  }

  /** The extension's own session, for requests that stream (playback) and so cannot go through `request`. */
  get session(): Session {
    return this.options.session;
  }

  /**
   * The same request with the body as bytes: covers, keys, anything that is not text. `lane: 'image'` is for
   * covers, which wait in their own queue instead of the one page requests use.
   */
  requestBytes(request: HttpRequest, options: { lane?: 'page' | 'image' } = {}): Promise<Raw> {
    return options.lane === 'image'
      ? this.execute(request, this.images, IMAGE_RETRIES)
      : this.execute(request, this.pages, MAX_RETRIES);
  }

  private async execute(request: HttpRequest, bucket: TokenBucket, maxRetries: number): Promise<Raw> {
    const idempotent = (request.method ?? 'GET') !== 'POST';
    let solved = false;
    for (let attempt = 0; ; attempt++) {
      await bucket.take();
      let raw: Raw;
      try {
        raw = await this.once(request);
      } catch (error) {
        const wait = idempotent && attempt < maxRetries ? retryDelayMs(attempt, undefined) : null;
        if (wait === null || error instanceof HostError) throw this.offlineAware(error);
        await new Promise((resolve) => setTimeout(resolve, wait));
        continue;
      }

      const text = decodeBody(raw.body, raw.headers['content-type']);
      if (!solved && looksLikeChallenge(raw.status, raw.headers, text.slice(0, 4096))) {
        solved = true;
        if (await this.options.solver.solve(this.options.extensionId, request.url)) {
          attempt = -1; // a fresh set of retries with the cookie in place
          continue;
        }
        throw new HostError(
          'CloudflareError',
          `${new URL(request.url).host} is behind a Cloudflare challenge that could not be passed`,
        );
      }
      if (isRetryableStatus(raw.status)) {
        const wait = idempotent ? retryDelayMs(attempt, raw.headers['retry-after']) : null;
        if (wait !== null && attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, wait));
          continue;
        }
      }
      return raw;
    }
  }

  private offlineAware(error: unknown): unknown {
    if (error instanceof HostError || this.options.isOnline()) return error;
    return new HostError('NetworkError', 'You are offline');
  }

  /** One attempt: no retry, no challenge handling. */
  private once(request: HttpRequest): Promise<Raw> {
    return new Promise<Raw>((resolve, reject) => {
      const method = request.method ?? 'GET';
      const timeoutMs = Math.min(request.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
      const client = net.request({
        method,
        url: request.url,
        session: this.options.session,
        useSessionCookies: true,
        redirect: 'manual',
      });
      const headers = { 'user-agent': this.options.userAgent(), ...lowerKeys(request.headers) };
      for (const [name, value] of Object.entries(withMarkers(headers))) client.setHeader(name, value);

      let settled = false;
      let hops = 0;
      let currentUrl = request.url;
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        client.abort();
        reject(error);
      };
      const timer = setTimeout(
        () =>
          fail(
            new HostError('NetworkError', `${new URL(currentUrl).host} did not answer within ${timeoutMs / 1000} s`),
          ),
        timeoutMs,
      );

      client.on('login', answerProxyLogin);
      client.on('redirect', (_status, _method, redirectUrl) => {
        let target: URL;
        try {
          target = new URL(redirectUrl);
        } catch {
          return fail(new HostError('NetworkError', `Redirect to an invalid URL: ${redirectUrl}`));
        }
        if (target.protocol !== 'http:' && target.protocol !== 'https:') {
          return fail(new HostError('NetworkError', `Refusing a redirect to ${target.protocol}`));
        }
        if (++hops > MAX_REDIRECTS) return fail(new HostError('NetworkError', 'Too many redirects'));
        currentUrl = target.href;
        client.followRedirect();
      });
      client.on('response', (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) return fail(new HostError('NetworkError', 'The response is too large'));
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({
            status: response.statusCode,
            url: currentUrl,
            headers: joinHeaders(response.headers),
            body: Buffer.concat(chunks),
          });
        });
        response.on('error', (error: Error) => fail(new HostError('NetworkError', error.message)));
      });
      client.on('error', (error) => fail(new HostError('NetworkError', error.message.replace(/^net::/, ''))));
      client.on('abort', () => fail(new HostError('NetworkError', 'The request was aborted')));

      if (request.body !== undefined && method === 'POST') client.write(request.body);
      client.end();
    });
  }
}

function lowerKeys(headers: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]));
}
