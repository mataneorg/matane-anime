import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type RepoPackageInput, type RepoKeyPair, generateKeyPair } from '@matane-anime/extension-repo';
import {
  AppError,
  type AvailableExtension,
  type ExtensionInfo,
  type InstallPreparation,
  type RepoInfo,
  type RepoPreview,
  type RepoRefreshResult,
  type SourceInfo,
  type UpdateAllResult,
  decodeIpcError,
} from '@matane-anime/shared';
import { type TestRepoOptions, TestSite, buildTestRepo, loadBuiltExtension } from '@matane-anime/test-site';
import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { launchApp } from './support/app';

// Phase 4, milestone 4g (backend level): extension repositories, signing, trust, installing, updating and
// removing extensions, EXT-9 conflicts and EXT-15 filters, against the real app and fake repositories served
// by the test site. The UI has its own spec (repo-ui.spec.ts); everything here goes through IPC.

const ROOT = resolve(__dirname, '../../..');
const EXAMPLE = resolve(ROOT, 'extensions/example');
const PROBE = resolve(__dirname, 'fixtures/extensions/probe');

test.describe.configure({ mode: 'serial' });

let site: TestSite;
let siteB: TestSite;
let app: ElectronApplication;
let page: Page;
let userData: string;

/** The key the test repository signs with, and the serial counter of its index. */
const keyA: RepoKeyPair = generateKeyPair();
let serial = 0;
/** Versions the repository publishes by default (what a later `publish()` with no options says). */
let exampleVersion = '1.0.0';
let legacyVersion: string | null = null;
let extras: RepoPackageInput[] = [];

/** `window.api.invoke`, with failures decoded the way the renderer does. */
async function invoke<T = unknown>(channel: string, input?: unknown): Promise<T> {
  const result = await page.evaluate(
    async ([c, i]) => {
      try {
        return {
          ok: true as const,
          value: await (window as unknown as { api: { invoke(c: string, i?: unknown): Promise<unknown> } }).api.invoke(
            c,
            i,
          ),
        };
      } catch (error) {
        return { ok: false as const, message: (error as Error).message };
      }
    },
    [channel, input] as const,
  );
  if (!result.ok) throw decodeIpcError(new Error(result.message));
  return result.value as T;
}

