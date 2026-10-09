import { describe, expect, it } from 'vitest';
import { duration, labelIndexes, niceTicks, percentOf, timeScale } from './format';

describe('duration', () => {
  it('uses minutes under an hour and hours from an hour', () => {
    expect(duration(0)).toEqual({ value: 0, unit: 'min' });
    expect(duration(90_000)).toEqual({ value: 2, unit: 'min' });
    expect(duration(5_400_000)).toEqual({ value: 1.5, unit: 'h' });
  });
});

describe('niceTicks', () => {
  it('has only zero for nothing', () => {
    expect(niceTicks(0)).toEqual([0]);
  });

  it('steps by 1, 2 or 5 times a power of ten and covers the maximum', () => {
    expect(niceTicks(10)).toEqual([0, 5, 10]);
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(100)).toEqual([0, 50, 100]);
    expect(niceTicks(1)).toEqual([0, 0.5, 1]);
  });

  it('keeps whole numbers for counts', () => {
    expect(niceTicks(1, { integer: true })).toEqual([0, 1]);
    expect(niceTicks(2, { integer: true })).toEqual([0, 1, 2]);
    expect(niceTicks(3, { integer: true })).toEqual([0, 1, 2, 3]);
    expect(niceTicks(10, { integer: true })).toEqual([0, 5, 10]);
  });
});

describe('percentOf', () => {
  it('rounds and guards a zero total', () => {
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(5, 0)).toBe(0);
  });
});

describe('timeScale', () => {
  it('uses minutes while the longest bucket is under an hour', () => {
    expect(timeScale(0).unit).toBe('min');
    expect(timeScale(59 * 60_000).unit).toBe('min');
    expect(timeScale(3_600_000)).toEqual({ unit: 'h', perUnitMs: 3_600_000 });
  });
});

describe('labelIndexes', () => {
  it('counts back from the last column so it is always labelled and never crowds the one before', () => {
    expect(labelIndexes(30, 4)).toEqual([1, 5, 9, 13, 17, 21, 25, 29]);
    expect(labelIndexes(5, 1)).toEqual([0, 1, 2, 3, 4]);
    expect(labelIndexes(0, 3)).toEqual([]);
  });
});
