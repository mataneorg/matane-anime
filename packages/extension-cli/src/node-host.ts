import { type HostApi, HostError, type LogLevel } from '@matane-anime/extension-runtime';
import type { HttpRequest, HttpResult } from '@matane-anime/extension-sdk';

export interface NodeHostOptions {
  userAgent?: string;
  /** Requests per second, like the manifest's `rateLimit`. */
  perSecond?: number;
  onLog?: (level: LogLevel, message: string) => void;
}

export interface NodeHost {
  host: HostApi;
  stats: { requests: number; httpMs: number };
}

/**
 * The CLI's side of `HostApi`: Node's `fetch` for `http`, memory for `storage`. The app backs the same
 * interface with its network layer, so the sandbox cannot tell which one it is talking to.
 */
export function createNodeHost(options: NodeHostOptions = {}): NodeHost {
  const stats = { requests: 0, httpMs: 0 };
  const store = new Map<string, unknown>();
  const gap = 1000 / (options.perSecond ?? 10);
  let nextSlot = 0;

  const http = async (request: HttpRequest): Promise<HttpResult> => {
    const started = performance.now();
    const wait = nextSlot - Date.now();
    nextSlot = Math.max(nextSlot, Date.now()) + gap;
    stats.requests++;
    try {
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      const response = await fetch(request.url, {
        method: request.method ?? 'GET',
        headers: { 'user-agent': options.userAgent ?? 'Mozilla/5.0 (ma-ext)', ...request.headers },
        ...(request.body !== undefined && { body: request.body }),
        redirect: 'follow',
        signal: AbortSignal.timeout(request.timeoutMs ?? 20_000),
      });
      const text = await response.text();
      if (response.headers.get('cf-mitigated') === 'challenge') {
        throw new HostError(
          'CloudflareError',
          'The site is behind a Cloudflare challenge. Open it in Matane Anime to pass it.',
        );
      }
      return { status: response.status, url: response.url, headers: Object.fromEntries(response.headers), text };
    } catch (error) {
      if (error instanceof HostError) throw error;
      const cause = (error as { cause?: { code?: string } }).cause?.code;
      throw new HostError('NetworkError', `${(error as Error).message}${cause ? ` (${cause})` : ''}`);
    } finally {
      stats.httpMs += performance.now() - started;
    }
  };

  return {
    stats,
    host: {
      http,
      storage: {
        get: async (key) => store.get(key) ?? null,
        set: async (key, value) => void store.set(key, value),
        remove: async (key) => void store.delete(key),
      },
      log: (level, message) => options.onLog?.(level, message),
    },
  };
}