const fails = async (work: Promise<unknown>): Promise<AppError> => {
  try {
    await work;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error('expected the call to fail');
};

// ------------------------------------------------------------------ repository content

/** A hand-written extension whose `/series/…` urls became `/anime/…` in 1.1.0 (the example never had such a change). */
function legacyPackage(version: string): RepoPackageInput {
  const prefix = version === '1.0.0' ? '/series/' : '/anime/';
  const code = `(function () {
  globalThis.__extension = {
    preferences: function () { return []; },
    createSource: function () {
      return {
        baseUrl: 'http://legacy.test',
        getPopular: function () {
          return { items: [{ url: '${prefix}old-tale', title: 'Old Tale' }], hasNextPage: false };
        },
        search: function () { return { items: [], hasNextPage: false }; },
        getAnimeDetails: function (anime) { return { url: anime.url, title: anime.title, status: 'unknown' }; },
        getEpisodes: function () { return []; },
        getStreams: function () { return []; },
        migrateUrl: function (url) { return url.indexOf('/series/') === 0 ? url.replace('/series/', '/anime/') : null; },
      };
    },
  };
})();
`;
  return {
    manifest: {
      id: 'legacy',
      name: 'Legacy Site',
      version,
      apiVersion: 1,
      type: 'anime',
      nsfw: false,
      sources: [{ key: 'en', lang: 'en', name: 'Legacy Site (EN)' }],
    },
    code,
    icon: loadBuiltExtension(EXAMPLE).icon,
  };
}

/** A tiny extension for the filter tests: its id, 18+ flag and source languages are all that matter. */
function filterPackage(id: string, langs: string[], nsfw = false): RepoPackageInput {
  const code = `(function () {
  globalThis.__extension = {
    preferences: function () { return []; },
    createSource: function () {
      return {
        baseUrl: 'http://${id}.test',
        getPopular: function () { return { items: [{ url: '/${id}', title: '${id}' }], hasNextPage: false }; },
        search: function () { return { items: [], hasNextPage: false }; },
        getAnimeDetails: function (anime) { return { url: anime.url, title: anime.title, status: 'unknown' }; },
        getEpisodes: function () { return []; },
        getStreams: function () { return []; },
      };
    },
  };
})();
`;
  return {
    manifest: {
      id,
      name: `Filter ${id}`,
      version: '1.0.0',
      apiVersion: 1,
      type: 'anime',
      nsfw,
      sources: langs.map((lang) => ({ key: lang, lang, name: `${id} (${lang})` })),
    },
    code,
    icon: loadBuiltExtension(EXAMPLE).icon,
  };
}

/**
 * Builds a repository (example, plus `legacy` and `extras` when set) signed with `keyA`, and serves it.
 * Every call is a new index with a higher serial unless `serial` says otherwise.
 */
function publish(over: TestRepoOptions & { to?: TestSite } = {}) {
  const { to = site, ...options } = over;
  const extensions: (string | RepoPackageInput)[] = [
    EXAMPLE,
    ...(legacyVersion ? [legacyPackage(legacyVersion)] : []),
    ...extras,
  ];
  const repo = buildTestRepo({
    keyPair: keyA,
    serial: ++serial,
    extensions,
    ...(exampleVersion === '1.0.0' ? {} : { versionBump: exampleVersion }),
    ...options,
  });
  to.setRepo(repo.files);
  return repo;
}

// ------------------------------------------------------------------ app helpers

const repos = () => invoke<RepoInfo[]>('repos.list');
const available = () => invoke<AvailableExtension[]>('extensions.available');
const installedList = () => invoke<ExtensionInfo[]>('extensions.list');
const installedOf = async (id: string) => (await installedList()).find((e) => e.id === id && e.origin === 'repo');
const sources = () => invoke<SourceInfo[]>('sources.list');
const refresh = (id?: number) => invoke<RepoRefreshResult>('repos.refresh', id === undefined ? {} : { id });
const prepare = (repoId: number, extensionId: string) =>
  invoke<InstallPreparation>('extensions.prepareInstall', { repoId, extensionId });
const install = async (repoId: number, extensionId: string) =>
  invoke('extensions.install', { token: (await prepare(repoId, extensionId)).token });
const setPref = (extensionId: string, key: string, value: unknown) =>
  invoke('extensions.setPreference', { extensionId, key, value });
const popular = (sourceId: string) =>
  invoke<{ items: { animeId: number; title: string; url: string }[]; hasNextPage: boolean }>('sources.browse', {
    sourceId,
    kind: 'popular',
    page: 1,
  });
const installDir = (id: string) => join(userData, 'extensions', id);
const indexJs = (id: string) => readFileSync(join(installDir(id), 'index.js'), 'utf8');

async function startApp(): Promise<void> {
  ({ app, page, userData } = await launchApp({}, userData ? { userData } : {}));
  await page.waitForSelector('nav', { timeout: 30_000 });
}

/** Closes the app and opens it again on the same profile; `between` runs while it is closed. */
async function restart(between?: () => void): Promise<void> {
  await app.close();
  between?.();
  await startApp();
}

/** Asserts a refresh was refused and left everything as it was (index, installed extension, trust). */
async function expectRefused(repoId: number, message: RegExp): Promise<void> {
  const before = { available: await available(), extension: await installedOf('example') };
  const result = await refresh(repoId);
  expect(result.refreshed).toBe(0);
  expect(result.failed).toHaveLength(1);
  expect(result.failed[0]?.message).toMatch(message);
  const [info] = await repos();
  expect(info).toMatchObject({ id: repoId, trust: 'trusted', extensionCount: before.available.length });
  expect(info?.lastError).toMatch(message);
  expect(await available()).toEqual(before.available);
  expect(await installedOf('example')).toEqual(before.extension);
}

let repoA: RepoInfo;

test.beforeAll(async () => {
  site = await TestSite.start({ mediaDir: resolve(__dirname, 'fixtures/media') });
  siteB = await TestSite.start({ mediaDir: resolve(__dirname, 'fixtures/media') });
  execFileSync(process.execPath, [resolve(ROOT, 'packages/extension-cli/dist/cli.js'), 'build', EXAMPLE], {
    stdio: 'pipe',
  });
  await startApp();
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  await site?.close();
  await siteB?.close();
});

// ------------------------------------------------------------------ adding

test.describe('adding a repository (EXT-5, EXT-6, EXT-7)', () => {
  test('starts with no repositories and nothing to install', async () => {
    expect(await repos()).toEqual([]);
    expect(await available()).toEqual([]);
    expect(await installedList()).toEqual([]);
  });

  test('previews a signed repository as unverified and stores nothing', async () => {
    const repo = publish();
    const preview = await invoke<RepoPreview>('repos.preview', { url: site.repoUrl });
    expect(preview).toEqual({
      url: site.repoUrl,
      name: 'Test Repository',
      trust: 'unverified',
      signingKey: repo.publicKey,
      fingerprint: repo.fingerprint,
      extensionCount: 1,
    });
    // An address to index.json is the same repository.
    expect((await invoke<RepoPreview>('repos.preview', { url: `${site.repoUrl}index.json` })).url).toBe(site.repoUrl);
    expect(await repos()).toEqual([]);
  });

  test('previews an unsigned repository as unsigned, and has no key to trust', async () => {
    publish({ unsigned: true });
    expect(await invoke<RepoPreview>('repos.preview', { url: site.repoUrl })).toMatchObject({
      trust: 'unsigned',
      signingKey: null,
      fingerprint: null,
      extensionCount: 1,
    });
    expect((await fails(invoke('repos.add', { url: site.repoUrl, trustKey: true }))).code).toBe('invalid_input');
    expect(await repos()).toEqual([]);
  });

  test('explains why a repository cannot be added', async () => {
    publish({ tamperAfterSigning: true });
    const tampered = await fails(invoke('repos.preview', { url: site.repoUrl }));
    expect(tampered.code).toBe('invalid_input');
    expect(tampered.message).toMatch(/signature .* does not match/);
    expect((await fails(invoke('repos.add', { url: site.repoUrl, trustKey: true }))).code).toBe('invalid_input');

    publish({ badIndexJson: true });
    const broken = await fails(invoke('repos.preview', { url: site.repoUrl }));
    expect(broken.code).toBe('invalid_input');
    expect(broken.message.length).toBeGreaterThan(10);

    site.clearRepo();
    const missing = await fails(invoke('repos.preview', { url: site.repoUrl }));
    expect(missing.code).toBe('network');
    expect(missing.message).toMatch(/404/);

    const unreachable = await fails(invoke('repos.preview', { url: 'http://127.0.0.1:9/repo/' }));
    expect(unreachable.code).toBe('network');
    expect((await fails(invoke('repos.preview', { url: 'ftp://example.test/repo/' }))).code).toBe('invalid_input');
    expect((await fails(invoke('repos.preview', { url: 'not a url' }))).code).toBe('invalid_input');
    expect(await repos()).toEqual([]);
  });

  test('adds a repository and trusts its key; it is still trusted after a restart', async () => {
    const repo = publish();
    repoA = await invoke<RepoInfo>('repos.add', { url: site.repoUrl, trustKey: true });
    expect(repoA).toMatchObject({
      url: site.repoUrl,
      name: 'Test Repository',
      trust: 'trusted',
      signingKey: repo.publicKey,
      fingerprint: repo.fingerprint,
      extensionCount: 1,
      lastError: null,
    });
    expect(repoA.lastFetchedAt).toEqual(expect.any(Number));
    expect((await fails(invoke('repos.add', { url: site.repoUrl, trustKey: true }))).code).toBe('invalid_input');

    const offered = await available();
    await restart();
    // The app also re-reads its repositories when it starts, so only the fetch time differs.
    expect(await repos()).toEqual([{ ...repoA, lastFetchedAt: expect.any(Number) }]);
    expect(await available()).toEqual(offered);
  });
});

// ------------------------------------------------------------------ installing

test.describe('installing (EXT-8)', () => {
  test('lists what the repository offers, not installed yet', async () => {
    const [example, ...rest] = await available();
    expect(rest).toEqual([]);
    expect(example).toMatchObject({
      repoId: repoA.id,
      repoName: 'Test Repository',
      repoTrust: 'trusted',
      id: 'example',
      version: '1.0.0',
      nsfw: false,
      installedVersion: null,
      updateAvailable: false,
      incompatible: null,
      conflict: null,
    });
    expect(example?.sources.map((s) => s.key)).toEqual(['en', 'id']);
    expect(example?.size).toBeGreaterThan(0);
  });

  test('prepares an install, then installs it and the sources work', async () => {
    const [offered] = await available();
    const prepared = await prepare(repoA.id, 'example');
    expect(prepared.token).toMatch(/^[0-9a-f]{32}$/);
    expect(prepared.warnings).toEqual([]);
    expect(prepared.installedVersion).toBeNull();
    expect(prepared.repo).toEqual({
      id: repoA.id,
      name: 'Test Repository',
      trust: 'trusted',
      fingerprint: repoA.fingerprint,
    });
    expect(prepared.extension).toMatchObject({ id: 'example', version: '1.0.0', size: offered?.size, nsfw: false });
    expect(prepared.extension.sha256).toMatch(/^[0-9a-f]{64}$/);
    // Nothing is written before the second step.
    expect(existsSync(installDir('example'))).toBe(false);
    expect(await installedList()).toEqual([]);

    await invoke('extensions.install', { token: prepared.token });

    const info = await installedOf('example');
    expect(info).toMatchObject({
      id: 'example',
      key: 'example',
      folder: null,
      origin: 'repo',
      repoId: repoA.id,
      repoName: 'Test Repository',
      trust: 'trusted',
      version: '1.0.0',
      status: 'ready',
      error: null,
      shadowed: false,
      updateAvailable: null,
    });
    expect(readdirSync(installDir('example')).sort()).toEqual(['icon.png', 'index.js', 'manifest.json']);
    expect(readdirSync(join(userData, 'extensions')).sort()).toEqual(['example']);
    expect((await available())[0]).toMatchObject({ installedVersion: '1.0.0', updateAvailable: false });

    await setPref('example', 'baseUrl', site.origin);
    const list = await popular('example/en');
    expect(list.items).toHaveLength(12);
    expect(list.items[0]).toMatchObject({ title: 'Sky Harbor', url: '/anime/sky-harbor' });
    const refreshed = await invoke<{ episodes: unknown[] }>('anime.refresh', { animeId: list.items[0]?.animeId });
    expect(refreshed.episodes).toHaveLength(12);
    expect((await sources()).filter((s) => s.extensionId === 'example').map((s) => [s.id, s.available])).toEqual([
      ['example/en', true],
      ['example/id', true],
    ]);
  });

  test('a token works once, and a new preparation replaces the old token', async () => {
    const used = await prepare(repoA.id, 'example');
    await invoke('extensions.install', { token: used.token });
    const again = await fails(invoke('extensions.install', { token: used.token }));
    expect(again.code).toBe('invalid_input');
    expect(again.message).toMatch(/expired/);

    const first = await prepare(repoA.id, 'example');
    const second = await prepare(repoA.id, 'example');
    expect((await fails(invoke('extensions.install', { token: first.token }))).code).toBe('invalid_input');
    await invoke('extensions.install', { token: second.token });

    expect((await fails(invoke('extensions.install', { token: 'f'.repeat(32) }))).code).toBe('invalid_input');
    expect((await fails(prepare(repoA.id, 'nobody'))).code).toBe('not_found');
    expect((await fails(prepare(999, 'example'))).code).toBe('not_found');
    // Expiry after 5 minutes is covered by install.test.ts: the e2e has no clock to move.
    expect((await installedOf('example'))?.status).toBe('ready');
    expect((await popular('example/en')).items).toHaveLength(12);
  });
});

// ------------------------------------------------------------------ integrity

test.describe('integrity of installed files (EXT-8)', () => {
  test('refuses to load an extension whose index.js was changed, and a reinstall repairs it', async () => {
    const original = indexJs('example');
    await restart(() => writeFileSync(join(installDir('example'), 'index.js'), `${original}\n// edited by hand\n`));

    const broken = await installedOf('example');
    expect(broken).toMatchObject({ status: 'error', origin: 'repo', repoId: repoA.id, trust: 'trusted' });
    expect(broken?.error).toMatch(/changed/);
    expect(broken?.version).toBe('1.0.0');
    // Not loaded: its sources are listed but nothing runs.
    expect((await sources()).find((s) => s.id === 'example/en')?.available).toBe(false);
    expect((await fails(popular('example/en'))).code).toBe('not_found');
    expect(indexJs('example')).toContain('edited by hand');

    await install(repoA.id, 'example');
    expect(await installedOf('example')).toMatchObject({ status: 'ready', error: null });
    expect(indexJs('example')).toBe(original);
    expect((await popular('example/en')).items).toHaveLength(12);
    expect(readdirSync(join(userData, 'extensions')).sort()).toEqual(['example']);

    // It also loads again after a restart.
    await restart();
    expect(await installedOf('example')).toMatchObject({ status: 'ready', error: null });
    expect((await popular('example/en')).items).toHaveLength(12);
  });
});

// ------------------------------------------------------------------ updates

test.describe('updates (EXT-8, EXT-16)', () => {
  let legacyAnimeId: number;

  test('installs an extension whose urls will change, and puts one of its anime in the library', async () => {
    legacyVersion = '1.0.0';
    publish();
    expect(await refresh(repoA.id)).toEqual({ refreshed: 1, failed: [] });
    await install(repoA.id, 'legacy');

    const [item] = (await popular('legacy/en')).items;
    expect(item).toMatchObject({ url: '/series/old-tale', title: 'Old Tale' });
    legacyAnimeId = item?.animeId as number;
    await invoke('library.add', { animeId: legacyAnimeId, categoryIds: [] });
    expect(await invoke('anime.get', { animeId: legacyAnimeId })).toMatchObject({
      url: '/series/old-tale',
      inLibrary: true,
    });
  });

  test('shows a newer version as an update, and updates everything at once', async () => {
    exampleVersion = '1.1.0';
    legacyVersion = '1.1.0';
    publish();
    const before = indexJs('example');
    expect(await refresh(repoA.id)).toEqual({ refreshed: 1, failed: [] });

    expect(await installedOf('example')).toMatchObject({ version: '1.0.0', updateAvailable: '1.1.0' });
    expect(await installedOf('legacy')).toMatchObject({ version: '1.0.0', updateAvailable: '1.1.0' });
    const offered = await available();
    expect(offered.map((e) => [e.id, e.version, e.installedVersion, e.updateAvailable])).toEqual([
      ['example', '1.1.0', '1.0.0', true],
      ['legacy', '1.1.0', '1.0.0', true],
    ]);

    const result = await invoke<UpdateAllResult>('extensions.updateAll');
    expect(result).toEqual({ updated: ['example', 'legacy'], failed: [] });
    expect(await installedOf('example')).toMatchObject({ version: '1.1.0', updateAvailable: null, status: 'ready' });
    expect(await installedOf('legacy')).toMatchObject({ version: '1.1.0', updateAvailable: null, status: 'ready' });
    expect(indexJs('example')).not.toBe(before);
    expect(indexJs('example')).toContain('// version 1.1.0');
    expect(readdirSync(join(userData, 'extensions')).sort()).toEqual(['example', 'legacy']);
    // Still working, with the preferences it had.
    expect((await popular('example/en')).items).toHaveLength(12);
    expect((await available()).map((e) => e.updateAvailable)).toEqual([false, false]);

    const again = await fails(invoke('extensions.update', { extensionId: 'example' }));
    expect(again).toMatchObject({ code: 'invalid_input' });
    expect(again.message).toMatch(/up to date/);
    expect(await invoke<UpdateAllResult>('extensions.updateAll')).toEqual({ updated: [], failed: [] });
  });

  test('rewrote the stored urls of the library to the new layout (EXT-16)', async () => {
    expect(await invoke('anime.get', { animeId: legacyAnimeId })).toMatchObject({
      url: '/anime/old-tale',
      title: 'Old Tale',
      inLibrary: true,
    });
    // The extension now lists the new url and finds the same row instead of adding a second one.
    expect((await popular('legacy/en')).items[0]).toMatchObject({ animeId: legacyAnimeId, url: '/anime/old-tale' });
    expect(await invoke('anime.refresh', { animeId: legacyAnimeId })).toMatchObject({
      anime: { animeId: legacyAnimeId, url: '/anime/old-tale' },
    });
    // The baseline of the migration lives in a setting that IPC does not expose; the rewrite proves it moved.
  });
});

// ------------------------------------------------------------------ refusals

test.describe('a trusted repository refuses what it should (EXT-6, EXT-16)', () => {
  test.beforeAll(() => {
    legacyVersion = null;
  });

  test('keeps the old index when the new one is unsigned, signed by another key, older, or tampered with', async () => {
    publish();
    expect(await refresh(repoA.id)).toEqual({ refreshed: 1, failed: [] });
    const trustedSerial = serial;

    publish({ unsigned: true });
    await expectRefused(repoA.id, /no longer signed/);

    publish({ signedBy: generateKeyPair() });
    await expectRefused(repoA.id, /different key/);

    publish({ serial: trustedSerial - 1 });
    await expectRefused(repoA.id, /back in time/);

    publish({ tamperAfterSigning: true });
    await expectRefused(repoA.id, /signature .* does not match/);

    publish({ badIndexJson: true });
    await expectRefused(repoA.id, /./);

    // The next good index clears the error.
    publish();
    expect(await refresh(repoA.id)).toEqual({ refreshed: 1, failed: [] });
    expect((await repos())[0]).toMatchObject({ trust: 'trusted', lastError: null });
  });

  test('refuses an update whose archive has the wrong hash or size, or is too large', async () => {
    const files = indexJs('example');

    publish({ versionBump: '1.2.0', badArchiveHash: true });
    expect(await refresh(repoA.id)).toEqual({ refreshed: 1, failed: [] });
    expect(await installedOf('example')).toMatchObject({ updateAvailable: '1.2.0' });
    const hash = await fails(invoke('extensions.update', { extensionId: 'example' }));
    expect(hash.code).toBe('invalid_input');
    expect(hash.message).toMatch(/SHA-256/);
    expect((await fails(prepare(repoA.id, 'example'))).message).toMatch(/SHA-256/);
    const all = await invoke<UpdateAllResult>('extensions.updateAll');
    expect(all.updated).toEqual([]);
    expect(all.failed).toEqual([{ id: 'example', message: expect.stringMatching(/SHA-256/) }]);

    publish({ versionBump: '1.2.0', badSize: true });
    expect(await refresh(repoA.id)).toEqual({ refreshed: 1, failed: [] });
    const size = await fails(invoke('extensions.update', { extensionId: 'example' }));
    expect(size.code).toBe('invalid_input');
    expect(size.message).toMatch(/size/);

    // The server sends more than any archive may be; the app stops reading instead of keeping it.
    publish({ versionBump: '1.2.0', oversizedArchive: true });
    expect(await refresh(repoA.id)).toEqual({ refreshed: 1, failed: [] });
    const large = await fails(invoke('extensions.update', { extensionId: 'example' }));
    expect(large.code).toBe('invalid_input');
    expect(large.message).toMatch(/larger than allowed/);

    expect(await installedOf('example')).toMatchObject({ version: '1.1.0', status: 'ready', updateAvailable: '1.2.0' });
    expect(indexJs('example')).toBe(files);
    expect(readdirSync(join(userData, 'extensions')).sort()).toEqual(['example', 'legacy']);
    expect((await popular('example/en')).items).toHaveLength(12);
  });

  test('keeps working offline with the stored index and recovers when the repository is back', async () => {
    publish();
    expect(await refresh(repoA.id)).toEqual({ refreshed: 1, failed: [] });
    const offered = await available();

    await site.stop();
    try {
      const result = await refresh();
      expect(result.refreshed).toBe(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]).toMatchObject({ repoId: repoA.id, message: expect.stringMatching(/./) });
      expect((await repos())[0]).toMatchObject({ trust: 'trusted', extensionCount: 1 });
      expect(await available()).toEqual(offered);
      expect((await fails(prepare(repoA.id, 'example'))).code).toBe('network');
      expect((await installedOf('example'))?.status).toBe('ready');
    } finally {
      await site.resume();
    }
    await setPref('example', 'baseUrl', site.origin);
    expect((await popular('example/en')).items).toHaveLength(12);
    expect(await refresh()).toEqual({ refreshed: 1, failed: [] });
    expect((await repos())[0]?.lastError).toBeNull();
  });
});

