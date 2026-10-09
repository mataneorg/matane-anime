import type { AppSettings, DohProvider } from '@matane-anime/shared';

// Pure: the settings turned into what Electron wants (`app.configureHostResolver`, `session.setProxy`).
// Nothing here imports `electron`, so it runs under vitest; `apply.ts` hands the results to Electron.

export type NetworkSettings = Pick<
  AppSettings,
  'dohMode' | 'dohProvider' | 'dohCustomUrl' | 'proxyMode' | 'proxyHost' | 'proxyPort' | 'proxyUser' | 'userAgent'
>;

/** The settings keys that change what `apply.ts` does; a `settings.set` touching one re-applies the network. */
export const NETWORK_SETTING_KEYS: readonly (keyof NetworkSettings)[] = [
  'dohMode',
  'dohProvider',
  'dohCustomUrl',
  'proxyMode',
  'proxyHost',
  'proxyPort',
  'proxyUser',
];

export const DOH_PROVIDER_URLS: Record<Exclude<DohProvider, 'custom'>, string> = {
  cloudflare: 'https://cloudflare-dns.com/dns-query',
  google: 'https://dns.google/dns-query',
  quad9: 'https://dns.quad9.net/dns-query',
  adguard: 'https://dns.adguard-dns.com/dns-query',
};

/** A DoH address: https only (a plain http one would put the DNS questions on the wire again). */
export function validateDohUrl(input: string): { ok: true; url: string } | { ok: false; error: string } {
  const text = input.trim();
  if (!text) return { ok: false, error: 'Enter the address of the DNS over HTTPS server' };
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return { ok: false, error: 'The DNS over HTTPS address is not a valid URL' };
  }
  if (parsed.protocol !== 'https:') return { ok: false, error: 'The DNS over HTTPS address must start with https://' };
  if (!parsed.hostname) return { ok: false, error: 'The DNS over HTTPS address has no host' };
  if (parsed.username || parsed.password) return { ok: false, error: 'The DNS over HTTPS address cannot hold a login' };
  // The original text, not `href`: a template such as `https://host/dns-query{?dns}` must keep its braces.
  return { ok: true, url: text };
}

/** The server URL the settings select, or why there is none. */
export function dohServer(
  settings: Pick<NetworkSettings, 'dohProvider' | 'dohCustomUrl'>,
): { ok: true; url: string } | { ok: false; error: string } {
  if (settings.dohProvider === 'custom') return validateDohUrl(settings.dohCustomUrl);
  return { ok: true, url: DOH_PROVIDER_URLS[settings.dohProvider] };
}

export interface HostResolverOptions {
  secureDnsMode: 'off' | 'automatic' | 'secure';
  secureDnsServers: string[];
}

/**
 * Off, or DoH `auto` (Chromium's "automatic": the server is tried first, the system resolver is the fallback),
 * or `always` ("secure": nothing else). An unusable custom address falls back to off rather than half-applying.
 */
export function hostResolverOptions(settings: NetworkSettings): HostResolverOptions {
  const off: HostResolverOptions = { secureDnsMode: 'off', secureDnsServers: [] };
  if (settings.dohMode === 'off') return off;
  const server = dohServer(settings);
  if (!server.ok) return off;
  return { secureDnsMode: settings.dohMode === 'auto' ? 'automatic' : 'secure', secureDnsServers: [server.url] };
}

const HOST_PATTERN = /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/** A bare host name or address, no scheme, port, path or login. IPv6 may come with or without brackets. */
export function normalizeProxyHost(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const bracketed = text.startsWith('[') && text.endsWith(']');
  const inner = bracketed ? text.slice(1, -1) : text;
  if (bracketed || inner.includes(':')) return /^[0-9A-Fa-f:.]+$/.test(inner) ? `[${inner}]` : null;
  return HOST_PATTERN.test(inner) ? inner : null;
}

export interface ElectronProxyConfig {
  mode: 'system' | 'direct' | 'fixed_servers';
  proxyRules?: string;
}

/** What is wrong with the proxy part of the settings; null when it is usable (or off). */
export function proxyProblem(settings: NetworkSettings): string | null {
  if (settings.proxyMode !== 'http' && settings.proxyMode !== 'socks5') return null;
  if (!settings.proxyHost.trim()) return 'Enter the proxy host';
  if (!normalizeProxyHost(settings.proxyHost)) return 'The proxy host is not a valid host name or address';
  if (settings.proxyPort === null) return 'Enter the proxy port';
  return null;
}

/**
 * `system` and `none` map to Electron's `system` and `direct`. A proxy without a usable host and port falls back
 * to `system` (the form says what is missing, see `proxyProblem`). SOCKS5 resolves host names on the proxy.
 */
export function proxyConfig(settings: NetworkSettings): ElectronProxyConfig {
  if (settings.proxyMode === 'none') return { mode: 'direct' };
  if (settings.proxyMode === 'system' || proxyProblem(settings) !== null) return { mode: 'system' };
  const host = normalizeProxyHost(settings.proxyHost);
  const scheme = settings.proxyMode === 'socks5' ? 'socks5' : 'http';
  return { mode: 'fixed_servers', proxyRules: `${scheme}://${host}:${settings.proxyPort}` };
}

export interface ProxyCredentials {
  username: string;
  password: string;
}

/** The login for the proxy's challenge; null when no proxy is set, or it has no user. (Chromium has no SOCKS5 login.) */
export function proxyCredentials(settings: NetworkSettings, password: string | null): ProxyCredentials | null {
  if (settings.proxyMode !== 'http' || proxyProblem(settings) !== null || !settings.proxyUser) return null;
  return { username: settings.proxyUser, password: password ?? '' };
}

export const MAX_USER_AGENT_LENGTH = 512;

/** A User-Agent is one line of printable ASCII (NET-4); empty means "use the default" (null). */
export function validateUserAgent(input: string): { ok: true; value: string | null } | { ok: false; error: string } {
  const text = input.trim();
  if (!text) return { ok: true, value: null };
  if (text.length > MAX_USER_AGENT_LENGTH)
    return { ok: false, error: `The User-Agent can have up to ${MAX_USER_AGENT_LENGTH} characters` };
  if (!/^[\x20-\x7e]+$/.test(text)) return { ok: false, error: 'The User-Agent can only hold printable ASCII' };
  return { ok: true, value: text };
}

/** The saved global User-Agent when it is usable, else null (the default applies). */
export function globalUserAgent(stored: string | null): string | null {
  if (stored === null) return null;
  const checked = validateUserAgent(stored);
  return checked.ok ? checked.value : null;
}

/** The saved settings with a patch from the form on top (a key the patch leaves out, or sets to undefined, is kept). */
export function mergeNetworkSettings<T extends object>(saved: T, patch: Partial<T> | undefined): T {
  const merged = { ...saved };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}

/** Everything wrong with the network part of the settings, for the connection test; null when it is fine. */
export function networkProblem(settings: NetworkSettings): string | null {
  if (settings.dohMode !== 'off') {
    const server = dohServer(settings);
    if (!server.ok) return server.error;
  }
  const proxy = proxyProblem(settings);
  if (proxy) return proxy;
  if (settings.userAgent !== null) {
    const agent = validateUserAgent(settings.userAgent);
    if (!agent.ok) return agent.error;
  }
  return null;
}
