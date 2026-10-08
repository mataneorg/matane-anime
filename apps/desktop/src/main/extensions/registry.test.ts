import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256Hex } from '@matane-anime/extension-repo';
import type { ExtensionManifest } from '@matane-anime/extension-sdk/manifest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '../db/__tests__/helpers';
import { DEV_FOLDERS_KEY, ExtensionRegistry } from './registry';
import { type FakeHost, fakeHost, manifestFor } from './repo-test-helpers';
import type { RepoLookup } from './repos';

let db: TestDb;
let host: FakeHost;
let root: string;
let registry: ExtensionRegistry;
let lookup: RepoLookup;

beforeEach(async () => {
  db = await createTestDb();
  host = fakeHost();
  root = mkdtempSync(join(tmpdir(), 'matane-registry-'));
  lookup = {
    describe: (repoId) => (repoId === 1 ? { name: 'Main repo', trust: 'trusted' } : null),
    newerVersion: (_repoId, id, installed) => (id === 'alpha' && installed === '1.0.0' ? '1.1.0' : null),
  };
  registry = makeRegistry();
});
afterEach(() => {
  registry.dispose();
  db.close();
  rmSync(root, { recursive: true, force: true });
});

function makeRegistry(): ExtensionRegistry {
  return new ExtensionRegistry({
    host: host.host,
    store: db.store,
    settings: db.settings,
    hostInfo: { appName: 'test', appVersion: '1.0.0', apiVersion: 1 },
    onReloaded: () => undefined,
    onChanged: () => undefined,
    repos: lookup,
  });
}

function write(dir: string, manifest: ExtensionManifest, code: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(dir, 'index.js'), code);
}

/** An installed extension as an earlier run left it: files, and a row recording their hash. */
function installed(id: string, code = `globalThis.installed = ${JSON.stringify(id)};`, version = '1.0.0'): string {
  const dir = join(root, 'extensions', id);
  write(dir, manifestFor(id, { version }), code);
  db.store.upsertExtension(manifestFor(id, { version }), 1, {
    repoId: null,
    installDir: dir,
    sha256: sha256Hex(Buffer.from(code)),
  });
  return dir;
}

function devFolder(id: string, code = 'globalThis.dev = 1;', name = id): string {
  const dir = join(root, 'dev', name);
  write(dir, manifestFor(id, { version: '9.0.0' }), code);
  return dir;
}

const infoOf = (id: string) => registry.list().filter((entry) => entry.id === id);