// ------------------------------------------------------------------ trust

test.describe('trust (EXT-6)', () => {
  test('stopping to trust the key makes the repository unverified, and installs warn about it', async () => {
    const info = await invoke<RepoInfo>('repos.setTrust', { id: repoA.id, trusted: false });
    expect(info).toMatchObject({ trust: 'unverified', signingKey: repoA.signingKey, fingerprint: repoA.fingerprint });
    expect(await installedOf('example')).toMatchObject({ trust: 'unverified', status: 'ready' });
    expect((await available())[0]?.repoTrust).toBe('unverified');

    const prepared = await prepare(repoA.id, 'example');
    expect(prepared.warnings).toEqual(['unverified']);
    expect(prepared.repo.trust).toBe('unverified');

    expect(await invoke<RepoInfo>('repos.setTrust', { id: repoA.id, trusted: true })).toMatchObject({
      trust: 'trusted',
    });
    expect((await prepare(repoA.id, 'example')).warnings).toEqual([]);
    expect((await fails(invoke('repos.setTrust', { id: 999, trusted: true }))).code).toBe('not_found');
  });

  test('a key that changes is refused; the way back is to remove the repository and add it again', async () => {
    const newKey = generateKeyPair();
    publish({ keyPair: newKey });
    await expectRefused(repoA.id, /different key/);

    // Without being trusted any more, the same index would be accepted as a new unverified key.
    await invoke('repos.remove', { id: repoA.id });
    expect(await repos()).toEqual([]);
    expect(await available()).toEqual([]);
    // The installed copy stays and keeps working, without a repository to update from.
    expect(await installedOf('example')).toMatchObject({ status: 'ready', repoId: null, trust: null });
    expect((await popular('example/en')).items).toHaveLength(12);
    expect((await fails(invoke('extensions.update', { extensionId: 'example' }))).message).toMatch(/removed/);

    const preview = await invoke<RepoPreview>('repos.preview', { url: site.repoUrl });
    expect(preview).toMatchObject({ trust: 'unverified', signingKey: newKey.publicKey });
    repoA = await invoke<RepoInfo>('repos.add', { url: site.repoUrl, trustKey: true });
    expect(repoA).toMatchObject({ trust: 'trusted', signingKey: newKey.publicKey });
    // The new repository may take over the extension whose repository was removed.
    expect((await available())[0]).toMatchObject({ id: 'example', installedVersion: '1.1.0', conflict: null });
    await install(repoA.id, 'example');
    expect(await installedOf('example')).toMatchObject({ repoId: repoA.id, trust: 'trusted', status: 'ready' });
    // And the repository goes on signing with the new key from now on.
    Object.assign(keyA, newKey);
  });
});

