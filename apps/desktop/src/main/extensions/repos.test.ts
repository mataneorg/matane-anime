import { type RepoKeyPair, generateKeyPair, signIndex } from '@matane-anime/extension-repo';
import { AppError } from '@matane-anime/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '../db/__tests__/helpers';
import { RepoStore } from '../db/repositories/extension-repos';
import { REPO_A, REPO_B, FakeNet, manifestFor, pkg, repoOptions } from './repo-test-helpers';
import { RepoService } from './repos';

let db: TestDb;
let net: FakeNet;
let repos: RepoStore;
let service: RepoService;
let now: number;
let devLoaded: Set<string>;
let keyA: RepoKeyPair;
let keyB: RepoKeyPair;

beforeEach(async () => {
  db = await createTestDb();
  net = new FakeNet();
  now = 10_000;
  devLoaded = new Set();
  keyA ??= generateKeyPair();
  keyB ??= generateKeyPair();
  repos = new RepoStore(db.connection.db, db.changes);
  service = new RepoService({
    http: net,
    repos,
    extensions: db.store,
    settings: db.settings,
    appVersion: '1.0.0',
    now: () => now,
    isDevLoaded: (id) => devLoaded.has(id),
  });
});
afterEach(() => db.close());

const signed = (serial = 1, key = keyA, packages = [pkg('alpha')]) =>
  repoOptions(packages, { serial, privateKeyPem: key.privateKeyPem });
const unsigned = (serial = 1, packages = [pkg('alpha')]) => repoOptions(packages, { serial });

