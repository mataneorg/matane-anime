import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type BackupManifest, KEEP_AUTO_BACKUPS } from '@matane-anime/shared';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../../db/client';
import { countBundledMigrations, runMigrations } from '../../db/migrate';
import { type TestDb, createTestDb, manifest as extensionManifest } from '../../db/__tests__/helpers';
import { parseBackup } from '../archive';
import { createBackup } from '../create';
import { applyPendingRestore, stageBackup } from '../restore';
import { BackupService } from '../service';
import { readZip, writeZip } from '../zip';

const migrationsFolder = resolve(__dirname, '../../../../drizzle');
const bundled = countBundledMigrations(migrationsFolder);
const NOW = new Date('2026-10-09T10:00:00.000Z');

let db: TestDb;
let work: string;
beforeEach(async () => {
  db = await createTestDb();
  work = mkdtempSync(join(tmpdir(), 'matane-anime-backup-'));
});
afterEach(() => {
  db.close();
  rmSync(work, { recursive: true, force: true });
});

/** A live profile with something of everything the backup has to keep or drop. */
function populate(coversDir: string) {
  mkdirSync(coversDir, { recursive: true });
  const [kept, browsed, downloaded] = db.anime.upsertSummaries(
    'example/en',
    [
      { url: '/kept', title: 'Kept' },
      { url: '/browsed', title: 'Browsed' },
      { url: '/downloaded', title: 'Downloaded' },
    ],
    1000,
  );
  for (const row of [kept!, browsed!, downloaded!]) {
    db.episodes.sync(row.id, [{ url: `/${row.id}/1`, name: 'Ep 1', number: 1 }], 1);
  }
  db.library.add(kept!.id, [], 2000);
  const keptEpisode = db.episodes.list(kept!.id)[0]!;
  db.episodes.saveProgress(keptEpisode.id, 4000, 100_000);
  db.history.touch(kept!.id, keptEpisode.id, 3000);
  db.downloads.insert({ episodeId: db.episodes.list(downloaded!.id)[0]!.id, kind: 'hls', sizeBytes: 10, now: 1 });

  const cover = join(coversDir, `${kept!.id}.jpg`);
  writeFileSync(cover, 'jpeg-bytes');
  db.anime.setCoverPath(kept!.id, cover);
  const strayCover = join(coversDir, 'stray.jpg');
  writeFileSync(strayCover, 'not referenced');

  db.settings.setValue('theme', 'latte');
  db.settings.setValue('downloadFolder', join(work, 'gone'));
  db.settings.setValue('network.proxyPassword', 'hunter2');
  db.settings.setValue('window.state', { width: 1, height: 1 });
  db.store.upsertExtension({ ...extensionManifest, id: 'repoext', name: 'Repo ext' }, 1000, {
    repoId: null,
    installDir: '/old/machine/extensions/repoext',
    sha256: 'abc',
  });
  db.connection.sqlite.prepare('INSERT INTO extension_repos (url, serial) VALUES (?, 1)').run('https://example.org/');
  return { kept: kept!.id };
}

async function makeBackup(userData: string) {
  const out = join(work, 'backup.zip');
  const manifest = await createBackup({
    sqlite: db.connection.sqlite,
    coversDir: join(userData, 'covers'),
    workDir: join(work, 'tmp'),
    appVersion: '1.2.3',
    now: NOW,
    outPath: out,
  });
  return { out, manifest };
}

