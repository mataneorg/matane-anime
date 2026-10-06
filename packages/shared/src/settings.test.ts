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
      theme: 'latte',
      accent: DEFAULT_SETTINGS.accent,
      amoled: false,
      language: 'id',
      showNsfw: false,
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
