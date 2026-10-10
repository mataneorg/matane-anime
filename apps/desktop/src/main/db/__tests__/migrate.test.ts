import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DEFAULT_SETTINGS } from '@matane-anime/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../client';
import { DatabaseNewerError, runMigrations } from '../migrate';
import { SettingsRepository } from '../repositories/settings';

const migrationsFolder = resolve(__dirname, '../../../../drizzle');
const EXPECTED_TABLES = [
  'anime',
  'anime_categories',
  'anime_fts',
  'anime_tracks',
  'categories',
  'downloads',
  'episodes',
  'extension_prefs',
  'extension_repos',
  'extension_storage',
  'extensions',
  'history',
  'image_cache',
  'settings',
  'sources',
  'tracker_accounts',
  'tracker_queue',
  'watch_sessions',
];

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'matane-anime-db-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function freshDatabase() {
  const dir = tempDir();
  const connection = openDatabase(join(dir, 'data.db'));
  const result = await runMigrations(connection, { migrationsFolder, backupDir: join(dir, 'backups') });
  return { dir, connection, result };
}

function insertAnime(
  sqlite: ReturnType<typeof openDatabase>['sqlite'],
  title: string,
  altTitles: string[],
  url = `/${title}`,
): number {
  sqlite
    .prepare(
      "INSERT OR IGNORE INTO sources (id, extension_id, key, name, lang) VALUES ('ex/en', 'ex', 'en', 'Example', 'en')",
    )
    .run();
  const info = sqlite
    .prepare(
      'INSERT INTO anime (source_id, url, title, alt_titles_json, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0)',
    )
    .run('ex/en', url, title, JSON.stringify(altTitles));
  return Number(info.lastInsertRowid);
}

describe('database migrations', () => {
  it('creates every table from docs/PRD.md §9', async () => {
    const { connection, result } = await freshDatabase();
    const tables = connection.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_\\_%' ESCAPE '\\' AND name NOT LIKE 'anime_fts_%' AND name NOT LIKE 'sqlite_%'",
      )
      .all()
      .map((row) => (row as { name: string }).name)
      .sort();
    expect(tables).toEqual(EXPECTED_TABLES);
    // A brand-new database has nothing worth backing up.
    expect(result.backupPath).toBeNull();
    expect(result.fresh).toBe(true);
    connection.sqlite.close();
  });

  it('keeps anime and episodes unique per source and anime', async () => {
    const { connection } = await freshDatabase();
    const animeId = insertAnime(connection.sqlite, 'Tsuki no Shiori', []);
    expect(() => insertAnime(connection.sqlite, 'Duplicate', [], '/Tsuki no Shiori')).toThrow(/UNIQUE/);

    const addEpisode = (url: string) =>
      connection.sqlite
        .prepare('INSERT INTO episodes (anime_id, url, name, fetched_at) VALUES (?, ?, ?, 0)')
        .run(animeId, url, url);
    addEpisode('/ep/1');
    expect(() => addEpisode('/ep/1')).toThrow(/UNIQUE/);
    connection.sqlite.close();
  });

  it('cascades episodes and history when an anime is deleted, but keeps sources', async () => {
    const { connection } = await freshDatabase();
    const { sqlite } = connection;
    const animeId = insertAnime(sqlite, 'A', []);
    const episodeId = Number(
      sqlite
        .prepare('INSERT INTO episodes (anime_id, url, name, fetched_at) VALUES (?, ?, ?, 0)')
        .run(animeId, '/1', '1').lastInsertRowid,
    );
    sqlite.prepare('INSERT INTO history (anime_id, episode_id, watched_at) VALUES (?, ?, 0)').run(animeId, episodeId);
    sqlite.prepare('INSERT INTO downloads (episode_id, kind, created_at) VALUES (?, ?, 0)').run(episodeId, 'hls');

    sqlite.prepare('DELETE FROM anime WHERE id = ?').run(animeId);
    for (const table of ['episodes', 'history', 'downloads']) {
      expect((sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n).toBe(0);
    }
    expect((sqlite.prepare('SELECT count(*) AS n FROM sources').get() as { n: number }).n).toBe(1);
    sqlite.close();
  });

  describe('anime_fts', () => {
    const search = (sqlite: ReturnType<typeof openDatabase>['sqlite'], query: string): number[] =>
      sqlite
        .prepare('SELECT rowid FROM anime_fts WHERE anime_fts MATCH ? ORDER BY rowid')
        .all(query)
        .map((row) => (row as { rowid: number }).rowid);

    it('finds anime by title and by alternative title, ignoring diacritics', async () => {
      const { connection } = await freshDatabase();
      const { sqlite } = connection;
      const a = insertAnime(sqlite, 'Tsuki no Shiori', ["Moon's Bookmark", 'Tsuki no Shiori: Quiet Harbour']);
      const b = insertAnime(sqlite, 'Hoshizora Café', ['Starry Sky Cafe']);
      expect(search(sqlite, 'shiori')).toEqual([a]);
      expect(search(sqlite, 'bookmark')).toEqual([a]);
      expect(search(sqlite, 'cafe')).toEqual([b]);
      expect(search(sqlite, 'starry')).toEqual([b]);
      sqlite.close();
    });

    it('follows updates and deletes', async () => {
      const { connection } = await freshDatabase();
      const { sqlite } = connection;
      const id = insertAnime(sqlite, 'Old Name', ['Old Alias']);
      sqlite
        .prepare('UPDATE anime SET title = ?, alt_titles_json = ? WHERE id = ?')
        .run('New Name', '["New Alias"]', id);
      expect(search(sqlite, 'old')).toEqual([]);
      expect(search(sqlite, 'new')).toEqual([id]);
      expect(search(sqlite, 'alias')).toEqual([id]);

      sqlite.prepare('DELETE FROM anime WHERE id = ?').run(id);
      expect(search(sqlite, 'new')).toEqual([]);
      sqlite.close();
    });
  });

  it('backs up an existing database before applying a new migration and keeps the last 3', async () => {
    const dir = tempDir();
    const connection = openDatabase(join(dir, 'data.db'));
    const backupDir = join(dir, 'backups');
    // Pretend the first migration ran earlier: copy the folder with only the first entry in its journal.
    const { cpSync, readFileSync, writeFileSync } = await import('node:fs');
    const partial = join(dir, 'partial');
    cpSync(migrationsFolder, partial, { recursive: true });
    const journal = JSON.parse(readFileSync(join(partial, 'meta/_journal.json'), 'utf8')) as { entries: unknown[] };
    const full = [...journal.entries];
    journal.entries = full.slice(0, 1);
    writeFileSync(join(partial, 'meta/_journal.json'), JSON.stringify(journal));
    await runMigrations(connection, { migrationsFolder: partial, backupDir });
    expect(readdirSync(dir)).not.toContain('backups');

    const result = await runMigrations(connection, { migrationsFolder, backupDir });
    expect(result.applied).toBe(full.length - 1);
    expect(result.backupPath).not.toBeNull();
    expect(readdirSync(backupDir).filter((name) => name.endsWith('.db'))).toHaveLength(1);
    connection.sqlite.close();
  });

  it('refuses a database that a newer version already migrated, and leaves it untouched', async () => {
    const dir = tempDir();
    const connection = openDatabase(join(dir, 'data.db'));
    const backupDir = join(dir, 'backups');
    await runMigrations(connection, { migrationsFolder, backupDir });
    // An older build only knows the first migration of the folder.
    const { cpSync, readFileSync, writeFileSync } = await import('node:fs');
    const older = join(dir, 'older');
    cpSync(migrationsFolder, older, { recursive: true });
    const journal = JSON.parse(readFileSync(join(older, 'meta/_journal.json'), 'utf8')) as { entries: unknown[] };
    journal.entries = journal.entries.slice(0, 1);
    writeFileSync(join(older, 'meta/_journal.json'), JSON.stringify(journal));

    await expect(runMigrations(connection, { migrationsFolder: older, backupDir })).rejects.toBeInstanceOf(
      DatabaseNewerError,
    );
    expect(readdirSync(dir)).not.toContain('backups');
    connection.sqlite.close();
  });
});

