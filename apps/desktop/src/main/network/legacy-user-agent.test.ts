import { describe, expect, it } from 'vitest';
import { LEGACY_USER_AGENT_KEY, migrateLegacyUserAgent } from './legacy-user-agent';
import type { RawSettings } from './proxy-password';

function rawWith(legacy?: unknown): RawSettings & { rows: Map<string, unknown> } {
  const rows = new Map<string, unknown>(legacy === undefined ? [] : [[LEGACY_USER_AGENT_KEY, legacy]]);
  return {
    rows,
    getValue: <T>(key: string, fallback: T) => (rows.has(key) ? (rows.get(key) as T) : fallback),
    setValue: (key, value) => void rows.set(key, value),
  };
}

describe('migrateLegacyUserAgent', () => {
  it('copies the old value to the setting when the setting is empty, and empties the old row', () => {
    const raw = rawWith('Old/1.0');
    const saved: string[] = [];
    expect(migrateLegacyUserAgent(raw, null, (value) => saved.push(value))).toBe(true);
    expect(saved).toEqual(['Old/1.0']);
    expect(raw.rows.get(LEGACY_USER_AGENT_KEY)).toBeNull();
    // A second start finds nothing to do.
    expect(migrateLegacyUserAgent(raw, 'Old/1.0', (value) => saved.push(value))).toBe(false);
    expect(saved).toHaveLength(1);
  });

  it('keeps a setting that already has a value', () => {
    const raw = rawWith('Old/1.0');
    const saved: string[] = [];
    expect(migrateLegacyUserAgent(raw, 'New/2.0', (value) => saved.push(value))).toBe(false);
    expect(saved).toEqual([]);
    expect(raw.rows.get(LEGACY_USER_AGENT_KEY)).toBeNull();
  });

  it('does nothing without an old row, and ignores a blank or non-text one', () => {
    const saved: string[] = [];
    expect(migrateLegacyUserAgent(rawWith(), null, (value) => saved.push(value))).toBe(false);
    expect(migrateLegacyUserAgent(rawWith('  '), null, (value) => saved.push(value))).toBe(false);
    expect(migrateLegacyUserAgent(rawWith(42), null, (value) => saved.push(value))).toBe(false);
    expect(saved).toEqual([]);
  });
});
