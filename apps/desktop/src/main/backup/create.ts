import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BackupManifest } from '@matane-anime/shared';
import Database from 'better-sqlite3';
import { COVERS_PREFIX, DATABASE_FILE, MANIFEST_FILE } from './archive';
import { appliedMigrations, countsOf, stripForBackup } from './database';
import { type ZipEntry, writeZip } from './zip';

export interface CreateBackupOptions {
  /** The open, live database: it is only read, through SQLite's online backup. */
  sqlite: Database.Database;
  coversDir: string;
  /** A folder for the temporary snapshot; it is removed again. */
  workDir: string;
  appVersion: string;
  now: Date;
  outPath: string;
}

/**
 * Writes a backup of the user's data (docs/plans/fase-5-polish-rilis-v1.md, milestone 5e): a consistent snapshot
 * of the open database with downloads, caches and secrets stripped, the covers it refers to, and a manifest.
 * Downloaded files and extension code are not included.
 */
export async function createBackup(options: CreateBackupOptions): Promise<BackupManifest> {
  mkdirSync(options.workDir, { recursive: true });
  const snapshot = join(options.workDir, `snapshot-${options.now.getTime()}.db`);
  rmSync(snapshot, { force: true });
  try {
    await options.sqlite.backup(snapshot);
    const copy = new Database(snapshot);
    let manifest: BackupManifest;
    const entries: ZipEntry[] = [];
    try {
      const files = stripForBackup(copy, { hasCover: (file) => existsSync(join(options.coversDir, file)) });
      const covers: ZipEntry[] = [];
      for (const file of files) {
        try {
          covers.push({ name: COVERS_PREFIX + file, data: readFileSync(join(options.coversDir, file)) });
        } catch {
          // the file went away since it was listed: the cover is fetched again when the entry is opened
        }
      }
      manifest = {
        format: 1,
        appVersion: options.appVersion,
        schemaVersion: appliedMigrations(copy),
        createdAt: options.now.toISOString(),
        counts: countsOf(copy, covers.length),
      };
      // One file, no -wal: back to the default journal and compact before it is read as bytes.
      copy.pragma('journal_mode = DELETE');
      copy.exec('VACUUM');
      entries.push(...covers);
    } finally {
      copy.close();
    }
    entries.unshift(
      { name: MANIFEST_FILE, data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
      { name: DATABASE_FILE, data: readFileSync(snapshot) },
    );
    const part = `${options.outPath}.part`;
    writeFileSync(part, writeZip(entries));
    renameSync(part, options.outPath);
    return manifest;
  } finally {
    rmSync(snapshot, { force: true });
    rmSync(`${snapshot}-wal`, { force: true });
    rmSync(`${snapshot}-shm`, { force: true });
  }
}
