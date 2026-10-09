import type { NetworkTestResult } from '@matane-anime/shared';

/** "Test connection" (NET-8): a HEAD that answers 204 with no body, from a host that is up almost everywhere. */
export const TEST_URL = 'https://www.gstatic.com/generate_204';
export const TEST_TIMEOUT_MS = 10_000;

export interface ConnectionTestDeps {
  /** HEAD `url`; rejects with Chromium's error (`net::ERR_...`) when there is no answer. */
  get(url: string, options: { timeoutMs: number }): Promise<{ status: number }>;
  now(): number;
}

const REASONS: [RegExp, string][] = [
  [/PROXY_CONNECTION_FAILED|TUNNEL_CONNECTION_FAILED|SOCKS_CONNECTION/, 'The proxy did not accept the connection'],
  [/PROXY_AUTH|PROXY_CERTIFICATE/, 'The proxy refused the login'],
  [/NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|DNS_/, 'The address could not be looked up (DNS)'],
  [/CONNECTION_REFUSED/, 'The server refused the connection'],
  [/TIMED_OUT|TIMEOUT/, 'The connection timed out'],
  [/INTERNET_DISCONNECTED|NETWORK_CHANGED|ADDRESS_UNREACHABLE/, 'There is no internet connection'],
  [/CERT_|SSL_|TLS/, 'The secure connection could not be set up'],
  [/CONNECTION_RESET|CONNECTION_CLOSED|EMPTY_RESPONSE/, 'The connection was closed by the other side'],
];

/** A short, readable reason for a failed request; the Chromium code is kept in brackets when it is not known. */
export function describeNetworkError(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error)).replace(/^net::/, '');
  for (const [pattern, reason] of REASONS) if (pattern.test(message)) return reason;
  return message ? `The request failed (${message})` : 'The request failed';
}

export async function runConnectionTest(
  { get, now }: ConnectionTestDeps,
  url: string = TEST_URL,
): Promise<NetworkTestResult> {
  const started = now();
  try {
    const { status } = await get(url, { timeoutMs: TEST_TIMEOUT_MS });
    const ms = Math.max(0, now() - started);
    if (status >= 200 && status < 300) return { ok: true, ms, error: null };
    if (status === 407) return { ok: false, ms: null, error: 'The proxy needs a username and password' };
    return { ok: false, ms: null, error: `The server answered ${status}` };
  } catch (error) {
    return { ok: false, ms: null, error: describeNetworkError(error) };
  }
}
