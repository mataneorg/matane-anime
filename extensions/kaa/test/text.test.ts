import { describe, expect, it } from 'vitest';
import { STATUSES, TYPES, episodePart, numberOfPart } from '../src/text';

describe('text helpers', () => {
  it('maps the API words', () => {
    expect(STATUSES['currently_airing']).toBe('ongoing');
    expect(STATUSES['finished_airing']).toBe('completed');
    expect(STATUSES['not_yet_aired']).toBeUndefined();
    expect(TYPES['tv_special']).toBe('special');
    expect(TYPES['tv']).toBe('tv');
  });
  it('builds and reads episode parts, fractions included', () => {
    expect(episodePart('4', 'f3a039')).toBe('ep-4-f3a039');
    expect(episodePart('1092.5', 'ab12cd')).toBe('ep-1092.5-ab12cd');
    expect(numberOfPart('ep-4-f3a039')).toBe(4);
    expect(numberOfPart('ep-1092.5-ab12cd')).toBe(1092.5);
    expect(numberOfPart('nope')).toBeUndefined();
  });
});
