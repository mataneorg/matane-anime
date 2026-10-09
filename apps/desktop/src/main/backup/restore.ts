import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError, type BackupManifest, backupManifestSchema } from '@matane-anime/shared';
import Database from 'better-sqlite3';
import { DATABASE_FILE, MANIFEST_FILE, type ParsedBackup } from './archive';
import { appliedMigrations, prepareRestoredDatabase, repoExtensionIds } from './database';

/**
 * A live SQLite file is never swapped while the app has it open. A restore is staged under `restore-pending/`
 * (validated, nothing of the current data touched), the app restarts, and `applyPendingRestore` runs before
 * the database is opened: safety copy of the current one, swap, covers, then the normal migrations bring an
 * older backup forward.
 */
export const PENDING_DIR = 'restore-pending';
const FAILED_DIR = 'restore-failed';

function invalid(message: string): AppError {
  return new AppError('invalid_input', `This backup cannot be restored: ${message}`);
}

function checkStaged(path: string, bundledMigrations: number): { extensionsToReinstall: string[] } {
  let sqlite: Database.Database | undefined;
  try {
    sqlite = new Database(path, { readonly: true });
    const quick = sqlite.pragma('quick_check', { simple: true });
    if (quick !== 'ok') throw invalid('its database is damaged.');
    if (appliedMigrations(sqlite) > bundledMigrations) {
      throw new AppError(
        'unsupported',
        'This backup was made by a newer version of Matane Anime. Update the app first.',
      );
    }
    const hasAnime = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'anime'").get();
    if (!hasAnime) throw invalid('its database is not a Matane Anime library.');
    return { extensionsToReinstall: repoExtensionIds(sqlite) };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw invalid('its database cannot be read.');
  } finally {
    sqlite?.close();
  }
}

/** Writes a checked backup into `restore-pending/` and validates the database inside it. Throws and cleans up on any problem. */
export function stageBackup(
  backup: ParsedBackup,
  options: { userData: string; bundledMigrations: number },
): { extensionsToReinstall: string[] } {
  const pending = join(options.userData, PENDING_DIR);
  rmSync(pending, { recursive: true, force: true });
  mkdirSync(join(pending, 'covers'), { recursive: true });
  try {
    writeFileSync(join(pending, MANIFEST_FILE), JSON.stringify(backup.manifest));
    writeFileSync(join(pending, DATABASE_FILE), backup.database);
    for (const [file, data] of backup.covers) writeFileSync(join(pending, 'covers', file), data);
    return checkStaged(join(pending, DATABASE_FILE), options.bundledMigrations);
  } catch (error) {
    rmSync(pending, { recursive: true, force: true });
    throw error;
  }
}

export type PendingRestoreOutcome =
  | { status: 'none' }
  | { status: 'applied'; manifest: BackupManifest; safetyCopy: string | null }
  | { status: 'failed'; error: string };

export interface ApplyRestoreOptions {
  userData: string;
  bundledMigrations: number;
  now: Date;
  folderExists(path: string): boolean;
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-');
}

/** Copies the current database (with whatever its -wal holds) to `backups/db/pre-restore-<time>.db`. */
function safetyCopyOf(live: string, backupDir: string, now: Date): string | null {
  if (!existsSync(live)) return null;
  mkdirSync(backupDir, { recursive: true });
  const target = join(backupDir, `pre-restore-${stamp(now)}.db`);
  try {
    const sqlite = new Database(live);
    try {
      sqlite.prepare('VACUUM INTO ?').run(target);
    } finally {
      sqlite.close();
    }
  } catch {
    // A database SQLite cannot open is copied as bytes: still better than nothing.
    copyFileSync(live, target);
  }
  return target;
}

/**
 * Applies a staged restore. Call it at startup before `openDatabase`; it never throws: a staged backup that
 * cannot be applied is moved to `restore-failed/` and the current data stays as it was.
 */
export function applyPendingRestore(options: ApplyRestoreOptions): PendingRestoreOutcome {
  const pending = join(options.userData, PENDING_DIR);
  const staged = join(pending, DATABASE_FILE);
  if (!existsSync(staged)) {
    if (existsSync(pending)) rmSync(pending, { recursive: true, force: true });
    return { status: 'none' };
  }
  const live = join(options.userData, DATABASE_FILE);
  const coversDir = join(options.userData, 'covers');
  try {
    const manifest = backupManifestSchema.parse(JSON.parse(readFileSync(join(pending, MANIFEST_FILE), 'utf8')));
    if (manifest.schemaVersion > options.bundledMigrations) throw invalid('it comes from a newer version.');
    checkStaged(staged, options.bundledMigrations);

    const database = new Database(staged);
    try {
      prepareRestoredDatabase(database, { coversDir, folderExists: options.folderExists });
      database.pragma('journal_mode = DELETE');
    } finally {
      database.close();
    }

    const safetyCopy = safetyCopyOf(live, join(options.userData, 'backups', 'db'), options.now);
    for (const suffix of ['', '-wal', '-shm']) rmSync(live + suffix, { force: true });
    renameSync(staged, live);

    const aside = join(options.userData, 'covers.replaced');
    rmSync(aside, { recursive: true, force: true });
    if (existsSync(coversDir)) renameSync(coversDir, aside);
    renameSync(join(pending, 'covers'), coversDir);
    rmSync(aside, { recursive: true, force: true });
    rmSync(pending, { recursive: true, force: true });
    return { status: 'applied', manifest, safetyCopy };
  } catch (error) {
    const failed = join(options.userData, FAILED_DIR);
    try {
      rmSync(failed, { recursive: true, force: true });
      renameSync(pending, failed);
    } catch {
      rmSync(pending, { recursive: true, force: true });
    }
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
}
