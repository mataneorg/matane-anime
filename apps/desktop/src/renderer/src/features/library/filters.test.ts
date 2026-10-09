import { describe, expect, it } from 'vitest';
import { NO_FILTERS, filterCount, filtersQueryPart, pruneSources, toggleIn } from './filters';

describe('filterCount', () => {
  it('counts every switch, status and source that is on', () => {
    expect(filterCount(NO_FILTERS)).toBe(0);
    expect(
      filterCount({
        unwatchedOnly: true,
        startedOnly: false,
        downloadedOnly: true,
        status: ['ongoing', 'hiatus'],
        sourceIds: ['a/en'],
      }),
    ).toBe(5);
  });
});

describe('filtersQueryPart', () => {
  it('sends nothing for no filters', () => {
    expect(filtersQueryPart(NO_FILTERS)).toEqual({});
  });
  it('sends only what is on', () => {
    expect(
      filtersQueryPart({ ...NO_FILTERS, downloadedOnly: true, status: ['completed'], sourceIds: ['a/en', 'b/id'] }),
    ).toEqual({ downloadedOnly: true, status: ['completed'], sourceIds: ['a/en', 'b/id'] });
  });
});

describe('toggleIn', () => {
  it('adds a missing value at the end and removes a present one', () => {
    expect(toggleIn(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleIn(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('pruneSources', () => {
  const filters = { ...NO_FILTERS, sourceIds: ['a/en', 'gone/en', 'b/id'] };
  it('drops sources that no longer exist, so they neither count nor filter', () => {
    const pruned = pruneSources(filters, new Set(['a/en', 'b/id']));
    expect(pruned.sourceIds).toEqual(['a/en', 'b/id']);
    expect(filterCount(pruned)).toBe(2);
    expect(filtersQueryPart(pruned).sourceIds).toEqual(['a/en', 'b/id']);
  });
  it('drops the whole source filter when none of them exist', () => {
    const pruned = pruneSources(filters, new Set(['other/en']));
    expect(filtersQueryPart(pruned)).toEqual({});
    expect(filterCount(pruned)).toBe(0);
  });
  it('keeps everything until the source list is known, and returns the same object when nothing changes', () => {
    expect(pruneSources(filters, null)).toBe(filters);
    expect(pruneSources(filters, new Set(['a/en', 'gone/en', 'b/id']))).toBe(filters);
  });
});