describe('backups taken before a migration', () => {
  it('keeps its own last copies per kind, so a restore safety copy never costs the migration copy', async () => {
    const dir = tempDir();
    const connection = openDatabase(join(dir, 'data.db'));
    const backupDir = join(dir, 'backups');
    const { cpSync, mkdirSync, readFileSync, writeFileSync } = await import('node:fs');
    const partial = join(dir, 'partial');
    cpSync(migrationsFolder, partial, { recursive: true });
    const journal = JSON.parse(readFileSync(join(partial, 'meta/_journal.json'), 'utf8')) as { entries: unknown[] };
    journal.entries = journal.entries.slice(0, 1);
    writeFileSync(join(partial, 'meta/_journal.json'), JSON.stringify(journal));
    await runMigrations(connection, { migrationsFolder: partial, backupDir });

    // Three safety copies of earlier restores sort after every `data-` name.
    mkdirSync(backupDir, { recursive: true });
    const safety = ['2026-01-01', '2026-01-02', '2026-01-03'].map((day) => `pre-restore-${day}.db`);
    for (const name of safety) writeFileSync(join(backupDir, name), 'x');

    const result = await runMigrations(connection, { migrationsFolder, backupDir });
    expect(result.backupPath).not.toBeNull();
    const names = readdirSync(backupDir).sort();
    expect(names.filter((name) => name.startsWith('pre-restore-'))).toEqual(safety);
    expect(names.filter((name) => name.startsWith('data-'))).toHaveLength(1);
    connection.sqlite.close();
  });
});

describe('SettingsRepository', () => {
  it('returns defaults, stores patches and survives a corrupt value', async () => {
    const { connection } = await freshDatabase();
    const repo = new SettingsRepository(connection.db);
    expect(repo.getAppSettings()).toEqual(DEFAULT_SETTINGS);

    const updated = repo.updateAppSettings({ theme: 'latte', accent: 'peach' });
    expect(updated).toMatchObject({ theme: 'latte', accent: 'peach', amoled: false });

    connection.sqlite.prepare("UPDATE settings SET value_json = '\"not-a-theme\"' WHERE key = 'theme'").run();
    connection.sqlite.prepare("UPDATE settings SET value_json = '{oops' WHERE key = 'accent'").run();
    expect(repo.getAppSettings()).toMatchObject({ theme: 'mocha', accent: 'mauve' });

    repo.setValue('window.state', { width: 800, height: 600, maximized: true });
    expect(repo.getValue('window.state', null)).toEqual({ width: 800, height: 600, maximized: true });
    expect(repo.getValue('missing', 42)).toBe(42);
    connection.sqlite.close();
  });
});