// ------------------------------------------------------------------ EXT-9

test.describe('one origin per extension id (EXT-9)', () => {
  test('a second repository cannot install an id that the first one provides', async () => {
    publish({ to: siteB, name: 'Repo B', keyPair: generateKeyPair() });
    const repoB = await invoke<RepoInfo>('repos.add', { url: siteB.repoUrl, trustKey: false });
    expect(repoB).toMatchObject({ name: 'Repo B', trust: 'unverified' });

    const offered = await available();
    const fromA = offered.find((e) => e.repoId === repoA.id);
    const fromB = offered.find((e) => e.repoId === repoB.id);
    expect(fromA).toMatchObject({ conflict: null, installedVersion: '1.1.0' });
    expect(fromB).toMatchObject({
      id: 'example',
      conflict: { kind: 'repo', repoId: repoA.id, repoName: 'Test Repository' },
      installedVersion: '1.1.0',
      updateAvailable: false,
    });
    const refused = await fails(prepare(repoB.id, 'example'));
    expect(refused.code).toBe('forbidden');
    expect(refused.message).toMatch(/Test Repository/);
    expect(await installedOf('example')).toMatchObject({ repoId: repoA.id });

    // Uninstalling frees the id for the other repository.
    await invoke('extensions.uninstall', { extensionId: 'example' });
    expect((await available()).find((e) => e.repoId === repoB.id)?.conflict).toBeNull();
    await install(repoB.id, 'example');
    expect(await installedOf('example')).toMatchObject({ repoId: repoB.id, repoName: 'Repo B', trust: 'unverified' });
    // Back to the first repository for the rest.
    await invoke('extensions.uninstall', { extensionId: 'example' });
    await invoke('repos.remove', { id: repoB.id });
    await install(repoA.id, 'example');
    await setPref('example', 'baseUrl', site.origin);
    expect(await repos()).toHaveLength(1);
  });

  test('a dev folder shadows the installed copy and gives it back when removed', async () => {
    const dev = await invoke<ExtensionInfo>('extensions.loadDevFolder', { folder: EXAMPLE });
    expect(dev).toMatchObject({ id: 'example', origin: 'dev', status: 'ready', shadowed: false });

    const both = (await installedList()).filter((e) => e.id === 'example');
    expect(both.map((e) => [e.origin, e.shadowed, e.status]).sort()).toEqual([
      ['dev', false, 'ready'],
      ['repo', true, 'ready'],
    ]);
    expect((await popular('example/en')).items).toHaveLength(12);

    const offered = (await available()).find((e) => e.id === 'example');
    expect(offered?.conflict).toEqual({ kind: 'dev' });
    const refused = await fails(prepare(repoA.id, 'example'));
    expect(refused.code).toBe('forbidden');
    expect(refused.message).toMatch(/dev folder/);
    expect((await fails(invoke('extensions.uninstall', { extensionId: 'example' }))).code).toBe('forbidden');

    await invoke('extensions.removeDevFolder', { folder: EXAMPLE });
    expect((await installedList()).filter((e) => e.id === 'example')).toHaveLength(1);
    expect(await installedOf('example')).toMatchObject({ shadowed: false, status: 'ready', version: '1.1.0' });
    expect((await available()).find((e) => e.id === 'example')?.conflict).toBeNull();
    expect((await popular('example/en')).items).toHaveLength(12);
  });

  test('a dev extension cannot be uninstalled', async () => {
    await invoke('extensions.loadDevFolder', { folder: PROBE });
    const refused = await fails(invoke('extensions.uninstall', { extensionId: 'probe' }));
    expect(refused.code).toBe('forbidden');
    expect(refused.message).toMatch(/folder/);
    await invoke('extensions.removeDevFolder', { folder: PROBE });
    expect((await fails(invoke('extensions.uninstall', { extensionId: 'nobody' }))).code).toBe('not_found');
  });
});