async function fails(work: Promise<unknown>): Promise<AppError> {
  try {
    await work;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error('expected a failure');
}

describe('preview', () => {
  it('reads a signed repository without storing anything', async () => {
    net.publish(REPO_A, signed(1, keyA, [pkg('alpha'), pkg('beta')]));
    const preview = await service.preview(REPO_A);
    expect(preview).toEqual({
      url: REPO_A,
      name: 'Test repo',
      trust: 'unverified',
      signingKey: keyA.publicKey,
      fingerprint: `${keyA.publicKey.slice(0, 12)}…${keyA.publicKey.slice(-4)}`,
      extensionCount: 2,
    });
    expect(repos.list()).toEqual([]);
    expect(db.emitted.flat()).not.toContain('repos');
  });

  it('calls a repository without a signature file unsigned', async () => {
    net.publish(REPO_A, unsigned());
    expect(await service.preview(REPO_A)).toMatchObject({ trust: 'unsigned', signingKey: null, fingerprint: null });
  });

  it('accepts the address with or without a trailing slash and with index.json', async () => {
    net.publish(REPO_A, unsigned());
    for (const input of [REPO_A, REPO_A.slice(0, -1), `${REPO_A}index.json`, `  ${REPO_A}index.json?x=1#top `]) {
      expect((await service.preview(input)).url).toBe(REPO_A);
    }
  });

  it('refuses an address that is not http(s) or carries a password', async () => {
    for (const input of ['not a url', 'file:///etc/passwd', 'ftp://repo.test/', 'https://user:pw@repo.test/']) {
      expect((await fails(service.preview(input))).code).toBe('invalid_input');
    }
    expect(net.requests).toEqual([]);
  });

  it('refuses an index whose signature does not match', async () => {
    const files = net.publish(REPO_A, signed());
    net.files.set(`${REPO_A}index.json`, Buffer.concat([files.get('index.json')!, Buffer.from(' ')]));
    const error = await fails(service.preview(REPO_A));
    expect(error.code).toBe('invalid_input');
    expect(error.message).toMatch(/signature/i);
  });

  it('refuses a signature file that cannot be read', async () => {
    net.publish(REPO_A, signed());
    net.files.set(`${REPO_A}index.json.sig`, Buffer.from('{"nope":true}'));
    expect((await fails(service.preview(REPO_A))).code).toBe('invalid_input');
  });

  it('refuses a broken index and one that is too large', async () => {
    net.files.set(`${REPO_A}index.json`, Buffer.from('{"format":1}'));
    expect((await fails(service.preview(REPO_A))).code).toBe('invalid_input');
    net.files.set(`${REPO_A}index.json`, Buffer.alloc(2 * 1024 * 1024 + 1, 0x20));
    const error = await fails(service.preview(REPO_A));
    expect(error).toMatchObject({ code: 'invalid_input' });
    expect(error.message).toMatch(/larger/);
  });

  it('says so when nothing is there, the host is down, or the machine is offline', async () => {
    expect(await fails(service.preview(REPO_A))).toMatchObject({ code: 'network' });
    expect((await fails(service.preview(REPO_A))).message).toMatch(/404/);
    net.publish(REPO_A, unsigned());
    net.unreachable.add('repo-a.test');
    expect(await fails(service.preview(REPO_A))).toMatchObject({ code: 'network' });
    net.offline = true;
    expect(await fails(service.preview(REPO_A))).toMatchObject({ code: 'offline' });
  });
});

describe('add', () => {
  it('stores the exact bytes, the announced key and the serial, and trusts nothing by default', async () => {
    const files = net.publish(REPO_A, signed(4));
    const info = await service.add(REPO_A, false);
    expect(info).toMatchObject({
      url: REPO_A,
      name: 'Test repo',
      trust: 'unverified',
      signingKey: keyA.publicKey,
      lastFetchedAt: 10_000,
      lastError: null,
      extensionCount: 1,
    });
    const row = repos.get(info.id)!;
    expect(Buffer.from(row.indexJson!, 'utf8')).toEqual(Buffer.from(files.get('index.json')!));
    expect(Buffer.from(row.signature!, 'utf8')).toEqual(Buffer.from(files.get('index.json.sig')!));
    expect(row).toMatchObject({ publicKey: null, signingKey: keyA.publicKey, serial: 4 });
    expect(db.emitted.flat()).toEqual(expect.arrayContaining(['repos', 'extensions']));
  });

  it('keeps a byte order mark, so the stored signature still verifies', async () => {
    const files = net.publish(REPO_A, signed());
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), files.get('index.json')!]);
    net.files.set(`${REPO_A}index.json`, withBom);
    net.files.set(`${REPO_A}index.json.sig`, Buffer.from(signIndex(withBom, keyA.privateKeyPem)));
    const info = await service.add(REPO_A, true);
    expect(info.trust).toBe('trusted');
    expect(service.list()[0]!.trust).toBe('trusted');
  });

  it('trusts the announced key when asked', async () => {
    net.publish(REPO_A, signed());
    const info = await service.add(REPO_A, true);
    expect(info.trust).toBe('trusted');
    expect(repos.get(info.id)!.publicKey).toBe(keyA.publicKey);
  });

  it('adds an unsigned repository, but there is no key to trust', async () => {
    net.publish(REPO_A, unsigned());
    expect((await fails(service.add(REPO_A, true))).code).toBe('invalid_input');
    expect(repos.list()).toEqual([]);
    expect(await service.add(REPO_A, false)).toMatchObject({ trust: 'unsigned', signingKey: null });
  });

  it('refuses an invalid signature and stores nothing', async () => {
    const files = net.publish(REPO_A, signed());
    net.files.set(`${REPO_A}index.json`, Buffer.concat([files.get('index.json')!, Buffer.from('\n')]));
    expect((await fails(service.add(REPO_A, true))).code).toBe('invalid_input');
    expect(repos.list()).toEqual([]);
  });

  it('refuses the same address twice, however it is written', async () => {
    net.publish(REPO_A, unsigned());
    await service.add(REPO_A, false);
    const error = await fails(service.add(`${REPO_A}index.json`, false));
    expect(error).toMatchObject({ code: 'invalid_input' });
    expect(error.message).toMatch(/already/);
  });
});

