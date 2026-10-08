import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type RepoKeyPair, generateKeyPair, sha256Hex } from '@matane-anime/extension-repo';
import { AppError } from '@matane-anime/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type TestDb, createTestDb } from '../db/__tests__/helpers';
import { RepoStore } from '../db/repositories/extension-repos';
import { type InstallFs, InstallService, MAX_TOKENS, TOKEN_TTL_MS } from './install';
import { ExtensionRegistry } from './registry';
import { REPO_A, REPO_B, FakeNet, type FakeHost, fakeHost, pkg, repoOptions } from './repo-test-helpers';
import { RepoService } from './repos';

let db: TestDb;
let net: FakeNet;
let repoService: RepoService;
let registry: ExtensionRegistry;
let host: FakeHost;
let installs: InstallService;
let extensionsDir: string;
let now: number;
let tokenCounter: number;
let key: RepoKeyPair;
let fsOverrides: Partial<InstallFs>;
const migrated: string[] = [];
const sessionsCleared: string[] = [];
const networkInvalidated: string[] = [];

beforeEach(async () => {
  key ??= generateKeyPair();
  db = await createTestDb();
  net = new FakeNet();
  now = 1_000_000;
  tokenCounter = 0;
  fsOverrides = {};
  migrated.length = 0;
  sessionsCleared.length = 0;
  networkInvalidated.length = 0;
  extensionsDir = mkdtempSync(join(tmpdir(), 'matane-install-'));
  host = fakeHost();
  repoService = new RepoService({
    http: net,
    repos: new RepoStore(db.connection.db, db.changes),
    extensions: db.store,
    settings: db.settings,
    appVersion: '1.0.0',
    now: () => now,
    isDevLoaded: (id) => registry.isDevLoaded(id),
  });
  registry = new ExtensionRegistry({
    host: host.host,
    store: db.store,
    settings: db.settings,
    hostInfo: { appName: 'test', appVersion: '1.0.0', apiVersion: 1 },
    onReloaded: () => undefined,
    onChanged: () => undefined,
    repos: repoService,
  });
  installs = new InstallService({
    http: net,
    repos: repoService,
    store: db.store,
    registry,
    extensionsDir,
    migrate: async (id) => void migrated.push(id),
    clearSession: async (id) => void sessionsCleared.push(id),
    invalidateNetwork: (id) => void networkInvalidated.push(id),
    now: () => now,
    randomToken: () => `token-${++tokenCounter}`,
    // Tests swap single operations to make one step fail.
    fs: {
      rename: (from, to) => (fsOverrides.rename ?? rename)(from, to),
      writeFile: (path, data) => (fsOverrides.writeFile ?? ((p, d) => writeFile(p, d)))(path, data),
    },
  });
});
afterEach(() => {
  registry.dispose();
  db.close();
  rmSync(extensionsDir, { recursive: true, force: true });
});

const signed = (serial: number, packages = [pkg('alpha')]) =>
  repoOptions(packages, { serial, privateKeyPem: key.privateKeyPem });

async function addRepo(base = REPO_A, trust = true): Promise<number> {
  return (await repoService.add(base, trust)).id;
}

async function installFrom(repoId: number, extensionId: string) {
  const preparation = await installs.prepareInstall({ repoId, extensionId });
  await installs.install(preparation.token);
  return preparation;
}

