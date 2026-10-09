import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { invalidateForTags } from './catalog';

/** A client with one fresh (never stale on its own) query per key; returns the keys that were invalidated. */
function invalidated(tags: string[], keys: unknown[][]): unknown[][] {
  const client = new QueryClient();
  for (const key of keys) client.setQueryData(key, 1);
  invalidateForTags(client, tags);
  return keys.filter((key) => client.getQueryState(key)?.isInvalidated);
}

describe('invalidateForTags', () => {
  const keys = [
    ['library', 'list', { sort: 'title', downloadedOnly: true }],
    ['library', 'count'],
    ['downloads'],
    ['categories'],
  ];

  it('refreshes the library lists when downloads change, for the "downloaded only" filter', () => {
    expect(invalidated(['downloads'], keys)).toEqual([keys[0], keys[2]]);
  });

  it('refreshes the whole library for a library change, and the categories for a category change', () => {
    expect(invalidated(['library'], keys)).toEqual([keys[0], keys[1]]);
    expect(invalidated(['categories'], keys)).toEqual([keys[0], keys[1], keys[3]]);
  });

  it('leaves unrelated queries alone', () => {
    expect(invalidated(['history'], keys)).toEqual([]);
  });
});
