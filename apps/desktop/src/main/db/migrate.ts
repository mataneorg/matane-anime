import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { DatabaseConnection } from './client';

const KEPT_BACKUPS = 3;

/** The database was written by a newer version of the app (a downgrade, or the other update channel). */
export class DatabaseNewerError extends Error {
  constructor(
    readonly applied: number,
    readonly bundled: number,
  ) {
    super(`The database has ${applied} migrations applied but this version only knows ${bundled}.`);
    this.name = 'DatabaseNewerError';
  }
}

function countAppliedMigrations(connection: DatabaseConnection): number {
  const table = connection.sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get();
  if (!table) return 0;
  const row = connection.sqlite.prepare('SELECT count(*) AS count FROM __drizzle_migrations').get() as {
    count: number;
  };
  return row.count;
}

export function countBundledMigrations(migrationsFolder: string): number {
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8')) as {
    entries: unknown[];
  };
  return journal.entries.length;
}

/** `data-` copies are taken before a migration, `pre-restore-` ones before a restore: each kind keeps its own last few. */
const BACKUP_PREFIXES = ['data-', 'pre-restore-'];

function pruneBackups(backupDir: string): void {
  const names = readdirSync(backupDir).filter((name) => name.endsWith('.db'));
  for (const prefix of BACKUP_PREFIXES) {
    const newestFirst = names
      .filter((name) => name.startsWith(prefix))
      .sort()
      .reverse();
    for (const stale of newestFirst.slice(KEPT_BACKUPS)) rmSync(join(backupDir, stale));
  }
}

/**
 * Applies pending migrations. When an existing database is about to change, a copy is taken
 * first so a broken migration never costs the user their library.
 */
export async function runMigrations(
  connection: DatabaseConnection,
  options: { migrationsFolder: string; backupDir: string },
): Promise<{ applied: number; backupPath: string | null; fresh: boolean }> {
  const applied = countAppliedMigrations(connection);
  // No migration applied yet: a database created just now (a new profile).
  const fresh = applied === 0;
  const bundled = countBundledMigrations(options.migrationsFolder);
  // Older code on a newer schema fails queries or corrupts data without saying so: refuse to open it.
  if (applied > bundled) throw new DatabaseNewerError(applied, bundled);
  const pending = bundled - applied;
  if (pending <= 0) return { applied: 0, backupPath: null, fresh };

  let backupPath: string | null = null;
  if (applied > 0) {
    mkdirSync(options.backupDir, { recursive: true });
    backupPath = join(options.backupDir, `data-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    await connection.sqlite.backup(backupPath);
    pruneBackups(options.backupDir);
  }

  migrate(connection.db, { migrationsFolder: options.migrationsFolder });
  return { applied: pending, backupPath, fresh };
}
