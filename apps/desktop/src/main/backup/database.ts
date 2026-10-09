import { join } from 'node:path';
import { type BackupCounts, isAbsolutePath } from '@matane-anime/shared';
import type Database from 'better-sqlite3';
import { purgeBrowseRows } from '../db/housekeeping';
import { isCoverFile } from './archive';

/** Settings that never leave the machine: the window geometry, paths of dev folders, and anything secret. */
const MACHINE_SETTINGS_SQL = `DELETE FROM settings
  WHERE key IN ('window.state', 'extensions.devFolders')
     OR lower(key) LIKE '%password%' OR lower(key) LIKE '%secret%' OR lower(key) LIKE '%token%'`;

/** Settings that hold a folder of this machine. */
const FOLDER_SETTINGS = ['downloadFolder', 'backupFolder'];

/** Tables that are cache, queues, or hold credentials; none of them is the user's own data. */
const DROPPED_TABLES = ['downloads', 'image_cache', 'tracker_accounts', 'tracker_queue', 'extension_storage'];

export function appliedMigrations(sqlite: Database.Database): number {
  const table = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get();
  if (!table) return 0;
  return (sqlite.prepare('SELECT count(*) AS count FROM __drizzle_migrations').get() as { count: number }).count;
}

function hasTable(sqlite: Database.Database, table: string): boolean {
  return sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;
}

/** A backup from an older version may lack a table or a column; whatever is missing has nothing to drop. */
function hasColumn(sqlite: Database.Database, table: string, column: string): boolean {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((row) => row.name === column);
}

function scalar(sqlite: Database.Database, sql: string): number {
  return (sqlite.prepare(sql).get() as { count: number }).count;
}

/**
 * Extensions installed from a repository are not part of a backup (only their code is machine-specific, and
 * it is signed and re-downloadable): the row stays, without a folder or hash, so the extension shows up as
 * "files missing, reinstall" and its settings and library entries are kept.
 */
export function markExtensionsForReinstall(sqlite: Database.Database): string[] {
  const ids = repoExtensionIds(sqlite);
  if (ids.length > 0)
    sqlite.prepare("UPDATE extensions SET install_dir = NULL, sha256 = NULL WHERE origin = 'repo'").run();
  return ids;
}

/** The extensions a backup lists that have to be installed again from their repository. */
export function repoExtensionIds(sqlite: Database.Database): string[] {
  if (!hasColumn(sqlite, 'extensions', 'origin')) return [];
  const rows = sqlite.prepare("SELECT id FROM extensions WHERE origin = 'repo' ORDER BY id").all() as { id: string }[];
  return rows.map((row) => row.id);
}

/** Drops what belongs to this machine or to its caches, from a copy of the database. */
export function dropMachineData(sqlite: Database.Database): void {
  for (const table of DROPPED_TABLES) if (hasTable(sqlite, table)) sqlite.exec(`DELETE FROM ${table}`);
  if (hasTable(sqlite, 'settings')) sqlite.exec(MACHINE_SETTINGS_SQL);
  // Not used yet; it would be a path on this machine.
  sqlite.exec('UPDATE anime SET custom_cover_path = NULL WHERE custom_cover_path IS NOT NULL');
  markExtensionsForReinstall(sqlite);
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? '';
}

/**
 * Turns the open copy of the live database into what a backup stores: no downloads or caches, no anime
 * that only a listing created, and covers pointing at their file name only (the folder differs per machine).
 * Returns the cover files the archive has to carry.
 */
export function stripForBackup(sqlite: Database.Database, options: { hasCover(file: string): boolean }): string[] {
  sqlite.pragma('foreign_keys = ON');
  const covers = new Set<string>();
  sqlite.transaction(() => {
    dropMachineData(sqlite);
    // Downloads are gone, so a downloaded anime nobody kept counts as browse-only too. A TTL of 0 removes every one.
    purgeBrowseRows(sqlite, Date.now() + 1000, 0);
    const rows = sqlite.prepare('SELECT id, cover_path AS coverPath FROM anime WHERE cover_path IS NOT NULL').all() as {
      id: number;
      coverPath: string;
    }[];
    const update = sqlite.prepare('UPDATE anime SET cover_path = ? WHERE id = ?');
    for (const row of rows) {
      const file = baseName(row.coverPath);
      if (isCoverFile(file) && options.hasCover(file)) {
        covers.add(file);
        update.run(file, row.id);
      } else {
        update.run(null, row.id);
      }
    }
  })();
  return [...covers].sort();
}

export function countsOf(sqlite: Database.Database, covers: number): BackupCounts {
  return {
    anime: scalar(sqlite, 'SELECT count(*) AS count FROM anime'),
    episodes: scalar(sqlite, 'SELECT count(*) AS count FROM episodes'),
    categories: scalar(sqlite, 'SELECT count(*) AS count FROM categories'),
    history: scalar(sqlite, 'SELECT count(*) AS count FROM history'),
    covers,
    repositories: scalar(sqlite, 'SELECT count(*) AS count FROM extension_repos'),
    extensions: scalar(sqlite, "SELECT count(*) AS count FROM extensions WHERE origin = 'repo'"),
  };
}

/**
 * Makes a database taken from a backup fit this machine, before it replaces the live one: covers point into
 * this machine's covers folder, a download folder that does not exist is forgotten (the default is used),
 * and the machine-bound data is dropped again in case the file was not made by this app.
 */
export function prepareRestoredDatabase(
  sqlite: Database.Database,
  options: { coversDir: string; folderExists(path: string): boolean },
): void {
  sqlite.pragma('foreign_keys = ON');
  sqlite.transaction(() => {
    dropMachineData(sqlite);
    const rows = sqlite.prepare('SELECT id, cover_path AS coverPath FROM anime WHERE cover_path IS NOT NULL').all() as {
      id: number;
      coverPath: string;
    }[];
    const update = sqlite.prepare('UPDATE anime SET cover_path = ? WHERE id = ?');
    for (const row of rows) {
      update.run(isCoverFile(row.coverPath) ? join(options.coversDir, row.coverPath) : null, row.id);
    }
    // Folders are machine state too: one that does not exist here is dropped, so the default is used.
    for (const key of FOLDER_SETTINGS) {
      const row = sqlite.prepare('SELECT value_json AS value FROM settings WHERE key = ?').get(key) as
        { value: string } | undefined;
      if (!row) continue;
      let path: unknown = null;
      try {
        path = JSON.parse(row.value);
      } catch {
        // an unreadable value is treated like a missing folder
      }
      if (typeof path !== 'string' || !isAbsolutePath(path) || !options.folderExists(path)) {
        sqlite.prepare('DELETE FROM settings WHERE key = ?').run(key);
      }
    }
  })();
}
