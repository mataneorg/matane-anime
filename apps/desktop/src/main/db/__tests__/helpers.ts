import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ExtensionManifest } from '@matane-anime/extension-sdk/manifest';
import { type DatabaseConnection, openDatabase } from '../client';
import { runMigrations } from '../migrate';
import { AnimeRepository } from '../repositories/anime';
import { ChangeEmitter } from '../repositories/changes';
import { DownloadsRepository } from '../repositories/downloads';
import { EpisodesRepository } from '../repositories/episodes';
import { ExtensionStore } from '../repositories/extension-store';
import { HistoryRepository } from '../repositories/history';
import { LibraryRepository } from '../repositories/library';
import { SettingsRepository } from '../repositories/settings';
import { WatchSessionsRepository } from '../repositories/watch-sessions';

const migrationsFolder = resolve(__dirname, '../../../../drizzle');

export const manifest: ExtensionManifest = {
  id: 'example',
  name: 'Example',
  version: '1.0.0',
  apiVersion: 1,
  type: 'anime',
  nsfw: false,
  sources: [
    { key: 'en', lang: 'en', name: 'Example (EN)' },
    { key: 'id', lang: 'id', name: 'Example (ID)' },
  ],
};

export interface TestDb {
  dir: string;
  connection: DatabaseConnection;
  changes: ChangeEmitter;
  emitted: string[][];
  store: ExtensionStore;
  anime: AnimeRepository;
  downloads: DownloadsRepository;
  episodes: EpisodesRepository;
  history: HistoryRepository;
  library: LibraryRepository;
  sessions: WatchSessionsRepository;
  settings: SettingsRepository;
  close(): void;
}

/** A real database with every migration, and the repositories on top of it. */
export async function createTestDb(): Promise<TestDb> {
  const dir = mkdtempSync(join(tmpdir(), 'matane-anime-test-'));
  const connection = openDatabase(join(dir, 'data.db'));
  await runMigrations(connection, { migrationsFolder, backupDir: join(dir, 'backups') });
  const changes = new ChangeEmitter();
  const emitted: string[][] = [];
  changes.subscribe((change) => emitted.push(change.tags));
  const store = new ExtensionStore(connection.db, changes);
  store.upsertExtension(manifest, 1000);
  return {
    dir,
    connection,
    changes,
    emitted,
    store,
    anime: new AnimeRepository(connection.db, changes),
    downloads: new DownloadsRepository(connection.db, changes),
    episodes: new EpisodesRepository(connection.db, changes),
    history: new HistoryRepository(connection.db, changes),
    library: new LibraryRepository(connection.db, changes),
    sessions: new WatchSessionsRepository(connection.db),
    settings: new SettingsRepository(connection.db),
    close() {
      connection.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
