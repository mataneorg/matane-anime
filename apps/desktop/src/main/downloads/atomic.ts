import { mkdir, readdir, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// Atomic writes (docs/PRD.md DL-5). A file only gets its real name when it is complete, so whatever has a
// real name inside an episode's `.tmp` folder is safe to keep for a retry, and a crash or a pulled plug
// leaves nothing half-written under a name that looks finished.

export const PART_SUFFIX = '.part';

/** Writes next to the target and renames, so readers see the old file or the whole new one. */
export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const part = `${path}${PART_SUFFIX}`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(part, data);
  await rename(part, path);
}

/** Size of a regular file, or null when there is none. */
export async function fileSize(path: string): Promise<number | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Deletes a file or a folder with everything in it; a path that is not there is fine. */
export async function removePath(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

/** Deletes the half-written files (`*.part`) of a `.tmp` folder, audio folder included. */
export async function removeParts(dir: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await removeParts(path);
    else if (entry.name.endsWith(PART_SUFFIX)) await rm(path, { force: true });
  }
}

/** Total size of the files under a folder (a file counts for itself). */
export async function treeSize(path: string): Promise<number> {
  let info;
  try {
    info = await stat(path);
  } catch {
    return 0;
  }
  if (info.isFile()) return info.size;
  let total = 0;
  for (const name of await readdir(path)) total += await treeSize(join(path, name));
  return total;
}

/** The last step of an HLS episode: the `.tmp` folder takes the final name, replacing anything stale there. */
export async function finalizeFolder(tmp: string, final: string): Promise<void> {
  await mkdir(dirname(final), { recursive: true });
  await rm(final, { recursive: true, force: true });
  await rename(tmp, final);
}

/** The last step of an MP4: the `.part` file takes the final name. */
export async function finalizeFile(part: string, final: string): Promise<void> {
  await mkdir(dirname(final), { recursive: true });
  await rename(part, final);
}

/** Removes `dir` if it is now empty, walking up to (not including) `stopAt`. */
export async function pruneEmptyParents(dir: string, stopAt: string): Promise<void> {
  for (let current = dir; current.length > stopAt.length && current.startsWith(stopAt); current = dirname(current)) {
    try {
      await rmdir(current);
    } catch {
      return;
    }
  }
}
