import { describe, expect, it } from 'vitest';
import { formatBytes, formatEta, formatSpeed, percentDone, usageShare } from './format';

describe('formatBytes', () => {
  it('writes the sizes the Downloads page shows', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(18 * 1024 ** 2)).toBe('18 MB');
    expect(formatBytes(6.2 * 1024 ** 2)).toBe('6.2 MB');
    expect(formatBytes(412 * 1024 ** 2)).toBe('412 MB');
    expect(formatBytes(14.2 * 1024 ** 3)).toBe('14.2 GB');
    expect(formatBytes(182 * 1024 ** 3)).toBe('182 GB');
    expect(formatBytes(20 * 1024 ** 3)).toBe('20 GB');
  });
  it('treats negative sizes as nothing', () => {
    expect(formatBytes(-5)).toBe('0 B');
  });
  it('follows the locale for the decimal separator', () => {
    expect(formatBytes(6.2 * 1024 ** 2, 'id')).toBe('6,2 MB');
  });
});

describe('formatSpeed', () => {
  it('adds the per-second unit', () => {
    expect(formatSpeed(5.8 * 1024 ** 2)).toBe('5.8 MB/s');
  });
});

describe('formatEta', () => {
  it('uses minutes and seconds, and hours when needed', () => {
    expect(formatEta(51)).toBe('00:51');
    expect(formatEta(192)).toBe('03:12');
    expect(formatEta(3730)).toBe('1:02:10');
    expect(formatEta(-3)).toBe('00:00');
  });
});

describe('percentDone', () => {
  it('prefers segments, falls back to bytes, and may not know', () => {
    expect(percentDone({ segmentsDone: 50, segmentsTotal: 200, bytesDone: 1, sizeBytes: 1000 })).toBe(25);
    expect(percentDone({ segmentsDone: 0, segmentsTotal: null, bytesDone: 250, sizeBytes: 1000 })).toBe(25);
    expect(percentDone({ segmentsDone: 0, segmentsTotal: null, bytesDone: 250, sizeBytes: null })).toBeNull();
    expect(percentDone({ segmentsDone: 0, segmentsTotal: null, bytesDone: 2000, sizeBytes: 1000 })).toBe(100);
  });
});

describe('usageShare', () => {
  it('caps the bar and flags a passed limit', () => {
    expect(usageShare(5, 20)).toEqual({ percent: 25, over: false });
    expect(usageShare(30, 20)).toEqual({ percent: 100, over: true });
    expect(usageShare(1, 0)).toEqual({ percent: 0, over: true });
  });
});
