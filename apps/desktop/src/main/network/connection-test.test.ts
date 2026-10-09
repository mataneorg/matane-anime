import { describe, expect, it } from 'vitest';
import { TEST_TIMEOUT_MS, TEST_URL, describeNetworkError, runConnectionTest } from './connection-test';

function clock(...times: number[]): () => number {
  let index = 0;
  return () => times[Math.min(index++, times.length - 1)] ?? 0;
}

describe('runConnectionTest', () => {
  it('measures a 204 with the injected clock', async () => {
    const calls: [string, number][] = [];
    const result = await runConnectionTest({
      get: async (url, { timeoutMs }) => {
        calls.push([url, timeoutMs]);
        return { status: 204 };
      },
      now: clock(1000, 1142),
    });
    expect(result).toEqual({ ok: true, ms: 142, error: null });
    expect(calls).toEqual([[TEST_URL, TEST_TIMEOUT_MS]]);
    expect(TEST_URL).toBe('https://www.gstatic.com/generate_204');
  });

  it('turns a rejection into a readable error without a time', async () => {
    const result = await runConnectionTest({
      get: async () => {
        throw new Error('net::ERR_PROXY_CONNECTION_FAILED');
      },
      now: clock(0, 5),
    });
    expect(result).toEqual({ ok: false, ms: null, error: 'The proxy did not accept the connection' });
  });

  it('reports a 407 as a missing login and other statuses by number', async () => {
    const answer = (status: number) => runConnectionTest({ get: async () => ({ status }), now: () => 0 });
    expect((await answer(407)).error).toMatch(/username and password/);
    expect(await answer(503)).toEqual({ ok: false, ms: null, error: 'The server answered 503' });
  });

  it('never reports a negative time', async () => {
    const result = await runConnectionTest({ get: async () => ({ status: 200 }), now: clock(10, 5) });
    expect(result.ms).toBe(0);
  });
});

describe('describeNetworkError', () => {
  it.each([
    ['net::ERR_NAME_NOT_RESOLVED', /DNS/],
    ['net::ERR_CONNECTION_REFUSED', /refused/],
    ['net::ERR_CONNECTION_TIMED_OUT', /timed out/],
    ['net::ERR_INTERNET_DISCONNECTED', /no internet/],
    ['net::ERR_CERT_AUTHORITY_INVALID', /secure connection/],
    ['net::ERR_TUNNEL_CONNECTION_FAILED', /proxy/],
    ['net::ERR_SOMETHING_NEW', /SOMETHING_NEW/],
  ])('%s', (message, expected) => expect(describeNetworkError(new Error(message))).toMatch(expected));

  it('copes with a thrown string and an empty message', () => {
    expect(describeNetworkError('net::ERR_CONNECTION_REFUSED')).toMatch(/refused/);
    expect(describeNetworkError(new Error(''))).toBe('The request failed');
  });
});
