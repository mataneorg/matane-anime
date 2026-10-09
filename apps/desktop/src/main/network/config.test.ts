import { type AppSettings, DEFAULT_SETTINGS } from '@matane-anime/shared';
import { describe, expect, it } from 'vitest';
import {
  DOH_PROVIDER_URLS,
  globalUserAgent,
  hostResolverOptions,
  mergeNetworkSettings,
  networkProblem,
  normalizeProxyHost,
  proxyConfig,
  proxyCredentials,
  proxyProblem,
  validateDohUrl,
  validateUserAgent,
} from './config';

const base = DEFAULT_SETTINGS;

describe('validateDohUrl', () => {
  it('accepts https, keeping a template as typed', () => {
    expect(validateDohUrl(' https://dns.example.net/dns-query ')).toEqual({
      ok: true,
      url: 'https://dns.example.net/dns-query',
    });
    expect(validateDohUrl('https://dns.example.net/dns-query{?dns}')).toEqual({
      ok: true,
      url: 'https://dns.example.net/dns-query{?dns}',
    });
  });

  it.each([
    '',
    '   ',
    'http://dns.example.net/dns-query',
    'dns.example.net',
    'ftp://x.y',
    'https://',
    'https://u:p@h.net/x',
  ])('refuses %j', (input) => {
    expect(validateDohUrl(input).ok).toBe(false);
  });
});

describe('hostResolverOptions', () => {
  it('is off when DoH is off, whatever the provider', () => {
    expect(hostResolverOptions({ ...base, dohMode: 'off', dohProvider: 'google' })).toEqual({
      secureDnsMode: 'off',
      secureDnsServers: [],
    });
  });

  it('maps auto to automatic and always to secure, with the provider table', () => {
    for (const [provider, url] of Object.entries(DOH_PROVIDER_URLS)) {
      const settings = { ...base, dohProvider: provider as keyof typeof DOH_PROVIDER_URLS };
      expect(hostResolverOptions({ ...settings, dohMode: 'auto' })).toEqual({
        secureDnsMode: 'automatic',
        secureDnsServers: [url],
      });
      expect(hostResolverOptions({ ...settings, dohMode: 'always' })).toEqual({
        secureDnsMode: 'secure',
        secureDnsServers: [url],
      });
    }
  });

  it('has the four documented presets', () => {
    expect(DOH_PROVIDER_URLS).toEqual({
      cloudflare: 'https://cloudflare-dns.com/dns-query',
      google: 'https://dns.google/dns-query',
      quad9: 'https://dns.quad9.net/dns-query',
      adguard: 'https://dns.adguard-dns.com/dns-query',
    });
  });

  it('uses the custom address, and falls back to off when it is not https', () => {
    const custom = { ...base, dohMode: 'always' as const, dohProvider: 'custom' as const };
    expect(hostResolverOptions({ ...custom, dohCustomUrl: 'https://dns.example.net/q' })).toEqual({
      secureDnsMode: 'secure',
      secureDnsServers: ['https://dns.example.net/q'],
    });
    expect(hostResolverOptions({ ...custom, dohCustomUrl: 'http://dns.example.net/q' }).secureDnsMode).toBe('off');
    expect(hostResolverOptions({ ...custom, dohCustomUrl: '' }).secureDnsMode).toBe('off');
  });
});

describe('normalizeProxyHost', () => {
  it.each([
    ['proxy.example.net', 'proxy.example.net'],
    ['  10.0.0.1 ', '10.0.0.1'],
    ['localhost', 'localhost'],
    ['::1', '[::1]'],
    ['[fe80::1]', '[fe80::1]'],
  ])('%j -> %j', (input, expected) => expect(normalizeProxyHost(input)).toBe(expected));

  it.each([
    '',
    ' ',
    'http://proxy.net',
    'proxy.net:8080',
    'proxy.net/path',
    'a b',
    'user@proxy.net',
    'a;b',
    '-x.net',
    '[nope]',
  ])('refuses %j', (input) => expect(normalizeProxyHost(input)).toBeNull());
});

describe('proxyConfig', () => {
  it('maps system and none', () => {
    expect(proxyConfig({ ...base, proxyMode: 'system' })).toEqual({ mode: 'system' });
    expect(proxyConfig({ ...base, proxyMode: 'none' })).toEqual({ mode: 'direct' });
  });

  it('builds the rule for http and socks5', () => {
    const settings = { ...base, proxyHost: 'proxy.example.net', proxyPort: 8080 };
    expect(proxyConfig({ ...settings, proxyMode: 'http' })).toEqual({
      mode: 'fixed_servers',
      proxyRules: 'http://proxy.example.net:8080',
    });
    expect(proxyConfig({ ...settings, proxyMode: 'socks5', proxyPort: 1080 })).toEqual({
      mode: 'fixed_servers',
      proxyRules: 'socks5://proxy.example.net:1080',
    });
  });

  it('brackets an IPv6 host', () => {
    expect(proxyConfig({ ...base, proxyMode: 'http', proxyHost: '::1', proxyPort: 3128 }).proxyRules).toBe(
      'http://[::1]:3128',
    );
  });

  it('never puts the login in the rule', () => {
    const rules = proxyConfig({ ...base, proxyMode: 'http', proxyHost: 'p.net', proxyPort: 1, proxyUser: 'me' });
    expect(rules.proxyRules).toBe('http://p.net:1');
  });

  it('falls back to system when host or port are missing', () => {
    expect(proxyConfig({ ...base, proxyMode: 'http', proxyHost: '', proxyPort: 80 })).toEqual({ mode: 'system' });
    expect(proxyConfig({ ...base, proxyMode: 'socks5', proxyHost: 'p.net', proxyPort: null })).toEqual({
      mode: 'system',
    });
  });
});