// ------------------------------------------------------------------ uninstall

test.describe('uninstalling (EXT-8)', () => {
  test('removes files and preferences, keeps the sources and the anime in the library', async () => {
    await setPref('example', 'showDub', false);
    const [sky] = (await popular('example/en')).items;
    await invoke('library.add', { animeId: sky?.animeId, categoryIds: [] });
    await invoke('anime.refresh', { animeId: sky?.animeId });
    const episodes = await invoke<unknown[]>('episodes.list', { animeId: sky?.animeId });
    expect(episodes).toHaveLength(12);

    await invoke('extensions.uninstall', { extensionId: 'example' });

    expect(existsSync(installDir('example'))).toBe(false);
    expect(readdirSync(join(userData, 'extensions'))).toEqual(['legacy']);
    expect(await installedOf('example')).toBeUndefined();
    expect((await available()).find((e) => e.id === 'example')).toMatchObject({
      installedVersion: null,
      updateAvailable: false,
    });
    expect((await sources()).filter((s) => s.extensionId === 'example').map((s) => [s.id, s.available])).toEqual([
      ['example/en', false],
      ['example/id', false],
    ]);
    // The anime is still in the library and opens from the database; only fetching needs the extension.
    expect(await invoke('anime.get', { animeId: sky?.animeId })).toMatchObject({
      title: 'Sky Harbor',
      inLibrary: true,
    });
    expect(await invoke<unknown[]>('episodes.list', { animeId: sky?.animeId })).toHaveLength(12);
    expect((await fails(invoke('anime.refresh', { animeId: sky?.animeId }))).code).toBe('not_found');
    expect((await fails(popular('example/en'))).code).toBe('not_found');
    // Another extension is not touched.
    expect(await installedOf('legacy')).toMatchObject({ status: 'ready' });

    await restart();
    expect(await installedOf('example')).toBeUndefined();
    expect(existsSync(installDir('example'))).toBe(false);

    // Installing again starts from the defaults: the preferences did not survive.
    await install(repoA.id, 'example');
    const state = await invoke<{ values: Record<string, unknown> }>('extensions.preferences', {
      extensionId: 'example',
    });
    expect(state.values['showDub']).toBe(true);
    expect(state.values['baseUrl']).not.toBe(site.origin);
    await setPref('example', 'baseUrl', site.origin);
    expect((await sources()).find((s) => s.id === 'example/en')?.available).toBe(true);
    expect((await popular('example/en')).items[0]?.animeId).toBe(sky?.animeId);
  });
});

