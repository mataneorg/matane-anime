import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The first page of a listing as it was last seen: which anime, in which order. */
export interface CachedListing {
  ids: number[];
  hasNextPage: boolean;
  at: number;
}

/** Older than this is not shown any more; the site's popular list changes slowly, but not for weeks. */
export const BROWSE_CACHE_TTL_MS = 7 * 24 * 60 * 60_000;

/**
 * Remembers the first page of each source's Popular and Latest between runs (`userData/cache/browse`), so
 * Browse opens with something on screen while the site answers. Only ids are kept: the titles and covers are
 * rows in the `anime` table, and `inLibrary` is read from them fresh. One small file per listing, so the
 * folder never grows past two files per source.
 */
export class BrowseCache {
  constructor(
    private readonly dir: string,
    private readonly now: () => number = Date.now,
  ) {}

  private path(key: string): string {
    return join(this.dir, `${createHash('sha1').update(key).digest('hex')}.json`);
  }

  async get(key: string): Promise<CachedListing | undefined> {
    try {
      const value: unknown = JSON.parse(await readFile(this.path(key), 'utf8'));
      if (!isListing(value) || this.now() - value.at > BROWSE_CACHE_TTL_MS) return undefined;
      return value;
    } catch {
      return undefined;
    }
  }

  async put(key: string, ids: number[], hasNextPage: boolean): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const path = this.path(key);
    // Write, then rename: a crash never leaves half a file where the last good one was.
    const temp = `${path}.${process.pid}.tmp`;
    const listing: CachedListing = { ids, hasNextPage, at: this.now() };
    await writeFile(temp, JSON.stringify(listing));
    await rename(temp, path);
  }
}

function isListing(value: unknown): value is CachedListing {
  if (!value || typeof value !== 'object') return false;
  const { ids, hasNextPage, at } = value as Record<string, unknown>;
  return (
    Array.isArray(ids) &&
    ids.every((id) => Number.isInteger(id)) &&
    typeof hasNextPage === 'boolean' &&
    typeof at === 'number'
  );
}