describe('proxyProblem', () => {
  it('is null for system, none and a complete proxy', () => {
    expect(proxyProblem({ ...base, proxyMode: 'system' })).toBeNull();
    expect(proxyProblem({ ...base, proxyMode: 'none', proxyHost: '???' })).toBeNull();
    expect(proxyProblem({ ...base, proxyMode: 'http', proxyHost: 'p.net', proxyPort: 80 })).toBeNull();
  });

  it('names what is missing', () => {
    expect(proxyProblem({ ...base, proxyMode: 'http', proxyHost: '', proxyPort: 80 })).toMatch(/host/);
    expect(proxyProblem({ ...base, proxyMode: 'http', proxyHost: 'a b', proxyPort: 80 })).toMatch(/host/);
    expect(proxyProblem({ ...base, proxyMode: 'http', proxyHost: 'p.net', proxyPort: null })).toMatch(/port/);
  });
});

describe('proxyCredentials', () => {
  const proxy = { ...base, proxyMode: 'http' as const, proxyHost: 'p.net', proxyPort: 80, proxyUser: 'me' };

  it('pairs the user with the password', () => {
    expect(proxyCredentials(proxy, 'secret')).toEqual({ username: 'me', password: 'secret' });
    expect(proxyCredentials(proxy, null)).toEqual({ username: 'me', password: '' });
  });

  it('is null without a user, without an http proxy, or with an incomplete one', () => {
    expect(proxyCredentials({ ...proxy, proxyUser: '' }, 'x')).toBeNull();
    expect(proxyCredentials({ ...proxy, proxyMode: 'system' }, 'x')).toBeNull();
    expect(proxyCredentials({ ...proxy, proxyMode: 'socks5' }, 'x')).toBeNull();
    expect(proxyCredentials({ ...proxy, proxyHost: '' }, 'x')).toBeNull();
  });
});

describe('validateUserAgent', () => {
  it('trims, and maps empty to null (the default)', () => {
    expect(validateUserAgent('  Mozilla/5.0 (X11) Chrome/140  ')).toEqual({
      ok: true,
      value: 'Mozilla/5.0 (X11) Chrome/140',
    });
    expect(validateUserAgent('   ')).toEqual({ ok: true, value: null });
  });

  it('refuses control characters, non-ASCII and over-long values', () => {
    expect(validateUserAgent('a\r\nX-Evil: 1').ok).toBe(false);
    expect(validateUserAgent('agent\u0000').ok).toBe(false);
    expect(validateUserAgent('agénte').ok).toBe(false);
    expect(validateUserAgent('a'.repeat(512)).ok).toBe(true);
    expect(validateUserAgent('a'.repeat(513)).ok).toBe(false);
  });
});

describe('globalUserAgent', () => {
  it('returns a usable stored agent and drops an unusable one', () => {
    expect(globalUserAgent(null)).toBeNull();
    expect(globalUserAgent('Custom/1.0')).toBe('Custom/1.0');
    expect(globalUserAgent('')).toBeNull();
    expect(globalUserAgent('bad\nagent')).toBeNull();
  });
});

describe('mergeNetworkSettings', () => {
  it('lays the form over the saved settings and ignores undefined', () => {
    const merged = mergeNetworkSettings(base, { proxyMode: 'http', proxyHost: undefined, userAgent: 'x' });
    expect(merged.proxyMode).toBe('http');
    expect(merged.proxyHost).toBe(base.proxyHost);
    expect(merged.userAgent).toBe('x');
    expect(mergeNetworkSettings(base, undefined)).toEqual(base);
  });

  it('keeps an explicit null', () => {
    expect(mergeNetworkSettings<AppSettings>({ ...base, proxyPort: 80 }, { proxyPort: null }).proxyPort).toBeNull();
  });
});

describe('networkProblem', () => {
  it('is null for the defaults', () => expect(networkProblem(base)).toBeNull());

  it('reports DoH, proxy and User-Agent problems', () => {
    expect(networkProblem({ ...base, dohMode: 'auto', dohProvider: 'custom', dohCustomUrl: 'http://x.y' })).toMatch(
      /https/,
    );
    expect(networkProblem({ ...base, dohMode: 'off', dohProvider: 'custom', dohCustomUrl: 'http://x.y' })).toBeNull();
    expect(networkProblem({ ...base, proxyMode: 'http' })).toMatch(/host/);
    expect(networkProblem({ ...base, userAgent: 'a\nb' })).toMatch(/ASCII/);
  });
});