describe('installed extensions', () => {
  it('loads them from their folder at start and reports their origin, repository and update', async () => {
    db.connection.sqlite
      .prepare("INSERT INTO extension_repos (id, url, name) VALUES (1, 'https://r.test/', 'Main repo')")
      .run();
    const dir = installed('alpha');
    db.store.setInstall({
      id: 'alpha',
      repoId: 1,
      installDir: dir,
      sha256: sha256Hex(Buffer.from(`globalThis.installed = "alpha";`)),
      origin: 'repo',
    });
    await registry.init();
    expect(infoOf('alpha')).toEqual([
      expect.objectContaining({
        id: 'alpha',
        key: 'alpha',
        folder: null,
        origin: 'repo',
        repoId: 1,
        repoName: 'Main repo',
        trust: 'trusted',
        updateAvailable: '1.1.0',
        shadowed: false,
        status: 'ready',
        error: null,
        version: '1.0.0',
        sources: [{ id: 'alpha/main', key: 'main', lang: 'en', name: 'Main' }],
      }),
    ]);
    expect(host.loaded.get('alpha')).toBe('globalThis.installed = "alpha";');
    expect(registry.byExtensionId('alpha')?.origin).toBe('repo');
  });

  it('has no repository or update once the repository was removed', async () => {
    installed('alpha');
    await registry.init();
    expect(infoOf('alpha')[0]).toMatchObject({
      repoId: null,
      repoName: null,
      trust: null,
      updateAvailable: null,
      status: 'ready',
    });
  });

  it('refuses to run an index.js that changed since the install, and never sends it to the sandbox', async () => {
    const dir = installed('alpha');
    writeFileSync(join(dir, 'index.js'), 'globalThis.tampered = 1;');
    await registry.init();
    const [info] = infoOf('alpha');
    expect(info).toMatchObject({ status: 'error', origin: 'repo', name: 'Extension alpha', version: '1.0.0' });
    expect(info!.error).toMatch(/installed files were changed; reinstall/);
    expect(host.sent.some((command) => command.type === 'load')).toBe(false);
    expect(host.loaded.size).toBe(0);
    expect(registry.byExtensionId('alpha')).toBeUndefined();
    // Its sources are still listed (as the row remembers them), so they can be shown as unavailable.
    expect(info!.sources.map((source) => source.id)).toEqual(['alpha/main']);
  });

  it('refuses a manifest of another id and one that needs a newer API', async () => {
    const other = installed('alpha');
    write(other, manifestFor('beta'), 'globalThis.installed = "alpha";');
    const next = installed('gamma', 'globalThis.g = 1;');
    write(next, manifestFor('gamma', { apiVersion: 2 }), 'globalThis.g = 1;');
    await registry.init();
    expect(infoOf('alpha')[0]).toMatchObject({ status: 'error', error: expect.stringMatching(/changed/) });
    expect(infoOf('gamma')[0]).toMatchObject({ status: 'error', error: expect.stringMatching(/API 2/) });
    expect(host.sent.some((command) => command.type === 'load')).toBe(false);
  });

  it('refuses a bundle over the size limit even when its hash matches', async () => {
    installed('alpha', `//${'x'.repeat(2 * 1024 * 1024)}`);
    await registry.init();
    expect(infoOf('alpha')[0]).toMatchObject({ status: 'error', error: expect.stringMatching(/larger than 2 MB/) });
    expect(host.loaded.size).toBe(0);
  });

  it('shows missing files as an error instead of failing the start', async () => {
    const dir = installed('alpha');
    rmSync(dir, { recursive: true });
    db.connection.sqlite.prepare("UPDATE extensions SET install_dir = NULL WHERE id = 'alpha'").run();
    installed('beta');
    rmSync(join(root, 'extensions', 'beta'), { recursive: true });
    await registry.init();
    expect(infoOf('alpha')[0]).toMatchObject({ status: 'error', error: expect.stringMatching(/files are missing/) });
    expect(infoOf('beta')[0]).toMatchObject({ status: 'error', error: expect.stringMatching(/cannot be read/) });
  });

  it('reports a bundle that throws while loading as an error', async () => {
    installed('alpha', 'BROKEN');
    await registry.init();
    expect(infoOf('alpha')[0]).toMatchObject({ status: 'error', error: 'the bundle threw while loading' });
  });

  it('is not hot reloaded: only dev folders are polled', async () => {
    const dir = installed('alpha');
    const devDir = devFolder('devonly');
    await registry.init();
    await registry.loadFolder(devDir);
    host.sent.length = 0;
    writeFileSync(join(dir, 'index.js'), 'globalThis.tampered = 1;');
    utimesSync(join(dir, 'index.js'), new Date(), new Date(Date.now() + 5000));
    writeFileSync(join(devDir, 'index.js'), 'globalThis.rebuilt = 1;');
    utimesSync(join(devDir, 'index.js'), new Date(), new Date(Date.now() + 5000));
    await (registry as unknown as { checkForChanges(): Promise<void> }).checkForChanges();
    expect(host.loaded.get('devonly')).toBe('globalThis.rebuilt = 1;');
    expect(host.loaded.get('alpha')).toBe('globalThis.installed = "alpha";');
    expect(infoOf('alpha')[0]).toMatchObject({ status: 'ready' });
  });

  it('does not write dev folders for installed extensions', async () => {
    installed('alpha');
    const devDir = devFolder('devonly');
    await registry.init();
    await registry.loadFolder(devDir);
    expect(db.settings.getValue(DEV_FOLDERS_KEY, [])).toEqual([devDir]);
  });
});