async function fails(work: Promise<unknown>): Promise<AppError> {
  try {
    await work;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error('expected a failure');
}

const read = (id: string, file: string) => readFileSync(join(extensionsDir, id, file), 'utf8');
const infoOf = (id: string) => registry.list().find((entry) => entry.id === id);

describe('prepareInstall', () => {
  it('verifies the package and describes what will be installed, writing nothing', async () => {
    net.publish(REPO_A, signed(1, [pkg('alpha', '1.2.0', { nsfw: true })]));
    const repoId = await addRepo();
    const preparation = await installs.prepareInstall({ repoId, extensionId: 'alpha' });
    expect(preparation).toMatchObject({
      token: 'token-1',
      repo: { id: repoId, name: 'Test repo', trust: 'trusted' },
      extension: { id: 'alpha', version: '1.2.0', apiVersion: 1, langs: ['en'], nsfw: true },
      installedVersion: null,
      warnings: ['nsfw'],
    });
    expect(preparation.extension.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(readdirSync(extensionsDir)).toEqual([]);
    expect(db.store.findExtension('alpha')).toBeUndefined();
  });

  it('warns about repositories that are unverified or unsigned', async () => {
    net.publish(REPO_A, signed(1));
    net.publish(REPO_B, repoOptions([pkg('beta')]));
    const a = await addRepo(REPO_A, false);
    const b = await addRepo(REPO_B, false);
    expect((await installs.prepareInstall({ repoId: a, extensionId: 'alpha' })).warnings).toEqual(['unverified']);
    expect((await installs.prepareInstall({ repoId: b, extensionId: 'beta' })).warnings).toEqual(['unsigned']);
  });

  it('refuses an extension the repository does not offer', async () => {
    net.publish(REPO_A, signed(1));
    const repoId = await addRepo();
    expect((await fails(installs.prepareInstall({ repoId, extensionId: 'nope' }))).code).toBe('not_found');
    expect((await fails(installs.prepareInstall({ repoId: 99, extensionId: 'alpha' }))).code).toBe('not_found');
  });

  it('refuses an extension that needs a newer API or app, before downloading it', async () => {
    net.publish(REPO_A, signed(1, [pkg('alpha'), pkg('beta', '1.0.0', { minAppVersion: '3.0.0' })]));
    net.mutateIndex(REPO_A, (index) => void (index.extensions[0]!.apiVersion = 2), key.privateKeyPem);
    const repoId = await addRepo();
    net.requests.length = 0;
    const api = await fails(installs.prepareInstall({ repoId, extensionId: 'alpha' }));
    expect(api).toMatchObject({ code: 'unsupported' });
    expect(api.message).toMatch(/API 2/);
    const app = await fails(installs.prepareInstall({ repoId, extensionId: 'beta' }));
    expect(app).toMatchObject({ code: 'unsupported' });
    expect(app.message).toMatch(/3\.0\.0/);
    expect(net.requests).toEqual([]);
  });

  describe('maps every failure to a message the user can read', () => {
    const prepare = async (change: (repoId: number) => void) => {
      net.publish(REPO_A, signed(1));
      const repoId = await addRepo();
      change(repoId);
      // What the repository serves now is what the next refresh stores.
      await repoService.refresh(repoId);
      return fails(installs.prepareInstall({ repoId, extensionId: 'alpha' }));
    };
    const archiveUrl = `${REPO_A}alpha-1.0.0.zip`;

    it('a hash that does not match', async () => {
      const error = await prepare(() => {
        const bytes = Buffer.from(net.files.get(archiveUrl)!);
        bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
        net.files.set(archiveUrl, bytes);
      });
      expect(error).toMatchObject({ code: 'invalid_input' });
      expect(error.message).toMatch(/SHA-256/);
    });

    it('a size that does not match', async () => {
      const error = await prepare(() => net.files.set(archiveUrl, net.files.get(archiveUrl)!.subarray(0, -1)));
      expect(error.message).toMatch(/size/);
    });

    it('an archive larger than the index says', async () => {
      const error = await prepare(() =>
        net.files.set(archiveUrl, Buffer.concat([net.files.get(archiveUrl)!, Buffer.from('x')])),
      );
      expect(error).toMatchObject({ code: 'invalid_input' });
      expect(error.message).toMatch(/larger/);
    });

    it('bytes that are not an extension archive', async () => {
      const error = await prepare(() =>
        net.replaceArchive(REPO_A, 'alpha', Buffer.from('not a zip at all'), key.privateKeyPem),
      );
      expect(error.message).toMatch(/not a valid extension archive/);
    });

    it('a manifest that contradicts the index', async () => {
      const error = await prepare(() =>
        net.mutateIndex(REPO_A, (index) => void (index.extensions[0]!.version = '1.0.1'), key.privateKeyPem),
      );
      expect(error.message).toMatch(/contradicts the repository index/);
    });

    it('an icon that does not match', async () => {
      const iconUrl = `${REPO_A}alpha.png`;
      const error = await prepare(() => net.files.set(iconUrl, Buffer.alloc(net.files.get(iconUrl)!.length, 1)));
      expect(error.code).toBe('invalid_input');
      expect(error.message).toMatch(/icon/);
    });

    it('a file that is gone', async () => {
      expect((await prepare(() => net.files.delete(archiveUrl))).code).toBe('network');
    });

    it('a host that went down', async () => {
      expect((await prepare(() => net.unreachable.add('repo-a.test'))).code).toBe('network');
    });

    it('no network', async () => {
      expect((await prepare(() => (net.offline = true))).code).toBe('offline');
    });
  });

  describe('conflicts (EXT-9)', () => {
    it('refuses an id that a dev folder provides', async () => {
      net.publish(REPO_A, signed(1));
      const repoId = await addRepo();
      const folder = mkdtempSync(join(tmpdir(), 'matane-dev-'));
      try {
        writeFileSync(join(folder, 'manifest.json'), JSON.stringify(pkg('alpha').manifest));
        writeFileSync(join(folder, 'index.js'), 'globalThis.dev = 1;');
        await registry.loadFolder(folder);
        const error = await fails(installs.prepareInstall({ repoId, extensionId: 'alpha' }));
        expect(error).toMatchObject({ code: 'forbidden' });
        expect(error.message).toMatch(/dev folder/);
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
    });

    it('refuses an id installed from another repository, and says which', async () => {
      net.publish(REPO_A, signed(1));
      net.publish(REPO_B, repoOptions([pkg('alpha', '2.0.0')]));
      const a = await addRepo(REPO_A);
      const b = await addRepo(REPO_B, false);
      await installFrom(a, 'alpha');
      const error = await fails(installs.prepareInstall({ repoId: b, extensionId: 'alpha' }));
      expect(error).toMatchObject({ code: 'forbidden' });
      expect(error.message).toMatch(/already installed from Test repo/);
    });

    it('lets the repository it came from install it again (repair), and adopts an orphan', async () => {
      net.publish(REPO_A, signed(1));
      net.publish(REPO_B, repoOptions([pkg('alpha', '2.0.0')]));
      const a = await addRepo(REPO_A);
      const b = await addRepo(REPO_B, false);
      await installFrom(a, 'alpha');
      expect((await installFrom(a, 'alpha')).installedVersion).toBe('1.0.0');
      repoService.remove(a);
      await installFrom(b, 'alpha');
      expect(db.store.findExtension('alpha')).toMatchObject({ repoId: b, version: '2.0.0' });
    });
  });

  describe('tokens', () => {
    it('expire after five minutes', async () => {
      net.publish(REPO_A, signed(1));
      const repoId = await addRepo();
      const { token } = await installs.prepareInstall({ repoId, extensionId: 'alpha' });
      now += TOKEN_TTL_MS + 1;
      const error = await fails(installs.install(token));
      expect(error).toMatchObject({ code: 'invalid_input' });
      expect(error.message).toMatch(/expired/);
      expect(readdirSync(extensionsDir)).toEqual([]);
    });

    it('work until the last moment, and only once', async () => {
      net.publish(REPO_A, signed(1));
      const repoId = await addRepo();
      const { token } = await installs.prepareInstall({ repoId, extensionId: 'alpha' });
      now += TOKEN_TTL_MS - 1;
      await installs.install(token);
      expect((await fails(installs.install(token))).code).toBe('invalid_input');
    });

    it('are used up even when the install fails', async () => {
      net.publish(REPO_A, signed(1, [pkg('alpha', '1.0.0', { code: 'BROKEN' })]));
      const repoId = await addRepo();
      const { token } = await installs.prepareInstall({ repoId, extensionId: 'alpha' });
      await fails(installs.install(token));
      expect((await fails(installs.install(token))).message).toMatch(/expired/);
    });

    it('are few: the oldest goes when too many are prepared, and a second prepare of an id replaces the first', async () => {
      const packages = Array.from({ length: MAX_TOKENS + 1 }, (_, i) => pkg(`ext${i}`));
      net.publish(REPO_A, signed(1, packages));
      const repoId = await addRepo();
      const tokens: string[] = [];
      for (const { manifest } of packages) {
        now += 1;
        tokens.push((await installs.prepareInstall({ repoId, extensionId: manifest.id })).token);
      }
      expect((await fails(installs.install(tokens[0]!))).code).toBe('invalid_input');
      await installs.install(tokens[MAX_TOKENS]!);
      const first = (await installs.prepareInstall({ repoId, extensionId: 'ext1' })).token;
      expect((await fails(installs.install(tokens[1]!))).code).toBe('invalid_input');
      await installs.install(first);
    });
  });
});

describe('install', () => {
  it('writes the three files, records the row, loads it, and migrates its urls', async () => {
    net.publish(REPO_A, signed(1, [pkg('alpha', '1.0.0', { code: 'globalThis.alpha = 1;' })]));
    const repoId = await addRepo();
    db.emitted.length = 0;
    await installFrom(repoId, 'alpha');

    expect(readdirSync(extensionsDir)).toEqual(['alpha']);
    expect(readdirSync(join(extensionsDir, 'alpha')).sort()).toEqual(['icon.png', 'index.js', 'manifest.json']);
    expect(read('alpha', 'index.js')).toBe('globalThis.alpha = 1;');
    expect(JSON.parse(read('alpha', 'manifest.json'))).toMatchObject({ id: 'alpha', version: '1.0.0' });
    expect(db.store.findExtension('alpha')).toMatchObject({
      origin: 'repo',
      repoId,
      installDir: join(extensionsDir, 'alpha'),
      sha256: sha256Hex(Buffer.from('globalThis.alpha = 1;')),
      version: '1.0.0',
    });
    expect(host.loaded.get('alpha')).toBe('globalThis.alpha = 1;');
    expect(infoOf('alpha')).toMatchObject({ status: 'ready', origin: 'repo', key: 'alpha', repoId, trust: 'trusted' });
    expect(db.store.listSources().map((s) => s.id)).toContain('alpha/main');
    expect(db.emitted.flat()).toEqual(expect.arrayContaining(['extensions', 'sources']));
    expect(migrated).toEqual(['alpha']);
    expect(networkInvalidated).toEqual(['alpha']);
  });

  it('survives a failing migration', async () => {
    net.publish(REPO_A, signed(1));
    const repoId = await addRepo();
    (installs as unknown as { deps: { migrate(id: string): Promise<void> } }).deps.migrate = async () => {
      throw new Error('boom');
    };
    await installFrom(repoId, 'alpha');
    expect(infoOf('alpha')?.status).toBe('ready');
  });

  it('is atomic: a failed swap puts the previous version back', async () => {
    net.publish(REPO_A, signed(1, [pkg('alpha', '1.0.0', { code: 'globalThis.v = 1;' })]));
    const repoId = await addRepo();
    await installFrom(repoId, 'alpha');
    net.publish(REPO_A, signed(2, [pkg('alpha', '1.1.0', { code: 'globalThis.v = 2;' })]));
    await repoService.refresh();

    fsOverrides.rename = async (from, to) => {
      if (from.endsWith('alpha.tmp')) throw new Error('disk exploded');
      await rename(from, to);
    };
    const error = await fails(installs.update('alpha'));
    expect(error.message).toMatch(/disk exploded/);
    expect(readdirSync(extensionsDir)).toEqual(['alpha']);
    expect(read('alpha', 'index.js')).toBe('globalThis.v = 1;');
    expect(db.store.findExtension('alpha')!.version).toBe('1.0.0');
    expect(host.loaded.get('alpha')).toBe('globalThis.v = 1;');
    expect(infoOf('alpha')).toMatchObject({ status: 'ready', version: '1.0.0' });
  });

  it('cleans up when writing the files fails, leaving the previous version alone', async () => {
    net.publish(REPO_A, signed(1, [pkg('alpha', '1.0.0', { code: 'globalThis.v = 1;' })]));
    const repoId = await addRepo();
    await installFrom(repoId, 'alpha');
    net.publish(REPO_A, signed(2, [pkg('alpha', '1.1.0')]));
    await repoService.refresh();
    fsOverrides.writeFile = async (path) => {
      if (path.endsWith('index.js')) throw new Error('no space left');
      await writeFile(path, '');
    };
    expect((await fails(installs.update('alpha'))).message).toMatch(/no space left/);
    expect(readdirSync(extensionsDir)).toEqual(['alpha']);
    expect(read('alpha', 'index.js')).toBe('globalThis.v = 1;');
  });

  it('rolls an update back when the new version does not load', async () => {
    net.publish(REPO_A, signed(1, [pkg('alpha', '1.0.0', { code: 'globalThis.v = 1;' })]));
    const repoId = await addRepo();
    await installFrom(repoId, 'alpha');
    net.publish(REPO_A, signed(2, [pkg('alpha', '1.1.0', { code: 'BROKEN' })]));
    await repoService.refresh();
    const error = await fails(installs.update('alpha'));
    expect(error).toMatchObject({ code: 'extension' });
    expect(error.message).toMatch(/nothing was changed/);
    expect(readdirSync(extensionsDir)).toEqual(['alpha']);
    expect(read('alpha', 'index.js')).toBe('globalThis.v = 1;');
    expect(db.store.findExtension('alpha')).toMatchObject({
      version: '1.0.0',
      sha256: sha256Hex(Buffer.from('globalThis.v = 1;')),
    });
    expect(host.loaded.get('alpha')).toBe('globalThis.v = 1;');
    expect(infoOf('alpha')).toMatchObject({ status: 'ready', version: '1.0.0' });
    expect(migrated).toEqual(['alpha']); // only the first install
  });

  it('removes a first install that does not load, without a row or a record', async () => {
    net.publish(REPO_A, signed(1, [pkg('alpha', '1.0.0', { code: 'BROKEN' })]));
    const repoId = await addRepo();
    await fails(installFrom(repoId, 'alpha'));
    expect(readdirSync(extensionsDir)).toEqual([]);
    expect(db.store.findExtension('alpha')).toBeUndefined();
    expect(infoOf('alpha')).toBeUndefined();
    expect(host.loaded.has('alpha')).toBe(false);
    expect(migrated).toEqual([]);
  });

  it('puts back an interrupted swap at startup', async () => {
    mkdirSync(join(extensionsDir, 'a.tmp'));
    mkdirSync(join(extensionsDir, 'b.old'));
    writeFileSync(join(extensionsDir, 'b.old', 'index.js'), 'previous');
    mkdirSync(join(extensionsDir, 'c.old'));
    mkdirSync(join(extensionsDir, 'c'));
    writeFileSync(join(extensionsDir, 'c', 'index.js'), 'current');
    await installs.recoverInterrupted();
    expect(readdirSync(extensionsDir).sort()).toEqual(['b', 'c']);
    expect(read('b', 'index.js')).toBe('previous');
    expect(read('c', 'index.js')).toBe('current');
  });
});

describe('update', () => {
  const publish = (serial: number, version: string, base = REPO_A, id = 'alpha') =>
    net.publish(
      base,
      base === REPO_A ? signed(serial, [pkg(id, version)]) : repoOptions([pkg(id, version)], { serial }),
    );

  it('installs a strictly newer version from the repository the copy came from, without a dialog', async () => {
    publish(1, '1.0.0');
    const repoId = await addRepo();
    await installFrom(repoId, 'alpha');
    expect(infoOf('alpha')?.updateAvailable).toBeNull();
    publish(2, '1.1.0');
    await repoService.refresh();
    expect(infoOf('alpha')?.updateAvailable).toBe('1.1.0');
    migrated.length = 0;
    await installs.update('alpha');
    expect(db.store.findExtension('alpha')).toMatchObject({ version: '1.1.0', repoId });
    expect(JSON.parse(read('alpha', 'manifest.json')).version).toBe('1.1.0');
    expect(readdirSync(extensionsDir)).toEqual(['alpha']);
    expect(infoOf('alpha')).toMatchObject({ version: '1.1.0', updateAvailable: null });
    expect(migrated).toEqual(['alpha']);
  });

  it('refuses the same or an older version', async () => {
    publish(1, '1.0.0');
    const repoId = await addRepo();
    await installFrom(repoId, 'alpha');
    expect((await fails(installs.update('alpha'))).message).toMatch(/up to date/);
    publish(2, '0.9.0');
    await repoService.refresh();
    expect((await fails(installs.update('alpha'))).message).toMatch(/up to date/);
    expect(db.store.findExtension('alpha')!.version).toBe('1.0.0');
  });

  it('only looks at the repository the copy came from, not at another one that offers a newer version', async () => {
    publish(1, '1.0.0');
    publish(1, '5.0.0', REPO_B);
    const a = await addRepo(REPO_A);
    await addRepo(REPO_B, false);
    await installFrom(a, 'alpha');
    expect((await fails(installs.update('alpha'))).code).toBe('invalid_input');
    expect(db.store.findExtension('alpha')!.version).toBe('1.0.0');
    expect((await installs.updateAll()).updated).toEqual([]);
  });

  it('has nothing to do for a dev extension, an unknown id, or a copy whose repository was removed', async () => {
    publish(1, '1.0.0');
    const repoId = await addRepo();
    await installFrom(repoId, 'alpha');
    expect((await fails(installs.update('example'))).code).toBe('invalid_input');
    expect((await fails(installs.update('ghost'))).code).toBe('invalid_input');
    repoService.remove(repoId);
    expect((await fails(installs.update('alpha'))).message).toMatch(/removed/);
  });

  it('updateAll updates what it can, skips what is current or incompatible, and reports failures', async () => {
    net.publish(REPO_A, signed(1, [pkg('a1'), pkg('a2'), pkg('a3'), pkg('a4'), pkg('a5')]));
    const repoId = await addRepo();
    for (const id of ['a1', 'a2', 'a3', 'a4', 'a5']) await installFrom(repoId, id);
    net.publish(
      REPO_A,
      signed(2, [
        pkg('a1', '1.1.0'),
        pkg('a2', '1.1.0', { code: 'BROKEN' }),
        pkg('a3', '1.0.0'),
        pkg('a4', '2.0.0', { minAppVersion: '9.0.0' }),
        pkg('a5', '1.2.0'),
      ]),
    );
    await repoService.refresh();
    const result = await installs.updateAll();
    expect(result.updated).toEqual(['a1', 'a5']);
    expect(result.failed).toEqual([{ id: 'a2', message: expect.stringMatching(/could not be loaded/) }]);
    expect(db.store.findExtension('a2')!.version).toBe('1.0.0');
    expect(db.store.findExtension('a4')!.version).toBe('1.0.0');
  });
});

describe('uninstall', () => {
  it('removes files, row, preferences, storage and session; sources and anime stay', async () => {
    net.publish(REPO_A, signed(1));
    const repoId = await addRepo();
    await installFrom(repoId, 'alpha');
    db.store.setPref('alpha', 'baseUrl', 'x');
    db.store.storageSet('alpha', 'token', 1);
    const [anime] = db.anime.upsertSummaries('alpha/main', [{ url: '/a', title: 'A' }]);
    db.emitted.length = 0;

    await installs.uninstall('alpha');

    expect(readdirSync(extensionsDir)).toEqual([]);
    expect(db.store.findExtension('alpha')).toBeUndefined();
    expect(db.store.getPrefs('alpha')).toEqual({});
    expect(db.store.storageGet('alpha', 'token')).toBeNull();
    expect(db.store.getSource('alpha/main')).toMatchObject({ extensionId: 'alpha' });
    expect(db.anime.get(anime!.id)).toMatchObject({ sourceId: 'alpha/main' });
    expect(host.loaded.has('alpha')).toBe(false);
    expect(infoOf('alpha')).toBeUndefined();
    expect(registry.byExtensionId('alpha')).toBeUndefined();
    expect(sessionsCleared).toEqual(['alpha']);
    expect(networkInvalidated).toContain('alpha');
    expect(db.emitted.flat()).toEqual(expect.arrayContaining(['extensions', 'sources']));
  });

  it('can be installed again afterwards', async () => {
    net.publish(REPO_A, signed(1));
    const repoId = await addRepo();
    await installFrom(repoId, 'alpha');
    await installs.uninstall('alpha');
    await installFrom(repoId, 'alpha');
    expect(infoOf('alpha')?.status).toBe('ready');
  });

  it('still finishes when the session cannot be cleared', async () => {
    net.publish(REPO_A, signed(1));
    const repoId = await addRepo();
    await installFrom(repoId, 'alpha');
    (installs as unknown as { deps: { clearSession(id: string): Promise<void> } }).deps.clearSession = async () => {
      throw new Error('no session');
    };
    await installs.uninstall('alpha');
    expect(db.store.findExtension('alpha')).toBeUndefined();
  });

  it('refuses a dev extension and an unknown one', async () => {
    expect((await fails(installs.uninstall('example'))).code).toBe('forbidden');
    expect((await fails(installs.uninstall('ghost'))).code).toBe('not_found');
    expect(db.store.findExtension('example')).toBeDefined();
  });

  it('never deletes outside the extensions folder, whatever the row says', async () => {
    net.publish(REPO_A, signed(1));
    const repoId = await addRepo();
    await installFrom(repoId, 'alpha');
    const outside = mkdtempSync(join(tmpdir(), 'matane-outside-'));
    try {
      writeFileSync(join(outside, 'keep.txt'), 'keep');
      db.connection.sqlite.prepare('UPDATE extensions SET install_dir = ? WHERE id = ?').run(outside, 'alpha');
      await installs.uninstall('alpha');
      expect(existsSync(join(outside, 'keep.txt'))).toBe(true);
      expect(readdirSync(extensionsDir)).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

it('sends a single request per file when preparing (no retries, no extra fetches)', async () => {
  net.publish(REPO_A, signed(1));
  const repoId = await addRepo();
  const spy = vi.spyOn(net, 'get');
  await installs.prepareInstall({ repoId, extensionId: 'alpha' });
  expect(spy.mock.calls.map(([url]) => url)).toEqual([`${REPO_A}alpha-1.0.0.zip`, `${REPO_A}alpha.png`]);
});