// ------------------------------------------------------------------ EXT-15

test.describe('18+ and content languages (EXT-15)', () => {
  const set = (patch: Record<string, unknown>) => invoke('settings.set', patch);
  const ids = (list: { id: string }[]) => list.map((e) => e.id).sort();

  test.afterAll(async () => {
    await set({ showNsfw: false, contentLanguages: [] }).catch(() => undefined);
  });

  test('hides 18+ extensions from Available, blocks browsing them, and never filters Installed', async () => {
    extras = [filterPackage('adult', ['en'], true), filterPackage('indo', ['id']), filterPackage('poly', ['multi'])];
    legacyVersion = null;
    publish();
    expect(await refresh(repoA.id)).toEqual({ refreshed: 1, failed: [] });

    expect((await invoke<{ showNsfw: boolean }>('settings.get')).showNsfw).toBe(false);
    expect(ids(await available())).toEqual(['example', 'indo', 'poly']);
    await set({ showNsfw: true });
    const withAdult = await available();
    expect(ids(withAdult)).toEqual(['adult', 'example', 'indo', 'poly']);
    expect(withAdult.find((e) => e.id === 'adult')?.nsfw).toBe(true);

    expect((await prepare(repoA.id, 'adult')).warnings).toEqual(['nsfw']);
    await install(repoA.id, 'adult');
    expect((await popular('adult/en')).items).toHaveLength(1);
    expect(ids(await sources())).toContain('adult/en');

    await set({ showNsfw: false });
    expect(ids(await available())).not.toContain('adult');
    expect((await fails(popular('adult/en'))).code).toBe('forbidden');
    expect((await fails(invoke('sources.filters', { sourceId: 'adult/en' }))).code).toBe('forbidden');
    expect(ids(await sources())).not.toContain('adult/en');
    expect(await installedOf('adult')).toMatchObject({ nsfw: true, status: 'ready' });
    // 18+ is checked in main: preparing an install is not the gate (the dialog warns), browsing is.
    await set({ showNsfw: true });
    expect((await popular('adult/en')).items).toHaveLength(1);
    await set({ showNsfw: false });
  });

  test('content languages filter Available and the sources, `multi` always passes, Installed is not filtered', async () => {
    await install(repoA.id, 'indo');
    await install(repoA.id, 'poly');
    expect(ids(await sources()).filter((id) => /^(indo|poly)\//.test(id))).toEqual(['indo/id', 'poly/multi']);

    await set({ contentLanguages: ['en'] });
    // example offers en and id, so it stays; the id-only extension is hidden, `multi` passes.
    expect(ids(await available())).toEqual(['example', 'poly']);
    const visible = ids(await sources());
    expect(visible).toEqual(expect.arrayContaining(['example/en', 'poly/multi']));
    expect(visible).not.toContain('example/id');
    expect(visible).not.toContain('indo/id');
    expect((await installedList()).map((e) => e.id)).toEqual(
      expect.arrayContaining(['example', 'indo', 'poly', 'legacy']),
    );

    await set({ contentLanguages: [] });
    expect(ids(await available())).toEqual(['example', 'indo', 'poly']);
    expect(ids(await sources())).toEqual(expect.arrayContaining(['example/id', 'indo/id']));
  });

  // The nsfw flag is kept on the source row, so the sources of an uninstalled 18+ extension stay hidden.
  test('keeps the sources of an uninstalled 18+ extension hidden while 18+ is off', async () => {
    await invoke('extensions.uninstall', { extensionId: 'adult' });
    expect(ids(await sources())).not.toContain('adult/en');
  });
});
