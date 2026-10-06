import { describe, expect, it } from 'vitest';
import {
  MAX_RETRIES,
  MAX_RETRY_WAIT_MS,
  decodeBody,
  isBridgedHeader,
  isRetryableStatus,
  joinHeaders,
  looksLikeChallenge,
  retryDelayMs,
  sanitizeUserAgent,
} from './policy';
import { TokenBucket } from './token-bucket';

describe('retry policy', () => {
  it('retries rate limits and server errors, not client errors or 501', () => {
    for (const status of [429, 500, 502, 503, 504]) expect(isRetryableStatus(status), String(status)).toBe(true);
    for (const status of [200, 301, 400, 401, 403, 404, 501])
      expect(isRetryableStatus(status), String(status)).toBe(false);
  });

  it('backs off exponentially and stops after MAX_RETRIES', () => {
    expect([0, 1].map((attempt) => retryDelayMs(attempt, undefined))).toEqual([500, 1000]);
    expect(retryDelayMs(MAX_RETRIES, undefined)).toBeNull();
  });

  it('honors Retry-After in seconds and as a date, and refuses to wait for too long', () => {
    expect(retryDelayMs(0, '2')).toBe(2000);
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    expect(retryDelayMs(0, new Date(now + 3000).toUTCString(), now)).toBe(3000);
    expect(retryDelayMs(0, new Date(now - 5000).toUTCString(), now)).toBe(0);
    expect(retryDelayMs(0, String(MAX_RETRY_WAIT_MS / 1000 + 1))).toBeNull();
    expect(retryDelayMs(0, 'soon')).toBe(500);
  });
});

describe('looksLikeChallenge', () => {
  it('trusts the cf-mitigated header', () => {
    expect(looksLikeChallenge(403, { 'cf-mitigated': 'challenge' }, '')).toBe(true);
    expect(looksLikeChallenge(200, { 'cf-mitigated': 'Challenge' }, '')).toBe(true);
  });

  it('recognizes the interstitial only from Cloudflare with a 403 or 503', () => {
    const page = '<title>Just a moment...</title>';
    expect(looksLikeChallenge(503, { server: 'cloudflare' }, page)).toBe(true);
    expect(
      looksLikeChallenge(403, { 'cf-ray': 'abc' }, '<script src="/cdn-cgi/challenge-platform/h/b"></script>'),
    ).toBe(true);
    expect(looksLikeChallenge(503, { server: 'nginx' }, page)).toBe(false);
    expect(looksLikeChallenge(200, { server: 'cloudflare' }, page)).toBe(false);
    expect(looksLikeChallenge(403, { server: 'cloudflare' }, 'Forbidden')).toBe(false);
  });
});

describe('bodies and headers', () => {
  it('decodes with the declared charset and falls back to UTF-8', () => {
    const latin1 = Uint8Array.from([0x63, 0x61, 0x66, 0xe9]);
    expect(decodeBody(latin1, 'text/html; charset=iso-8859-1')).toBe('café');
    expect(decodeBody(new TextEncoder().encode('é'), 'text/html')).toBe('é');
    expect(decodeBody(new TextEncoder().encode('é'), 'text/html; charset=nonsense-9')).toBe('é');
  });

  it('lower-cases and joins headers', () => {
    expect(joinHeaders({ 'Content-Type': 'text/html', 'Set-Cookie': ['a=1', 'b=2'], X: undefined })).toEqual({
      'content-type': 'text/html',
      'set-cookie': 'a=1, b=2',
    });
  });

  it('removes the Electron and app tokens from the User-Agent', () => {
    const ua =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) matane-anime/0.1.0 Chrome/152.0.0.0 Electron/44.5.1 Safari/537.36';
    expect(sanitizeUserAgent(ua, 'matane-anime/0.1.0')).toBe(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
    );
    expect(sanitizeUserAgent('Chrome/1 Safari/2', undefined)).toBe('Chrome/1 Safari/2');
  });

  it('knows which headers travel under markers', () => {
    expect(isBridgedHeader('Referer')).toBe(true);
    expect(isBridgedHeader('ORIGIN')).toBe(true);
    expect(isBridgedHeader('range')).toBe(false);
  });
});

describe('TokenBucket', () => {
  function clock() {
    let time = 0;
    const waits: number[] = [];
    return {
      waits,
      now: () => time,
      sleep: async (ms: number) => {
        waits.push(ms);
        time += ms;
      },
    };
  }

  it('lets a burst through at once, then spaces requests', async () => {
    const c = clock();
    const bucket = new TokenBucket(4, { now: c.now, sleep: c.sleep });
    for (let i = 0; i < 4; i++) await bucket.take();
    expect(c.waits).toEqual([]);
    await bucket.take();
    await bucket.take();
    expect(c.waits).toEqual([250, 250]);
  });

  it('refills while idle, but never beyond the burst', async () => {
    const c = clock();
    const bucket = new TokenBucket(2, { now: c.now, sleep: c.sleep });
    await bucket.take();
    await bucket.take();
    c.sleep(10_000);
    c.waits.length = 0;
    await bucket.take();
    await bucket.take();
    await bucket.take();
    expect(c.waits).toEqual([500]);
  });

  it('serves waiters in order and rejects a bad rate', async () => {
    const c = clock();
    const bucket = new TokenBucket(1, { now: c.now, sleep: c.sleep });
    const order: number[] = [];
    await Promise.all([1, 2, 3].map((n) => bucket.take().then(() => order.push(n))));
    expect(order).toEqual([1, 2, 3]);
    expect(() => new TokenBucket(0)).toThrow(RangeError);
  });
});