describe('createBackup', () => {
  it('keeps the user data and drops downloads, browse-only rows, secrets and machine state', async () => {
    const userData = join(work, 'source');
    populate(join(userData, 'covers'));
    const { out, manifest } = await makeBackup(userData);

    expect(manifest).toMatchObject({
      format: 1,
      appVersion: '1.2.3',
      schemaVersion: bundled,
      createdAt: NOW.toISOString(),
    });
    expect(manifest.counts).toEqual({
      anime: 1,
      episodes: 1,
      categories: 0,
      history: 1,
      covers: 1,
      repositories: 1,
      extensions: 1,
    });

    const entries = readZip(readFileSync(out), {
      maxEntries: 100,
      maxEntryBytes: () => 1 << 30,
      maxTotalBytes: 1 << 30,
    });
    expect(entries.map((e) => e.name).sort()).toEqual(['covers/1.jpg', 'data.db', 'manifest.json']);

    const copy = join(work, 'inspect.db');
    writeFileSync(copy, entries.find((e) => e.name === 'data.db')!.data);
    const sqlite = new Database(copy, { readonly: true });
    const one = (sql: string) => sqlite.prepare(sql).get();
    expect(one('SELECT count(*) AS n FROM downloads')).toEqual({ n: 0 });
    expect(one('SELECT title, cover_path AS cover FROM anime WHERE in_library = 1')).toEqual({
      title: 'Kept',
      cover: '1.jpg',
    });
    expect(one("SELECT count(*) AS n FROM settings WHERE key IN ('window.state', 'network.proxyPassword')")).toEqual({
      n: 0,
    });
    expect(one("SELECT value_json AS v FROM settings WHERE key = 'theme'")).toEqual({ v: '"latte"' });
    expect(one("SELECT install_dir AS dir, sha256 FROM extensions WHERE id = 'repoext'")).toEqual({
      dir: null,
      sha256: null,
    });
    // The snapshot is of the open database; the live one is untouched.
    expect(db.connection.sqlite.prepare('SELECT count(*) AS n FROM downloads').get()).toEqual({ n: 1 });
    expect(db.settings.getValue('network.proxyPassword', null)).toBe('hunter2');
    sqlite.close();
    expect(readdirSync(join(work, 'tmp'))).toEqual([]);
  });
});

describe('parseBackup', () => {
  const goodManifest: BackupManifest = {
    format: 1,
    appVersion: '1.0.0',
    schemaVersion: 1,
    createdAt: NOW.toISOString(),
    counts: { anime: 0, episodes: 0, categories: 0, history: 0, covers: 0, repositories: 0, extensions: 0 },
  };
  const sqliteBytes = Buffer.concat([Buffer.from('SQLite format 3\0', 'latin1'), Buffer.alloc(100)]);
  const archive = (extra: { name: string; data: Buffer }[] = [], manifest: unknown = goodManifest) =>
    writeZip([
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) },
      { name: 'data.db', data: sqliteBytes },
      ...extra,
    ]);

  it('accepts a well-formed archive', () => {
    const parsed = parseBackup(archive([{ name: 'covers/3.png', data: Buffer.from('x') }]), bundled);
    expect(parsed.manifest.schemaVersion).toBe(1);
    expect([...parsed.covers.keys()]).toEqual(['3.png']);
  });

  it.each([
    '../evil.txt',
    'covers/../../evil.png',
    '/abs.txt',
    'covers/sub/dir.png',
    'extensions/x/index.js',
    'covers/.hidden',
    'C:\\x',
  ])('refuses the entry %s', (name) => {
    expect(() => parseBackup(archive([{ name, data: Buffer.from('x') }]), bundled)).toThrow(
      /unexpected file|not a valid/,
    );
  });

  it('refuses a database from a newer app', () => {
    expect(() => parseBackup(archive([], { ...goodManifest, schemaVersion: bundled + 1 }), bundled)).toThrow(
      /newer version/,
    );
  });

  it('refuses a bad manifest, a missing database and things that are not zips', () => {
    expect(() => parseBackup(archive([], { format: 2 }), bundled)).toThrow(/manifest/);
    expect(() => parseBackup(writeZip([{ name: 'manifest.json', data: Buffer.from('{}') }]), bundled)).toThrow();
    expect(() => parseBackup(Buffer.from('hello'), bundled)).toThrow(/not a zip/);
    expect(() =>
      parseBackup(
        writeZip([
          { name: 'manifest.json', data: Buffer.from(JSON.stringify(goodManifest)) },
          { name: 'data.db', data: Buffer.from('not a database') },
        ]),
        bundled,
      ),
    ).toThrow(/SQLite/);
  });

  it('refuses a corrupted entry and an oversized cover', () => {
    const bytes = archive([{ name: 'covers/1.jpg', data: Buffer.from('some cover bytes') }]);
    const damaged = Buffer.from(bytes);
    const at = damaged.indexOf(Buffer.from('some cover bytes'));
    damaged.writeUInt8(damaged.readUInt8(at) ^ 0xff, at);
    expect(() => parseBackup(damaged, bundled)).toThrow(/damaged/);
    expect(() =>
      parseBackup(archive([{ name: 'covers/1.jpg', data: Buffer.alloc(11 * 1024 * 1024) }]), bundled),
    ).toThrow(/too large/);
  });
});

