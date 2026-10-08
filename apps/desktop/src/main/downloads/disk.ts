import { statfs } from 'node:fs/promises';
import { dirname } from 'node:path';

// Free space and the total size limit (docs/PRD.md DL-9, DL-10).

export const GIB = 1024 ** 3;
/** With no size estimate, an episode may be anything; below this much free space it is not worth trying. */
export const UNKNOWN_SIZE_MIN_FREE = 2 * GIB;

/** Free bytes on the drive of `path` (or of its nearest existing parent); null when the OS cannot say. */
export async function freeBytes(path: string): Promise<number | null> {
  for (let current = path; ; current = dirname(current)) {
    try {
      const info = await statfs(current);
      return Number(info.bavail) * Number(info.bsize);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(current) === current) return null;
    }
  }
}

/** DL-9: the estimate must fit; without one, there has to be a safe amount free. Unknown free space passes. */
export function hasEnoughSpace(needBytes: number | null, free: number | null): boolean {
  if (free === null) return true;
  return needBytes === null ? free >= UNKNOWN_SIZE_MIN_FREE : free >= needBytes;
}

/** DL-10: whether adding `needBytes` (unknown counts as nothing, but a full folder is full) passes the limit. */
export function exceedsLimit(committedBytes: number, needBytes: number | null, limitBytes: number): boolean {
  return needBytes === null ? committedBytes >= limitBytes : committedBytes + needBytes > limitBytes;
}

export const gbToBytes = (gb: number): number => Math.round(gb * GIB);
