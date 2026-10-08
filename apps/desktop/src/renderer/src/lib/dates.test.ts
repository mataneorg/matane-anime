import { describe, expect, it } from 'vitest';
import { relativeTime } from './dates';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 5, 15, 12, 0);

describe('relativeTime', () => {
  it('says how long ago in the largest fitting unit', () => {
    expect(relativeTime(NOW - 10_000, NOW, 'en')).toBe('now');
    expect(relativeTime(NOW - 5 * MINUTE, NOW, 'en')).toBe('5 minutes ago');
    expect(relativeTime(NOW - 2 * HOUR - 30 * MINUTE, NOW, 'en')).toBe('2 hours ago');
    expect(relativeTime(NOW - DAY, NOW, 'en')).toBe('yesterday');
    expect(relativeTime(NOW - 3 * DAY, NOW, 'en')).toBe('3 days ago');
    expect(relativeTime(NOW - 65 * DAY, NOW, 'en')).toBe('2 months ago');
  });
  it('follows the language', () => {
    expect(relativeTime(NOW - 2 * HOUR, NOW, 'id')).toBe('2 jam yang lalu');
  });
  it('never looks into the future', () => {
    expect(relativeTime(NOW + HOUR, NOW, 'en')).toBe('now');
  });
});