describe('restore', () => {
  /** A target profile that already holds other data. */
  async function existingProfile(userData: string, downloadFolder: string) {
    mkdirSync(join(userData, 'covers'), { recursive: true });
    writeFileSync(join(userData, 'covers', 'old.jpg'), 'old cover');
    const live = openDatabase(join(userData, 'data.db'));
    await runMigrations(live, { migrationsFolder, backupDir: join(userData, 'backups', 'db') });
    live.sqlite.prepare("INSERT INTO settings (key, value_json) VALUES ('marker', '\"before\"')").run();
    live.sqlite
      .prepare('INSERT INTO settings (key, value_json) VALUES (?, ?)')
      .run('downloadFolder', JSON.stringify(downloadFolder));
    // Left in the -wal on purpose: the safety copy has to include it.
    live.sqlite.close();
  }

  it('round-trips: stage, apply on the next start, migrate, and keep a safety copy', async () => {
    const source = join(work, 'source');
    const { kept } = populate(join(source, 'covers'));
    const { out } = await makeBackup(source);

    const target = join(work, 'target');
    await existingProfile(target, join(work, 'gone'));
    const parsed = parseBackup(readFileSync(out), bundled);
    const staged = stageBackup(parsed, { userData: target, bundledMigrations: bundled });
    expect(staged.extensionsToReinstall).toEqual(['repoext']);
    // Nothing of the live data moved yet.
    expect(
      new Database(join(target, 'data.db'), { readonly: true }).prepare('SELECT count(*) AS n FROM anime').get(),
    ).toEqual({ n: 0 });

    const outcome = applyPendingRestore({
      userData: target,
      bundledMigrations: bundled,
      now: NOW,
      folderExists: existsSync,
    });
    expect(outcome.status).toBe('applied');
    expect(existsSync(join(target, 'restore-pending'))).toBe(false);

    const safety = readdirSync(join(target, 'backups', 'db')).filter((n) => n.startsWith('pre-restore-'));
    expect(safety).toHaveLength(1);
    const before = new Database(join(target, 'backups', 'db', safety[0]!), { readonly: true });
    expect(before.prepare("SELECT value_json AS v FROM settings WHERE key = 'marker'").get()).toEqual({
      v: '"before"',
    });
    before.close();

    const restored = openDatabase(join(target, 'data.db'));
    const result = await runMigrations(restored, { migrationsFolder, backupDir: join(target, 'backups', 'db') });
    expect(result.applied).toBe(0);
    const one = (sql: string) => restored.sqlite.prepare(sql).get();
    expect(one('SELECT title, cover_path AS cover FROM anime WHERE id = ' + kept)).toEqual({
      title: 'Kept',
      cover: join(target, 'covers', `${kept}.jpg`),
    });
    expect(one('SELECT count(*) AS n FROM history')).toEqual({ n: 1 });
    expect(one("SELECT count(*) AS n FROM settings WHERE key = 'marker'")).toEqual({ n: 0 });
    expect(one("SELECT value_json AS v FROM settings WHERE key = 'theme'")).toEqual({ v: '"latte"' });
    // The folder on the old machine does not exist here: back to the default.
    expect(one("SELECT count(*) AS n FROM settings WHERE key = 'downloadFolder'")).toEqual({ n: 0 });
    expect(one("SELECT origin, install_dir AS dir FROM extensions WHERE id = 'repoext'")).toEqual({
      origin: 'repo',
      dir: null,
    });
    expect(restored.sqlite.pragma('foreign_key_check')).toEqual([]);
    restored.sqlite.close();
    expect(readdirSync(join(target, 'covers'))).toEqual([`${kept}.jpg`]);
    expect(readFileSync(join(target, 'covers', `${kept}.jpg`), 'utf8')).toBe('jpeg-bytes');
  });

  it('keeps a download folder that still exists', async () => {
    const source = join(work, 'source');
    populate(join(source, 'covers'));
    const folder = join(work, 'downloads');
    mkdirSync(folder);
    db.settings.setValue('downloadFolder', folder);
    const { out } = await makeBackup(source);
    const target = join(work, 'target');
    mkdirSync(target);
    stageBackup(parseBackup(readFileSync(out), bundled), { userData: target, bundledMigrations: bundled });
    expect(
      applyPendingRestore({ userData: target, bundledMigrations: bundled, now: NOW, folderExists: existsSync }).status,
    ).toBe('applied');
    const restored = new Database(join(target, 'data.db'), { readonly: true });
    expect(restored.prepare("SELECT value_json AS v FROM settings WHERE key = 'downloadFolder'").get()).toEqual({
      v: JSON.stringify(folder),
    });
    restored.close();
  });

  it('drops a backup folder that does not exist on this machine (or is not absolute), keeps one that does', async () => {
    const source = join(work, 'source');
    populate(join(source, 'covers'));
    const here = join(work, 'backups-here');
    mkdirSync(here);
    for (const [saved, kept] of [
      [here, true],
      [join(work, 'gone'), false],
      ['relative/dir', false],
    ] as const) {
      db.settings.setValue('backupFolder', saved);
      const { out } = await makeBackup(source);
      const target = join(work, `target-${String(kept)}-${saved.length}`);
      mkdirSync(target);
      stageBackup(parseBackup(readFileSync(out), bundled), { userData: target, bundledMigrations: bundled });
      applyPendingRestore({ userData: target, bundledMigrations: bundled, now: NOW, folderExists: existsSync });
      const restored = new Database(join(target, 'data.db'), { readonly: true });
      const row = restored.prepare("SELECT value_json AS v FROM settings WHERE key = 'backupFolder'").get();
      restored.close();
      expect(row).toEqual(kept ? { v: JSON.stringify(saved) } : undefined);
    }
  });

  it('does nothing without a pending restore, and leaves the current data when the staged one is broken', async () => {
    const target = join(work, 'target');
    await existingProfile(target, '/x');
    expect(
      applyPendingRestore({ userData: target, bundledMigrations: bundled, now: NOW, folderExists: existsSync }),
    ).toEqual({
      status: 'none',
    });

    mkdirSync(join(target, 'restore-pending', 'covers'), { recursive: true });
    writeFileSync(join(target, 'restore-pending', 'manifest.json'), '{"nope":true}');
    writeFileSync(join(target, 'restore-pending', 'data.db'), 'garbage');
    const outcome = applyPendingRestore({
      userData: target,
      bundledMigrations: bundled,
      now: NOW,
      folderExists: existsSync,
    });
    expect(outcome.status).toBe('failed');
    expect(existsSync(join(target, 'restore-pending'))).toBe(false);
    const live = new Database(join(target, 'data.db'), { readonly: true });
    expect(live.prepare("SELECT value_json AS v FROM settings WHERE key = 'marker'").get()).toEqual({ v: '"before"' });
    live.close();
    expect(readdirSync(join(target, 'covers'))).toEqual(['old.jpg']);
  });

  it('refuses to stage a database that is damaged, and cleans up', () => {
    const target = join(work, 'target');
    mkdirSync(target);
    const parsed = {
      manifest: {
        format: 1 as const,
        appVersion: '1',
        schemaVersion: 1,
        createdAt: NOW.toISOString(),
        counts: { anime: 0, episodes: 0, categories: 0, history: 0, covers: 0, repositories: 0, extensions: 0 },
      },
      database: Buffer.concat([Buffer.from('SQLite format 3\0', 'latin1'), Buffer.alloc(200, 7)]),
      covers: new Map(),
    };
    expect(() => stageBackup(parsed, { userData: target, bundledMigrations: bundled })).toThrow();
    expect(existsSync(join(target, 'restore-pending'))).toBe(false);
  });
});

