import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ExtensionManifest } from '@matane-anime/extension-sdk/manifest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type DatabaseConnection, openDatabase } from '../client';
import { runMigrations } from '../migrate';
import { AnimeRepository } from '../repositories/anime';
import { ChangeEmitter } from '../repositories/changes';
import { EpisodesRepository } from '../repositories/episodes';
import { ExtensionStore } from '../repositories/extension-store';

const migrationsFolder = resolve(__dirname, '../../../../drizzle');
const manifest: ExtensionManifest = {
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

let dir: string;
let connection: DatabaseConnection;
let changes: ChangeEmitter;
let emitted: string[][];
let store: ExtensionStore;
let animeRepo: AnimeRepository;
let episodeRepo: EpisodesRepository;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'matane-anime-catalog-'));
  connection = openDatabase(join(dir, 'data.db'));
  await runMigrations(connection, { migrationsFolder, backupDir: join(dir, 'backups') });
  changes = new ChangeEmitter();
  emitted = [];
  changes.subscribe((change) => emitted.push(change.tags));
  store = new ExtensionStore(connection.db, changes);
  animeRepo = new AnimeRepository(connection.db, changes);
  episodeRepo = new EpisodesRepository(connection.db, changes);
  store.upsertExtension(manifest, 1000);
});
afterEach(() => {
  connection.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('ExtensionStore', () => {
  it('records the extension and its sources, and keeps pins and usage on reload', () => {
    expect(
      store
        .listSources()
        .map((s) => s.id)
        .sort(),
    ).toEqual(['example/en', 'example/id']);
    store.setPinned('example/en', true);
    store.touchSource('example/en', 5000);
    store.upsertExtension(
      { ...manifest, version: '1.1.0', sources: [{ key: 'en', lang: 'en', name: 'Renamed' }] },
      2000,
    );
    expect(store.getSource('example/en')).toMatchObject({ name: 'Renamed', pinned: true, lastUsedAt: 5000 });
    // A source the new manifest dropped stays: library entries still point at it.
    expect(store.getSource('example/id')).toBeDefined();
    expect(emitted.flat()).toContain('sources');
  });

  it('keeps preferences and storage per extension', () => {
    store.setPref('example', 'baseUrl', 'http://x');
    store.setPref('example', 'showDub', false);
    store.setPref('example', 'showDub', true);
    expect(store.getPrefs('example')).toEqual({ baseUrl: 'http://x', showDub: true });
    expect(store.getPrefs('other')).toEqual({});

    expect(store.storageGet('example', 'k')).toBeNull();
    store.storageSet('example', 'k', { a: [1] });
    expect(store.storageGet('example', 'k')).toEqual({ a: [1] });
    store.storageRemove('example', 'k');
    expect(store.storageGet('example', 'k')).toBeNull();
  });
});

describe('AnimeRepository', () => {
  it('upserts listings by (source, url) and keeps what the detail page knew', () => {
    const [first] = animeRepo.upsertSummaries(
      'example/en',
      [{ url: '/a', title: 'A', thumbnailUrl: 'http://x/a.jpg' }],
      10,
    );
    expect(first).toMatchObject({ url: '/a', title: 'A', inLibrary: false, thumbnailUrl: 'http://x/a.jpg' });
    animeRepo.saveDetails(
      first!.id,
      { url: '/a', title: 'A (full)', status: 'ongoing', genres: ['x'], year: 2020 },
      20,
    );

    const [again] = animeRepo.upsertSummaries('example/en', [{ url: '/a', title: 'A renamed' }], 30);
    expect(again!.id).toBe(first!.id);
    expect(again).toMatchObject({ title: 'A renamed', status: 'ongoing', year: 2020, thumbnailUrl: 'http://x/a.jpg' });
    expect(animeRepo.find('example/id', '/a')).toBeUndefined();
  });

  it('returns rows in the order given, collapses duplicates and handles an empty page', () => {
    const rows = animeRepo.upsertSummaries('example/en', [
      { url: '/b', title: 'B' },
      { url: '/a', title: 'A' },
      { url: '/b', title: 'B again' },
    ]);
    expect(animeRepo.find('example/en', '/b')!.title).toBe('B');
    expect(rows.map((row) => row.url)).toEqual(['/b', '/a', '/b']);
    expect(rows[0]!.id).toBe(rows[2]!.id);
    expect(animeRepo.upsertSummaries('example/en', [])).toEqual([]);
  });

  it('does not touch the library flag or the date it was added', () => {
    const [row] = animeRepo.upsertSummaries('example/en', [{ url: '/a', title: 'A' }]);
    connection.sqlite.prepare('update anime set in_library = 1, added_at = 99 where id = ?').run(row!.id);
    animeRepo.upsertSummaries('example/en', [{ url: '/a', title: 'A' }]);
    animeRepo.saveDetails(row!.id, { url: '/a', title: 'A', status: 'completed' });
    expect(animeRepo.get(row!.id)).toMatchObject({ inLibrary: true, addedAt: 99 });
  });

  it('stores details as JSON and tags the change', () => {
    const [row] = animeRepo.upsertSummaries('example/en', [{ url: '/a', title: 'A' }]);
    emitted.length = 0;
    animeRepo.saveDetails(
      row!.id,
      { url: '/a', title: 'A', status: 'unknown', altTitles: ['Aa'], genres: ['g1', 'g2'], type: 'movie' },
      55,
      777,
    );
    const saved = animeRepo.get(row!.id)!;
    expect(JSON.parse(saved.altTitlesJson)).toEqual(['Aa']);
    expect(JSON.parse(saved.genresJson)).toEqual(['g1', 'g2']);
    expect(saved).toMatchObject({ type: 'movie', lastUpdateCheckAt: 55, latestEpisodeAt: 777 });
    expect(emitted).toEqual([[`anime:${row!.id}`]]);
  });
});

describe('EpisodesRepository.sync', () => {
  const ep = (n: number, extra: Record<string, unknown> = {}) => ({
    url: `/e/${n}`,
    name: `Ep ${n}`,
    number: n,
    ...extra,
  });
  let animeId: number;
  beforeEach(() => {
    animeId = animeRepo.upsertSummaries('example/en', [{ url: '/a', title: 'A' }])[0]!.id;
  });

  it('inserts new episodes in source order and stamps fetchedAt only on new rows', () => {
    expect(episodeRepo.sync(animeId, [ep(3), ep(2), ep(1)], 100)).toMatchObject({ added: 3, missing: 0 });
    expect(episodeRepo.list(animeId).map((e) => [e.number, e.sourceOrder, e.fetchedAt])).toEqual([
      [3, 0, 100],
      [2, 1, 100],
      [1, 2, 100],
    ]);
    expect(episodeRepo.sync(animeId, [ep(4), ep(3), ep(2), ep(1)], 200)).toMatchObject({ added: 1 });
    expect(episodeRepo.list(animeId).map((e) => [e.number, e.fetchedAt])).toEqual([
      [4, 200],
      [3, 100],
      [2, 100],
      [1, 100],
    ]);
  });

  it('keeps progress when an episode is seen again, and updates its fields', () => {
    episodeRepo.sync(animeId, [ep(1)], 100);
    const [row] = episodeRepo.list(animeId);
    connection.sqlite.prepare('update episodes set watched = 1, position_ms = 5000 where id = ?').run(row!.id);
    episodeRepo.sync(animeId, [ep(1, { name: 'Renamed', variant: 'Dub' })], 200);
    expect(episodeRepo.get(row!.id)).toMatchObject({
      name: 'Renamed',
      variant: 'Dub',
      watched: true,
      positionMs: 5000,
      fetchedAt: 100,
    });
  });

  it('marks episodes that dropped out as missing (when something hangs on them), and restores them if they return', () => {
    episodeRepo.sync(animeId, [ep(2), ep(1)], 100);
    // Episode 1 has a saved position, so it is kept (UPD-5 has the full matrix in updates.test.ts).
    episodeRepo.saveProgress(episodeRepo.list(animeId).find((e) => e.number === 1)!.id, 5000, null);
    expect(episodeRepo.sync(animeId, [ep(2)], 200)).toMatchObject({ added: 0, missing: 1 });
    expect(episodeRepo.list(animeId).map((e) => [e.number, e.sourceMissing])).toEqual([
      [2, false],
      [1, true],
    ]);
    episodeRepo.sync(animeId, [ep(2), ep(1)], 300);
    expect(episodeRepo.list(animeId).every((e) => !e.sourceMissing)).toBe(true);
  });

  it('changes nothing when the source returns an empty list', () => {
    episodeRepo.sync(animeId, [ep(1)], 100);
    emitted.length = 0;
    expect(episodeRepo.sync(animeId, [], 200)).toEqual({
      added: 0,
      addedIds: [],
      missing: 0,
      removed: 0,
      latestUploadedAt: undefined,
    });
    expect(episodeRepo.list(animeId).map((e) => e.sourceMissing)).toEqual([false]);
    expect(emitted).toEqual([]);
  });

  it('collapses a url the source listed twice and reports the newest upload', () => {
    const result = episodeRepo.sync(
      animeId,
      [ep(1, { uploadedAt: 10 }), ep(2, { uploadedAt: 30 }), ep(1, { uploadedAt: 99 })],
      100,
    );
    expect(result).toMatchObject({ added: 2, latestUploadedAt: 30 });
    expect(episodeRepo.list(animeId)).toHaveLength(2);
  });
});
