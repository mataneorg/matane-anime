import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RepoStore } from '../repositories/extension-repos';
import { type TestDb, createTestDb, manifest } from './helpers';

let db: TestDb;
let repos: RepoStore;
beforeEach(async () => {
  db = await createTestDb();
  repos = new RepoStore(db.connection.db, db.changes);
});
afterEach(() => db.close());

const alpha = { ...manifest, id: 'alpha', name: 'Alpha', sources: [{ key: 'main', lang: 'en', name: 'Main' }] };
const newRepo = (url = 'https://r.test/') => ({
  url,
  name: 'R',
  indexJson: '{}',
  signature: null,
  signingKey: null,
  publicKey: null,
  serial: 1,
});

describe('ExtensionStore: installed extensions', () => {
  it('moves updatedAt only when the version changes (a hot reload is not an update)', () => {
    db.store.upsertExtension(alpha, 100);
    db.store.upsertExtension({ ...alpha, name: 'Alpha renamed' }, 200);
    expect(db.store.findExtension('alpha')).toMatchObject({ name: 'Alpha renamed', installedAt: 100, updatedAt: 100 });
    db.store.upsertExtension({ ...alpha, version: '1.1.0' }, 300);
    expect(db.store.findExtension('alpha')).toMatchObject({ version: '1.1.0', installedAt: 100, updatedAt: 300 });
  });

  it('records where a repository install lives, in the same step as the extension', () => {
    db.store.upsertExtension(alpha, 100);
    const repoId = repos.add(newRepo()).id;
    db.store.upsertExtension({ ...alpha, version: '2.0.0' }, 200, { repoId, installDir: '/x/alpha', sha256: 'ab' });
    expect(db.store.findExtension('alpha')).toMatchObject({
      id: 'alpha',
      name: 'Alpha',
      version: '2.0.0',
      apiVersion: 1,
      nsfw: false,
      repoId,
      origin: 'repo',
      installDir: '/x/alpha',
      sha256: 'ab',
      installedAt: 100,
      updatedAt: 200,
    });
  });

  it('does not let a dev folder with the same id rewrite an installed extension, but keeps its sources', () => {
    const repoId = repos.add(newRepo()).id;
    db.store.upsertExtension(alpha, 100, { repoId, installDir: '/x/alpha', sha256: 'ab' });
    const dev = {
      ...alpha,
      version: '9.0.0',
      name: 'Dev Alpha',
      sources: [
        { key: 'main', lang: 'en', name: 'Main (dev)' },
        { key: 'extra', lang: 'id', name: 'Extra' },
      ],
    };
    db.store.upsertExtension(dev, 500);
    expect(db.store.findExtension('alpha')).toMatchObject({
      name: 'Alpha',
      version: '1.0.0',
      origin: 'repo',
      repoId,
      installDir: '/x/alpha',
      sha256: 'ab',
      updatedAt: 100,
    });
    expect(
      db.store
        .listSources()
        .filter((s) => s.extensionId === 'alpha')
        .map((s) => s.name)
        .sort(),
    ).toEqual(['Extra', 'Main (dev)']);
  });

  it('setInstall turns a row into a repository install and back', () => {
    db.store.upsertExtension(alpha, 100);
    const repoId = repos.add(newRepo()).id;
    db.store.setInstall({ id: 'alpha', repoId, installDir: '/x/alpha', sha256: 'ab', origin: 'repo' });
    expect(db.store.findExtension('alpha')).toMatchObject({
      origin: 'repo',
      repoId,
      installDir: '/x/alpha',
      sha256: 'ab',
    });
    db.store.setInstall({ id: 'alpha', repoId: null, installDir: null, sha256: null, origin: 'dev' });
    expect(db.store.findExtension('alpha')).toMatchObject({
      origin: 'dev',
      repoId: null,
      installDir: null,
      sha256: null,
    });
  });

  it('lists the extensions in id order', () => {
    db.store.upsertExtension({ ...alpha, id: 'zed' }, 1);
    db.store.upsertExtension(alpha, 1);
    expect(db.store.listExtensions().map((row) => row.id)).toEqual(['alpha', 'example', 'zed']);
  });

  it('deletes the row with its preferences and storage, but keeps the sources and the anime', () => {
    db.store.upsertExtension(alpha, 100);
    db.store.setPref('alpha', 'k', 1);
    db.store.storageSet('alpha', 's', 2);
    db.store.setPref('example', 'k', 3);
    const [anime] = db.anime.upsertSummaries('alpha/main', [{ url: '/a', title: 'A' }]);
    db.emitted.length = 0;
    db.store.deleteExtension('alpha');
    expect(db.store.findExtension('alpha')).toBeUndefined();
    expect(db.store.getPrefs('alpha')).toEqual({});
    expect(db.store.storageGet('alpha', 's')).toBeNull();
    expect(db.store.getPrefs('example')).toEqual({ k: 3 });
    expect(db.store.getSource('alpha/main')).toBeDefined();
    expect(db.anime.get(anime!.id)).toBeDefined();
    expect(db.emitted.flat()).toEqual(expect.arrayContaining(['extensions', 'sources']));
  });
});

describe('RepoStore', () => {
  it('adds, finds, lists and removes repositories, saying what changed', () => {
    db.emitted.length = 0;
    const first = repos.add(newRepo('https://one.test/'), 500);
    const second = repos.add(newRepo('https://two.test/'), 600);
    expect(first).toMatchObject({
      url: 'https://one.test/',
      lastFetchedAt: 500,
      lastError: null,
      publicKey: null,
      serial: 1,
    });
    expect(repos.list().map((row) => row.id)).toEqual([first.id, second.id]);
    expect(repos.getByUrl('https://two.test/')?.id).toBe(second.id);
    expect(repos.get(99)).toBeUndefined();
    expect(db.emitted.flat()).toEqual(expect.arrayContaining(['repos', 'extensions']));
    expect(() => repos.add(newRepo('https://one.test/'))).toThrow();
    repos.remove(first.id);
    expect(repos.list().map((row) => row.id)).toEqual([second.id]);
  });

  it('saves an accepted index without touching the trusted key, and keeps the error until the next success', () => {
    const { id } = repos.add({ ...newRepo(), publicKey: 'ed25519:aa' }, 1);
    repos.recordError(id, 'x'.repeat(900));
    expect(repos.get(id)!.lastError).toHaveLength(500);
    repos.saveAccepted(
      id,
      { name: 'R2', indexJson: '{"a":1}', signature: 's', signingKey: 'ed25519:bb', serial: 7 },
      900,
    );
    expect(repos.get(id)).toMatchObject({
      name: 'R2',
      indexJson: '{"a":1}',
      signature: 's',
      signingKey: 'ed25519:bb',
      publicKey: 'ed25519:aa',
      serial: 7,
      lastFetchedAt: 900,
      lastError: null,
    });
    repos.setTrustedKey(id, null);
    expect(repos.get(id)!.publicKey).toBeNull();
  });

  it('leaves installed extensions in place when their repository goes', () => {
    const { id } = repos.add(newRepo());
    db.store.upsertExtension(alpha, 1, { repoId: id, installDir: '/x/alpha', sha256: 'ab' });
    repos.remove(id);
    expect(db.store.findExtension('alpha')).toMatchObject({ origin: 'repo', repoId: null, installDir: '/x/alpha' });
  });
});