describe('refresh', () => {
  it('accepts a newer serial and a new index, and clears the last error', async () => {
    net.publish(REPO_A, signed(1));
    const { id } = await service.add(REPO_A, true);
    repos.recordError(id, 'old failure');
    net.publish(REPO_A, signed(2, keyA, [pkg('alpha'), pkg('beta')]));
    now = 20_000;
    expect(await service.refresh(id)).toEqual({ refreshed: 1, failed: [] });
    expect(service.list()[0]).toMatchObject({
      extensionCount: 2,
      lastFetchedAt: 20_000,
      lastError: null,
      trust: 'trusted',
    });
    expect(repos.get(id)!.serial).toBe(2);
  });

  it('accepts the same serial', async () => {
    net.publish(REPO_A, signed(3));
    const { id } = await service.add(REPO_A, false);
    net.publish(REPO_A, signed(3, keyA, [pkg('alpha'), pkg('beta')]));
    expect((await service.refresh(id)).refreshed).toBe(1);
    expect(service.list()[0]!.extensionCount).toBe(2);
  });

  it.each([
    ['a trusted repository', true],
    ['an unverified one', false],
  ])('refuses a serial that went down for %s, and keeps the old index', async (_label, trust) => {
    net.publish(REPO_A, signed(5));
    const { id } = await service.add(REPO_A, trust);
    const before = repos.get(id)!.indexJson;
    net.publish(REPO_A, signed(4, keyA, [pkg('alpha'), pkg('beta')]));
    const result = await service.refresh(id);
    expect(result.refreshed).toBe(0);
    expect(result.failed).toEqual([{ repoId: id, message: expect.stringMatching(/back in time/) }]);
    expect(repos.get(id)).toMatchObject({
      indexJson: before,
      serial: 5,
      lastError: expect.stringMatching(/back in time/),
    });
  });

  it('refuses an unsigned index from a trusted repository, and never lets go of the trusted key', async () => {
    net.publish(REPO_A, signed(1));
    const { id } = await service.add(REPO_A, true);
    net.publish(REPO_A, unsigned(2, [pkg('evil')]));
    const result = await service.refresh();
    expect(result.failed[0]!.message).toMatch(/no longer signed/);
    expect(repos.get(id)).toMatchObject({ publicKey: keyA.publicKey, serial: 1, lastError: expect.any(String) });
    expect(service.list()[0]).toMatchObject({ trust: 'trusted', extensionCount: 1 });
  });

  it('refuses an invalid signature from a trusted repository', async () => {
    net.publish(REPO_A, signed(1));
    const { id } = await service.add(REPO_A, true);
    const files = net.publish(REPO_A, signed(2));
    net.files.set(`${REPO_A}index.json`, Buffer.concat([files.get('index.json')!, Buffer.from(' ')]));
    expect((await service.refresh(id)).failed).toHaveLength(1);
    expect(repos.get(id)!.serial).toBe(1);
  });

  it('refuses an index signed by another key for a trusted repository', async () => {
    net.publish(REPO_A, signed(1));
    const { id } = await service.add(REPO_A, true);
    net.publish(REPO_A, signed(2, keyB, [pkg('evil')]));
    const result = await service.refresh(id);
    expect(result.failed[0]!.message).toMatch(/different key/);
    expect(repos.get(id)).toMatchObject({ publicKey: keyA.publicKey, signingKey: keyA.publicKey, serial: 1 });
  });

  it('lets an unverified repository change its key, or stop signing, freely', async () => {
    net.publish(REPO_A, signed(1));
    const { id } = await service.add(REPO_A, false);
    net.publish(REPO_A, signed(2, keyB));
    expect((await service.refresh(id)).refreshed).toBe(1);
    expect(repos.get(id)).toMatchObject({ signingKey: keyB.publicKey, publicKey: null });
    net.publish(REPO_A, unsigned(3));
    expect((await service.refresh(id)).refreshed).toBe(1);
    expect(repos.get(id)).toMatchObject({ signingKey: null, signature: null });
    expect(service.list()[0]!.trust).toBe('unsigned');
  });

  it('refuses a broken signature on an unverified repository too', async () => {
    net.publish(REPO_A, signed(1));
    const { id } = await service.add(REPO_A, false);
    const files = net.publish(REPO_A, signed(2));
    net.files.set(`${REPO_A}index.json`, Buffer.concat([files.get('index.json')!, Buffer.from(' ')]));
    expect((await service.refresh(id)).failed).toHaveLength(1);
  });

  it('does not let one failing repository stop the others', async () => {
    net.publish(REPO_A, signed(1));
    net.publish(REPO_B, unsigned(1));
    const a = await service.add(REPO_A, false);
    const b = await service.add(REPO_B, false);
    net.unreachable.add('repo-a.test');
    net.publish(REPO_B, unsigned(2, [pkg('alpha'), pkg('beta')]));
    const result = await service.refresh();
    expect(result.refreshed).toBe(1);
    expect(result.failed).toEqual([{ repoId: a.id, message: expect.stringMatching(/connection refused/) }]);
    expect(service.list().find((repo) => repo.id === b.id)!.extensionCount).toBe(2);
    expect(repos.get(a.id)!.lastError).toMatch(/connection refused/);
  });

  it('reports being offline without throwing, and does not blame the repository', async () => {
    net.publish(REPO_A, unsigned(1));
    const { id } = await service.add(REPO_A, false);
    net.offline = true;
    expect(await service.refresh()).toEqual({ refreshed: 0, failed: [{ repoId: id, message: 'You are offline' }] });
    expect(repos.get(id)!.lastError).toBeNull();
  });

  it('fails for a repository that is not in the list', async () => {
    expect((await fails(service.refresh(99))).code).toBe('not_found');
  });
});

