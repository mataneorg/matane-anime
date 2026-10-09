import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '../db/__tests__/helpers';
import { ImageCache } from './cache';

const bytes = (size: number): Uint8Array => new Uint8Array(size).fill(7);

describe('ImageCache', () => {
  let db: TestDb;
  let dir: string;
  let clock: number;
  let cache: ImageCache;

  beforeEach(async () => {
    db = await createTestDb();
    dir = mkdtempSync(join(tmpdir(), 'matane-anime-cache-'));
    clock = 1000;
    cache = new ImageCache(db.connection.db, dir, 1_000_000, () => ++clock);
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('stores an image and reads it back', async () => {
    await cache.put('a', 'browse_cover', bytes(10), 'image/png');
    expect(await cache.read('a')).toEqual({ type: 'image/png', body: bytes(10) });
    expect(cache.bytesOf('browse_cover')).toBe(10);
  });

  it('misses on an unknown key', async () => {
    expect(await cache.get('nope')).toBeUndefined();
    expect(await cache.read('nope')).toBeUndefined();
  });

  it('replaces the entry when a key is stored again', async () => {
    await cache.put('a', 'browse_cover', bytes(10), 'image/png');
    await cache.put('a', 'browse_cover', bytes(30), 'image/jpeg');
    expect(cache.totalBytes()).toBe(30);
    expect((await cache.read('a'))?.type).toBe('image/jpeg');
  });

  it('drops a row whose file is gone', async () => {
    const stored = await cache.put('a', 'browse_cover', bytes(10), 'image/png');
    rmSync(stored.path);
    expect(await cache.get('a')).toBeUndefined();
    expect(cache.totalBytes()).toBe(0);
  });

  it('evicts the least recently used entries once over the limit', async () => {
    cache = new ImageCache(db.connection.db, dir, 25, () => ++clock);
    const first = await cache.put('first', 'browse_cover', bytes(10), 'image/png');
    await cache.put('second', 'browse_cover', bytes(10), 'image/png');
    await cache.get('first'); // now 'second' is the oldest
    await cache.put('third', 'browse_cover', bytes(10), 'image/png');
    await cache.evict();
    expect(await cache.get('second')).toBeUndefined();
    expect(await cache.get('first')).toBeDefined();
    expect(await cache.get('third')).toBeDefined();
    expect(existsSync(first.path)).toBe(true);
    expect(cache.totalBytes()).toBeLessThanOrEqual(25);
  });

  it('evicts at once when the limit is lowered', async () => {
    await cache.put('a', 'browse_cover', bytes(10), 'image/png');
    await cache.put('b', 'browse_cover', bytes(10), 'image/png');
    await cache.setMaxBytes(10);
    expect(cache.totalBytes()).toBe(10);
    expect(await cache.get('a')).toBeUndefined();
  });

  it('clears a kind and removes its files', async () => {
    const stored = await cache.put('a', 'browse_cover', bytes(10), 'image/png');
    await cache.clear('browse_cover');
    expect(cache.bytesOf('browse_cover')).toBe(0);
    expect(existsSync(stored.path)).toBe(false);
  });

  it('deletes by prefix', async () => {
    await cache.put('cover:a', 'browse_cover', bytes(1), 'image/png');
    await cache.put('cover:b', 'browse_cover', bytes(1), 'image/png');
    await cache.put('other', 'browse_cover', bytes(1), 'image/png');
    await cache.deletePrefix('cover:');
    expect(cache.totalBytes()).toBe(1);
  });
});
