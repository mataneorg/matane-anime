import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  DEFAULT_WINDOW_STATE,
  appSettingsSchema,
  settingsFromStored,
  settingsPatchSchema,
  windowStateSchema,
} from './settings';

const stored = (entries: Record<string, string>): ReadonlyMap<string, string> => new Map(Object.entries(entries));

describe('settingsFromStored', () => {
  it('returns the defaults for an empty profile', () => {
    expect(settingsFromStored(stored({}))).toEqual(DEFAULT_SETTINGS);
  });

  it('reads valid values and falls back per key for invalid or unreadable ones', () => {
    const result = settingsFromStored(
      stored({ theme: '"latte"', accent: '"not-an-accent"', amoled: '{oops', language: '"id"' }),
    );
    expect(result).toEqual({
      ...DEFAULT_SETTINGS,
      theme: 'latte',
      accent: DEFAULT_SETTINGS.accent,
      amoled: false,
      language: 'id',
    });
    expect(appSettingsSchema.safeParse(result).success).toBe(true);
  });

  it('ignores keys that are not settings', () => {
    expect(settingsFromStored(stored({ 'window.state': '{}', unknown: '1' }))).toEqual(DEFAULT_SETTINGS);
  });
});

describe('settingsPatchSchema', () => {
  it('keeps only what the patch names, without filling in defaults', () => {
    expect(settingsPatchSchema.parse({ theme: 'frappe' })).toEqual({ theme: 'frappe' });
    expect(settingsPatchSchema.parse({})).toEqual({});
  });

  it('rejects values outside the allowed sets', () => {
    expect(settingsPatchSchema.safeParse({ theme: 'amoled' }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ language: 'fr' }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ amoled: 'yes' }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ playerSpeed: 3 }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ playerQuality: '4k' }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ playerWatchedThreshold: 49 }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ playerWatchedThreshold: 100 }).success).toBe(true);
    expect(settingsPatchSchema.safeParse({ playerSpeed: 1.5, playerVolume: 0.4 }).success).toBe(true);
  });

  it('checks the download and update settings', () => {
    const ok = (patch: Record<string, unknown>) => settingsPatchSchema.safeParse(patch).success;
    expect(ok({ updateIntervalHours: 0 })).toBe(true);
    expect(ok({ updateIntervalHours: 168 })).toBe(true);
    expect(ok({ updateIntervalHours: 7 })).toBe(false);
    expect(ok({ updateSkipUnwatchedOver: null })).toBe(true);
    expect(ok({ updateSkipUnwatchedOver: 0 })).toBe(false);
    expect(ok({ downloadQuality: 'playback' })).toBe(true);
    expect(ok({ downloadQuality: '4k' })).toBe(false);
    expect(ok({ downloadParallelEpisodes: 4 })).toBe(false);
    expect(ok({ downloadParallelSegments: 16 })).toBe(true);
    expect(ok({ downloadSizeLimitGb: 0 })).toBe(false);
    expect(ok({ downloadFolder: null })).toBe(true);
    expect(ok({ updateChannel: 'nightly' })).toBe(false);
  });

  it('checks the content languages and the developer mode', () => {
    const ok = (patch: Record<string, unknown>) => settingsPatchSchema.safeParse(patch).success;
    expect(ok({ contentLanguages: [] })).toBe(true);
    expect(ok({ contentLanguages: ['en', 'id', 'pt-BR'] })).toBe(true);
    expect(ok({ contentLanguages: ['english'] })).toBe(false);
    expect(ok({ contentLanguages: 'en' })).toBe(false);
    expect(ok({ devMode: true })).toBe(true);
    expect(ok({ devMode: 'yes' })).toBe(false);
    expect(DEFAULT_SETTINGS.contentLanguages).toEqual([]);
    expect(DEFAULT_SETTINGS.devMode).toBe(false);
  });
});

describe('network and first-run settings', () => {
  it('defaults to the system proxy, no DoH, the default User-Agent and a fresh profile', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      dohMode: 'off',
      proxyMode: 'system',
      proxyPort: null,
      userAgent: null,
      onboardingDone: false,
      lastSeenVersion: null,
    });
  });

  it('keeps a valid proxy and falls back per key for a bad port or DoH mode', () => {
    const result = settingsFromStored(
      stored({ proxyMode: '"socks5"', proxyHost: '"127.0.0.1"', proxyPort: '70000', dohMode: '"sometimes"' }),
    );
    expect(result.proxyMode).toBe('socks5');
    expect(result.proxyHost).toBe('127.0.0.1');
    expect(result.proxyPort).toBeNull();
    expect(result.dohMode).toBe('off');
  });

  it('never has a proxy password among the settings', () => {
    expect(Object.keys(DEFAULT_SETTINGS).some((key) => /password/i.test(key))).toBe(false);
  });

  it('takes a partial patch for the new keys', () => {
    expect(settingsPatchSchema.parse({ onboardingDone: true, lastSeenVersion: '0.1.0' })).toEqual({
      onboardingDone: true,
      lastSeenVersion: '0.1.0',
    });
    expect(settingsPatchSchema.safeParse({ proxyPort: 0 }).success).toBe(false);
  });
});

describe('windowStateSchema', () => {
  it('accepts a saved geometry and the default', () => {
    expect(windowStateSchema.safeParse(DEFAULT_WINDOW_STATE).success).toBe(true);
    expect(windowStateSchema.safeParse({ x: -20, y: 10, width: 900, height: 600, maximized: true }).success).toBe(true);
  });

  it('rejects a non-positive size', () => {
    expect(windowStateSchema.safeParse({ width: 0, height: 600, maximized: false }).success).toBe(false);
  });
});
