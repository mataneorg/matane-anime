import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { and, asc, eq, gte, lt, sql } from 'drizzle-orm';
import type { AppDatabase } from '../db/client';
import { type IMAGE_CACHE_KINDS, imageCache } from '../db/schema';

export type ImageKind = (typeof IMAGE_CACHE_KINDS)[number];

export interface CachedImage {
  key: string;
  path: string;
  contentType: string | null;
  sizeBytes: number;
}

/**
 * Disk cache for proxied images (`userData/cache/images`), indexed by the `image_cache` table. The
 * least recently used entries go once the total passes `maxBytes` (docs/PRD.md §15.2). Browse covers
 * live here so they survive a restart; permanent library covers are stored elsewhere (LIB-7).
 */
export class ImageCache {
  private evicting: Promise<void> | null = null;

  constructor(
    private readonly db: AppDatabase,
    private readonly dir: string,
    private maxBytes: number,
    private readonly now: () => number = Date.now,
  ) {}

  setMaxBytes(maxBytes: number): Promise<void> {
    this.maxBytes = maxBytes;
    return this.evict();
  }

  /** The cached file, marked as recently used. Rows whose file vanished are dropped. */
  async get(key: string): Promise<CachedImage | undefined> {
    const row = this.db.select().from(imageCache).where(eq(imageCache.key, key)).get();
    if (!row) return undefined;
    const exists = await stat(row.path).then(
      () => true,
      () => false,
    );
    if (!exists) {
      this.db.delete(imageCache).where(eq(imageCache.key, key)).run();
      return undefined;
    }
    this.db.update(imageCache).set({ lastAccessAt: this.now() }).where(eq(imageCache.key, key)).run();
    return { key, path: row.path, contentType: row.contentType, sizeBytes: row.sizeBytes };
  }

  /** The cached bytes, or undefined on a miss or when the file cannot be read. */
  async read(key: string): Promise<{ type: string; body: Uint8Array } | undefined> {
    const hit = await this.get(key);
    if (!hit?.contentType) return undefined;
    try {
      return { type: hit.contentType, body: new Uint8Array(await readFile(hit.path)) };
    } catch {
      await this.delete(key);
      return undefined;
    }
  }

  async put(key: string, kind: ImageKind, bytes: Uint8Array, contentType: string | null): Promise<CachedImage> {
    await mkdir(this.dir, { recursive: true });
    const path = join(this.dir, createHash('sha1').update(key).digest('hex'));
    // Write, then rename: a crash never leaves a truncated image behind a valid row.
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, bytes);
    await rename(temp, path);
    const values = { kind, path, sizeBytes: bytes.byteLength, contentType, lastAccessAt: this.now() };
    this.db
      .insert(imageCache)
      .values({ key, ...values })
      .onConflictDoUpdate({ target: imageCache.key, set: values })
      .run();
    void this.evict().catch(() => undefined);
    return { key, path, contentType, sizeBytes: bytes.byteLength };
  }

  async delete(key: string): Promise<void> {
    const row = this.db.delete(imageCache).where(eq(imageCache.key, key)).returning().get();
    if (row) await rm(row.path, { force: true });
  }

  /** Removes every entry whose key starts with `prefix`. */
  async deletePrefix(prefix: string): Promise<void> {
    const rows = this.db
      .delete(imageCache)
      .where(and(gte(imageCache.key, prefix), lt(imageCache.key, `${prefix}￿`)))
      .returning()
      .all();
    for (const row of rows) await rm(row.path, { force: true });
  }

  /** Bytes used by one kind of image (Settings → Data and storage). */
  bytesOf(kind: ImageKind): number {
    const row = this.db
      .select({ total: sql<number>`coalesce(sum(${imageCache.sizeBytes}), 0)` })
      .from(imageCache)
      .where(eq(imageCache.kind, kind))
      .get();
    return row?.total ?? 0;
  }

  totalBytes(): number {
    const row = this.db
      .select({ total: sql<number>`coalesce(sum(${imageCache.sizeBytes}), 0)` })
      .from(imageCache)
      .get();
    return row?.total ?? 0;
  }

  /** Empties one kind. */
  async clear(kind: ImageKind): Promise<void> {
    const rows = this.db.delete(imageCache).where(eq(imageCache.kind, kind)).returning().all();
    for (const row of rows) await rm(row.path, { force: true });
  }

  /** Removes the least recently used entries until the cache fits. One pass at a time. */
  evict(): Promise<void> {
    this.evicting ??= this.evictNow().finally(() => (this.evicting = null));
    return this.evicting;
  }

  private async evictNow(): Promise<void> {
    let total = this.totalBytes();
    while (total > this.maxBytes) {
      const batch = this.db.select().from(imageCache).orderBy(asc(imageCache.lastAccessAt)).limit(50).all();
      if (batch.length === 0) return;
      for (const row of batch) {
        if (total <= this.maxBytes) break;
        this.db.delete(imageCache).where(eq(imageCache.key, row.key)).run();
        await rm(row.path, { force: true });
        total -= row.sizeBytes;
      }
    }
  }
}
