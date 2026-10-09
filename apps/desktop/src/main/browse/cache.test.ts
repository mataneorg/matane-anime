import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BROWSE_CACHE_TTL_MS, BrowseCache } from './cache';

describe('BrowseCache', () => {
  let dir: string;
  let clock: number;
  let cache: BrowseCache;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'matane-anime-browse-'));
    clock = 1_000_000;
    cache = new BrowseCache(join(dir, 'browse'), () => clock);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads back what was stored, in order', async () => {
    await cache.put('ext/en|popular', [3, 1, 2], true);
    expect(await cache.get('ext/en|popular')).toEqual({ ids: [3, 1, 2], hasNextPage: true, at: clock });
  });

  it('keeps listings apart', async () => {
    await cache.put('ext/en|popular', [1], false);
    await cache.put('ext/en|latest', [2], false);
    expect((await cache.get('ext/en|popular'))?.ids).toEqual([1]);
    expect((await cache.get('ext/en|latest'))?.ids).toEqual([2]);
  });

  it('replaces an older listing', async () => {
    await cache.put('k', [1], true);
    clock += 10;
    await cache.put('k', [2, 3], false);
    expect(await cache.get('k')).toEqual({ ids: [2, 3], hasNextPage: false, at: clock });
  });

  it('misses on an unknown key', async () => {
    expect(await cache.get('nope')).toBeUndefined();
  });

  it('ignores a listing past its age limit', async () => {
    await cache.put('k', [1], false);
    clock += BROWSE_CACHE_TTL_MS + 1;
    expect(await cache.get('k')).toBeUndefined();
  });

  it('ignores a file that is not a listing', async () => {
    await cache.put('k', [1], false);
    const { createHash } = await import('node:crypto');
    const name = `${createHash('sha1').update('k').digest('hex')}.json`;
    writeFileSync(join(dir, 'browse', name), '{"ids":["x"],"hasNextPage":true,"at":1}');
    expect(await cache.get('k')).toBeUndefined();
    writeFileSync(join(dir, 'browse', name), 'not json');
    expect(await cache.get('k')).toBeUndefined();
  });
});