describe('BackupService', () => {
  it('peeks, then stages on import and asks for a restart once', async () => {
    const source = join(work, 'source');
    populate(join(source, 'covers'));
    const { out } = await makeBackup(source);
    const target = join(work, 'target');
    mkdirSync(target);
    let restarts = 0;
    const service = new BackupService({
      sqlite: db.connection.sqlite,
      userData: target,
      appVersion: '1.2.3',
      bundledMigrations: bundled,
      restart: () => restarts++,
      now: () => NOW,
    });
    expect(service.defaultFileName()).toBe('matane-anime-backup-2026-10-09.zip');
    const preview = service.peek(out);
    expect(preview.fileName).toBe('backup.zip');
    expect(preview.manifest.counts.anime).toBe(1);
    expect(() => service.import('wrong')).toThrow(/no longer selected/);
    const result = service.import(preview.token);
    expect(result).toMatchObject({ extensionsToReinstall: ['repoext'], reloaded: true });
    expect(restarts).toBe(1);
    expect(existsSync(join(target, 'restore-pending', 'data.db'))).toBe(true);
    expect(() => service.import(preview.token)).toThrow();
  });

  describe('automatic backups', () => {
    let clock: Date;
    let auto: 'off' | 'daily' | 'weekly';
    let lastAuto: number | null;
    let folder: string | null;
    let userData: string;

    function build(): BackupService {
      return new BackupService({
        sqlite: db.connection.sqlite,
        userData,
        appVersion: '1.2.3',
        bundledMigrations: bundled,
        restart: () => undefined,
        now: () => clock,
        config: () => ({ auto, folder }),
        lastAuto: {
          get: () => lastAuto,
          set: (ms) => {
            lastAuto = ms;
          },
        },
      });
    }

    beforeEach(() => {
      clock = new Date('2026-10-09T10:00:00.000Z');
      auto = 'daily';
      lastAuto = null;
      folder = null;
      userData = join(work, 'user');
      mkdirSync(userData);
    });

    it('lists nothing before a backup exists, then the files newest first, ignoring other files', async () => {
      const service = build();
      expect(await service.list()).toEqual([]);
      const first = await service.createNow();
      clock = new Date('2026-10-09T10:00:05.000Z');
      const second = await service.createNow(true);
      writeFileSync(join(service.folder().path, 'notes.txt'), 'x');
      writeFileSync(join(service.folder().path, 'matane-anime-backup-x.zip.part'), 'x');
      expect(first.name).toBe('matane-anime-backup-2026-10-09T10-00-00.zip');
      expect(second.name).toBe('matane-anime-auto-2026-10-09T10-00-05.zip');
      const names = (await service.list()).map((file) => [file.name, file.auto]);
      expect(names).toHaveLength(2);
      expect(names).toContainEqual([first.name, false]);
      expect(names).toContainEqual([second.name, true]);
      expect(service.peek(second.path).manifest.format).toBe(1);
    });

    it('writes into the chosen folder when there is one', async () => {
      folder = join(work, 'elsewhere');
      const service = build();
      expect(service.folder()).toEqual({ path: folder, isDefault: false });
      const file = await service.createNow();
      expect(file.path.startsWith(folder)).toBe(true);
    });

    it('runs when due, waits the interval, and does nothing when off', async () => {
      const service = build();
      expect(service.isAutoDue()).toBe(true);
      expect(await service.runAutoIfDue()).not.toBeNull();
      expect(service.isAutoDue()).toBe(false);
      clock = new Date('2026-10-10T09:00:00.000Z');
      expect(service.isAutoDue()).toBe(false);
      clock = new Date('2026-10-10T10:00:01.000Z');
      expect(service.isAutoDue()).toBe(true);
      auto = 'weekly';
      expect(service.isAutoDue()).toBe(false);
      clock = new Date('2026-10-16T10:00:01.000Z');
      expect(service.isAutoDue()).toBe(true);
      auto = 'off';
      expect(service.isAutoDue()).toBe(false);
      expect(await service.runAutoIfDue()).toBeNull();
    });

    it('keeps the newest automatic backups and never removes the ones made by hand', async () => {
      const service = build();
      const manual = await service.createNow();
      for (let day = 0; day < KEEP_AUTO_BACKUPS + 3; day++) {
        clock = new Date(Date.UTC(2026, 9, 10 + day, 10));
        await service.runAutoIfDue();
      }
      const files = await service.list();
      expect(files.filter((file) => file.auto)).toHaveLength(KEEP_AUTO_BACKUPS);
      expect(files.some((file) => file.path === manual.path)).toBe(true);
      expect(files.filter((file) => file.auto).some((file) => file.name.includes('2026-10-10T'))).toBe(false);
    });

    it('only previews files of the backup list: inside the folder, named like ours, plain files', async () => {
      const service = build();
      const file = await service.createNow();
      expect(service.peekListed(file.path).fileName).toBe(file.name);

      const folderPath = service.folder().path;
      const outside = join(work, 'matane-anime-backup-outside.zip');
      copyFileSync(file.path, outside);
      expect(() => service.peekListed(outside)).toThrow(/not in the backup folder/);
      expect(() => service.peekListed(join(folderPath, '..', 'matane-anime-backup-outside.zip'))).toThrow(
        /not in the backup folder/,
      );
      expect(() => service.peekListed(join(folderPath, 'sub', '..', '..', file.name))).toThrow(
        /not in the backup folder/,
      );
      const renamed = join(folderPath, 'notes.zip');
      copyFileSync(file.path, renamed);
      expect(() => service.peekListed(renamed)).toThrow(/not in the backup folder/);
      const link = join(folderPath, 'matane-anime-backup-link.zip');
      symlinkSync(outside, link);
      expect(() => service.peekListed(link)).toThrow(/not a usable backup/);
      const dir = join(folderPath, 'matane-anime-backup-dir.zip');
      mkdirSync(dir);
      expect(() => service.peekListed(dir)).toThrow(/not a usable backup/);
      expect(() => service.peekListed(join(folderPath, 'matane-anime-backup-missing.zip'))).toThrow(
        /could not be read/,
      );
    });

    it('treats a last automatic backup in the future as due', () => {
      const service = build();
      lastAuto = clock.getTime() + 3 * 24 * 60 * 60 * 1000;
      expect(service.isAutoDue()).toBe(true);
    });

    it('does not write where the folder cannot be created, and tries again at the next look', async () => {
      folder = join(work, 'a-file');
      writeFileSync(folder, 'not a folder');
      const service = build();
      await expect(service.createNow()).rejects.toThrow();
      await expect(service.runAutoIfDue()).rejects.toThrow();
      expect(lastAuto).toBeNull();
      expect(service.isAutoDue()).toBe(true);
      expect(await service.list()).toEqual([]);
    });

    it('falls back to the default folder for a relative path', () => {
      folder = 'relative/backups';
      expect(build().folder().isDefault).toBe(true);
    });

    it('starts and stops the schedule once, logs a failed run, and stops for good', async () => {
      vi.useFakeTimers();
      try {
        folder = join(work, 'a-file');
        writeFileSync(folder, 'not a folder');
        const logged: string[] = [];
        const service = new BackupService({
          sqlite: db.connection.sqlite,
          userData,
          appVersion: '1.2.3',
          bundledMigrations: bundled,
          restart: () => undefined,
          now: () => clock,
          config: () => ({ auto, folder }),
          lastAuto: { get: () => lastAuto, set: () => undefined },
          log: (message) => logged.push(message),
        });
        service.startSchedule();
        service.startSchedule();
        expect(vi.getTimerCount()).toBe(2);
        await vi.advanceTimersByTimeAsync(61_000);
        expect(logged).toHaveLength(1);
        expect(logged[0]).toMatch(/automatic backup failed/);
        service.stopSchedule();
        service.stopSchedule();
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
        expect(logged).toHaveLength(1);
        service.startSchedule();
        expect(vi.getTimerCount()).toBe(2);
        service.stopSchedule();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