describe('one id, one origin (EXT-9)', () => {
  it('lets a dev folder win over an installed copy at start, and lists the copy as shadowed', async () => {
    installed('alpha');
    const dev = devFolder('alpha');
    db.settings.setValue(DEV_FOLDERS_KEY, [dev]);
    await registry.init();
    expect(infoOf('alpha').map((entry) => [entry.origin, entry.shadowed, entry.status])).toEqual([
      ['dev', false, 'ready'],
      ['repo', true, 'ready'],
    ]);
    expect(registry.byExtensionId('alpha')?.origin).toBe('dev');
    expect(host.loaded.get('alpha')).toBe('globalThis.dev = 1;');
    expect(registry.isDevLoaded('alpha')).toBe(true);
    expect(registry.isShadowed('alpha')).toBe(true);
  });

  it('shadows an installed copy when a dev folder with its id is loaded, leaving its row alone, and brings it back when the folder is removed', async () => {
    installed('alpha');
    await registry.init();
    expect(host.loaded.get('alpha')).toBe('globalThis.installed = "alpha";');
    const dev = devFolder('alpha');
    await registry.loadFolder(dev);
    expect(infoOf('alpha').find((entry) => entry.origin === 'repo')).toMatchObject({ shadowed: true });
    expect(host.loaded.get('alpha')).toBe('globalThis.dev = 1;');
    // The dev folder did not rewrite the installed copy's row.
    expect(db.store.findExtension('alpha')).toMatchObject({ origin: 'repo', version: '1.0.0' });

    await registry.removeFolder(dev);
    expect(infoOf('alpha')).toHaveLength(1);
    expect(infoOf('alpha')[0]).toMatchObject({ origin: 'repo', shadowed: false, status: 'ready' });
    expect(host.loaded.get('alpha')).toBe('globalThis.installed = "alpha";');
    expect(registry.byExtensionId('alpha')?.origin).toBe('repo');
    expect(registry.isDevLoaded('alpha')).toBe(false);
  });

  it('brings the installed copy back when the dev folder stops loading', async () => {
    installed('alpha');
    await registry.init();
    const dev = devFolder('alpha');
    await registry.loadFolder(dev);
    expect(registry.isShadowed('alpha')).toBe(true);
    writeFileSync(join(dev, 'manifest.json'), '{ not json');
    await registry.loadFolder(dev);
    expect(registry.list().find((entry) => entry.folder === dev)).toMatchObject({ status: 'error', origin: 'dev' });
    expect(infoOf('alpha').find((entry) => entry.origin === 'repo')).toMatchObject({
      shadowed: false,
      status: 'ready',
    });
    expect(host.loaded.get('alpha')).toBe('globalThis.installed = "alpha";');
    expect(registry.byExtensionId('alpha')?.origin).toBe('repo');
    // And shadows it again when the folder is fixed.
    write(dev, manifestFor('alpha', { version: '9.0.1' }), 'globalThis.dev = 2;');
    await registry.loadFolder(dev);
    expect(registry.isShadowed('alpha')).toBe(true);
    expect(host.loaded.get('alpha')).toBe('globalThis.dev = 2;');
  });

  it('checks an installed copy again when it comes back', async () => {
    const dir = installed('alpha');
    await registry.init();
    const dev = devFolder('alpha');
    await registry.loadFolder(dev);
    writeFileSync(join(dir, 'index.js'), 'globalThis.tampered = 1;');
    await registry.removeFolder(dev);
    expect(infoOf('alpha')[0]).toMatchObject({ status: 'error', shadowed: false });
    expect(host.loaded.has('alpha')).toBe(false);
  });

  it('keeps refusing two dev folders with the same id', async () => {
    await registry.init();
    await registry.loadFolder(devFolder('alpha', 'globalThis.one = 1;', 'one'));
    const second = await registry.loadFolder(devFolder('alpha', 'globalThis.two = 1;', 'two'));
    expect(second).toMatchObject({ status: 'error', error: expect.stringMatching(/already loaded/) });
    expect(host.loaded.get('alpha')).toBe('globalThis.one = 1;');
  });

  it('does not unload the dev copy when an installed one is forgotten', async () => {
    installed('alpha');
    await registry.init();
    await registry.loadFolder(devFolder('alpha'));
    await registry.unloadInstalled('alpha');
    expect(infoOf('alpha')).toHaveLength(1);
    expect(host.loaded.get('alpha')).toBe('globalThis.dev = 1;');
  });
});