describe('setTrust', () => {
  it('trusts the announced key and stops trusting it again', async () => {
    net.publish(REPO_A, signed());
    const { id } = await service.add(REPO_A, false);
    expect(service.setTrust(id, true)).toMatchObject({ trust: 'trusted' });
    expect(repos.get(id)!.publicKey).toBe(keyA.publicKey);
    expect(service.setTrust(id, true).trust).toBe('trusted');
    expect(service.setTrust(id, false)).toMatchObject({ trust: 'unverified' });
    expect(repos.get(id)!.publicKey).toBeNull();
  });

  it('cannot trust an unsigned repository, or one that is not there', async () => {
    net.publish(REPO_A, unsigned());
    const { id } = await service.add(REPO_A, false);
    expect(() => service.setTrust(id, true)).toThrowError(/no valid signature/);
    expect(() => service.setTrust(99, true)).toThrowError(AppError);
  });

  it('cannot trust a stored signature that no longer verifies', async () => {
    net.publish(REPO_A, signed());
    const { id } = await service.add(REPO_A, false);
    db.connection.sqlite.prepare('UPDATE extension_repos SET index_json = index_json || ? WHERE id = ?').run(' ', id);
    expect(() => service.setTrust(id, true)).toThrowError(/no valid signature/);
  });

  it('keeps refusing another key once a key is trusted', async () => {
    net.publish(REPO_A, signed(1));
    const { id } = await service.add(REPO_A, false);
    service.setTrust(id, true);
    net.publish(REPO_A, signed(2, keyB));
    expect((await service.refresh(id)).failed).toHaveLength(1);
  });
});

describe('remove', () => {
  it('forgets the repository, and installed extensions stay installed without a repository', async () => {
    net.publish(REPO_A, signed());
    const { id } = await service.add(REPO_A, true);
    db.store.upsertExtension(manifestFor('alpha'), 1, { repoId: id, installDir: '/x/alpha', sha256: 'aa' });
    service.remove(id);
    expect(service.list()).toEqual([]);
    expect(db.store.findExtension('alpha')).toMatchObject({ origin: 'repo', repoId: null, installDir: '/x/alpha' });
    expect(service.describe(id)).toBeNull();
    expect(service.newerVersion(id, 'alpha', '0.1.0')).toBeNull();
    expect(() => service.remove(id)).toThrowError(AppError);
  });
});

