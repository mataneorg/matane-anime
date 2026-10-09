import { AppError, type BackupManifest, backupManifestSchema } from '@matane-anime/shared';
import { type ZipEntry, type ZipLimits, readZip } from './zip';

export const MANIFEST_FILE = 'manifest.json';
export const DATABASE_FILE = 'data.db';
export const COVERS_PREFIX = 'covers/';

const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_DATABASE_BYTES = 1024 * 1024 * 1024;
const MAX_COVER_BYTES = 10 * 1024 * 1024;
const MAX_COVERS = 50_000;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const SQLITE_HEADER = 'SQLite format 3\0';

/** Covers are saved as `<anime id>.<ext>` (library/covers.ts); anything else in the folder is refused. */
const COVER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function isCoverFile(name: string): boolean {
  return COVER_NAME.test(name) && !name.includes('..');
}

const LIMITS: ZipLimits = {
  maxEntries: MAX_COVERS + 2,
  maxEntryBytes: (name) =>
    name === MANIFEST_FILE ? MAX_MANIFEST_BYTES : name === DATABASE_FILE ? MAX_DATABASE_BYTES : MAX_COVER_BYTES,
  maxTotalBytes: MAX_TOTAL_BYTES,
};

export interface ParsedBackup {
  manifest: BackupManifest;
  database: Buffer;
  /** File name inside the covers folder to its bytes. */
  covers: Map<string, Buffer>;
}

function refuse(message: string): AppError {
  return new AppError('invalid_input', `This is not a valid backup file: ${message}`);
}

/**
 * Reads and checks a backup archive without touching anything on disk: only `manifest.json`, `data.db` and
 * `covers/<file>` are accepted (so no entry can point outside the folder it is unpacked into), the manifest
 * has to match the schema, and a database from a newer app version than this one is refused.
 */
export function parseBackup(bytes: Buffer, bundledMigrations: number): ParsedBackup {
  if (bytes.length > MAX_ARCHIVE_BYTES) throw refuse('it is too large.');
  const entries = readZip(bytes, LIMITS);
  const byName = new Map<string, ZipEntry>(entries.map((entry) => [entry.name, entry]));
  for (const { name } of entries) {
    if (name === MANIFEST_FILE || name === DATABASE_FILE) continue;
    if (name.startsWith(COVERS_PREFIX) && isCoverFile(name.slice(COVERS_PREFIX.length))) continue;
    throw refuse(`it holds an unexpected file ("${name}").`);
  }
  const manifestEntry = byName.get(MANIFEST_FILE);
  const databaseEntry = byName.get(DATABASE_FILE);
  if (!manifestEntry || !databaseEntry) throw refuse('it has no manifest or no database.');

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestEntry.data));
  } catch {
    throw refuse('its manifest is not valid JSON.');
  }
  const manifest = backupManifestSchema.safeParse(json);
  if (!manifest.success) throw refuse('its manifest is not one this app understands.');
  if (manifest.data.schemaVersion > bundledMigrations) {
    throw new AppError(
      'unsupported',
      'This backup was made by a newer version of Matane Anime. Update the app, then restore it.',
    );
  }
  if (databaseEntry.data.subarray(0, SQLITE_HEADER.length).toString('latin1') !== SQLITE_HEADER) {
    throw refuse('its database is not a SQLite file.');
  }

  const covers = new Map<string, Buffer>();
  for (const entry of entries) {
    if (entry.name.startsWith(COVERS_PREFIX)) covers.set(entry.name.slice(COVERS_PREFIX.length), entry.data);
  }
  return { manifest: manifest.data, database: databaseEntry.data, covers };
}