describe('available (EXT-5…9, EXT-15)', () => {
  const install = (id: string, version: string, repoId: number | null, origin: 'repo' | 'dev' = 'repo') => {
    db.store.upsertExtension(
      manifestFor(id, { version }),
      1,
      repoId === null ? undefined : { repoId, installDir: `/x/${id}`, sha256: 'aa' },
    );
    if (origin === 'dev') db.store.setInstall({ id, repoId: null, installDir: null, sha256: null, origin: 'dev' });
  };

  it('lists the entries of every repository with the install state', async () => {
    net.publish(REPO_A, signed(1, keyA, [pkg('alpha', '1.1.0'), pkg('beta'), pkg('gamma')]));
    const a = await service.add(REPO_A, true);
    install('alpha', '1.0.0', a.id);
    install('beta', '1.0.0', a.id);
    const list = service.available();
    expect(list.map((e) => e.id)).toEqual(['alpha', 'beta', 'gamma']);
    expect(list[0]).toMatchObject({
      repoId: a.id,
      repoName: 'Test repo',
      repoTrust: 'trusted',
      version: '1.1.0',
      installedVersion: '1.0.0',
      updateAvailable: true,
      incompatible: null,
      conflict: null,
      sources: [{ key: 'main', lang: 'en', name: 'Main' }],
    });
    expect(list[1]).toMatchObject({ installedVersion: '1.0.0', updateAvailable: false });
    expect(list[2]).toMatchObject({ installedVersion: null, updateAvailable: false });
  });

  it('flags an entry that needs a newer API or app', async () => {
    net.publish(
      REPO_A,
      signed(1, keyA, [
        pkg('alpha'),
        pkg('beta', '1.0.0', { minAppVersion: '2.0.0' }),
        pkg('gamma', '1.0.0', { minAppVersion: '1.0.0' }),
      ]),
    );
    net.mutateIndex(
      REPO_A,
      (index) => {
        index.extensions[0]!.apiVersion = 2;
      },
      keyA.privateKeyPem,
    );
    await service.add(REPO_A, false);
    expect(service.available().map((e) => [e.id, e.incompatible])).toEqual([
      ['alpha', 'api'],
      ['beta', 'app'],
      ['gamma', null],
    ]);
  });

  it('reports who already provides the id: a dev folder or another repository', async () => {
    net.publish(REPO_A, signed(1, keyA, [pkg('alpha'), pkg('beta'), pkg('gamma')]));
    net.publish(REPO_B, unsigned(1, [pkg('beta', '2.0.0')]));
    const a = await service.add(REPO_A, false);
    const b = await service.add(REPO_B, false);
    devLoaded.add('alpha');
    install('alpha', '1.0.0', null, 'dev');
    install('beta', '1.0.0', a.id);
    const forB = service.available().filter((e) => e.repoId === b.id);
    expect(forB).toHaveLength(1);
    expect(forB[0]).toMatchObject({
      id: 'beta',
      installedVersion: '1.0.0',
      updateAvailable: false,
      conflict: { kind: 'repo', repoId: a.id, repoName: 'Test repo' },
    });
    const forA = service.available().filter((e) => e.repoId === a.id);
    expect(forA.find((e) => e.id === 'alpha')).toMatchObject({ conflict: { kind: 'dev' }, installedVersion: '1.0.0' });
    expect(forA.find((e) => e.id === 'beta')).toMatchObject({ conflict: null, updateAvailable: false });
  });

  it('does not count a dev row whose folder is gone, nor an orphan of a removed repository, as a conflict', async () => {
    net.publish(REPO_A, signed(1, keyA, [pkg('alpha'), pkg('beta')]));
    const a = await service.add(REPO_A, false);
    install('alpha', '1.0.0', null, 'dev');
    install('beta', '1.0.0', a.id);
    db.connection.sqlite.prepare('UPDATE extensions SET repo_id = NULL WHERE id = ?').run('beta');
    const list = service.available();
    expect(list.find((e) => e.id === 'alpha')).toMatchObject({ installedVersion: null, conflict: null });
    expect(list.find((e) => e.id === 'beta')).toMatchObject({ conflict: null, updateAvailable: false });
  });

  it('leaves out 18+ entries unless showNsfw is on (EXT-15)', async () => {
    net.publish(REPO_A, signed(1, keyA, [pkg('alpha'), pkg('adult', '1.0.0', { nsfw: true })]));
    await service.add(REPO_A, false);
    expect(service.available().map((e) => e.id)).toEqual(['alpha']);
    db.settings.updateAppSettings({ showNsfw: true });
    expect(service.available().map((e) => e.id)).toEqual(['adult', 'alpha']);
  });

  it('filters by content language, with multi always passing and an empty list meaning all', async () => {
    net.publish(
      REPO_A,
      signed(1, keyA, [
        pkg('english', '1.0.0', { sources: [{ key: 'a', lang: 'en', name: 'A' }] }),
        pkg('indo', '1.0.0', { sources: [{ key: 'a', lang: 'id', name: 'A' }] }),
        pkg('both', '1.0.0', {
          sources: [
            { key: 'a', lang: 'en', name: 'A' },
            { key: 'b', lang: 'id', name: 'B' },
          ],
        }),
        pkg('many', '1.0.0', { sources: [{ key: 'a', lang: 'multi', name: 'A' }] }),
      ]),
    );
    await service.add(REPO_A, false);
    const ids = () => service.available().map((e) => e.id);
    expect(ids()).toEqual(['both', 'english', 'indo', 'many']);
    db.settings.updateAppSettings({ contentLanguages: ['id'] });
    expect(ids()).toEqual(['both', 'indo', 'many']);
    db.settings.updateAppSettings({ contentLanguages: ['ja'] });
    expect(ids()).toEqual(['many']);
  });

  it('shows nothing for a repository whose stored index is damaged', async () => {
    net.publish(REPO_A, unsigned());
    const { id } = await service.add(REPO_A, false);
    db.connection.sqlite.prepare('UPDATE extension_repos SET index_json = ? WHERE id = ?').run('{', id);
    expect(service.available()).toEqual([]);
    expect(service.list()[0]).toMatchObject({ extensionCount: 0 });
  });
});
