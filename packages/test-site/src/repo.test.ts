import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  MAX_ARCHIVE_BYTES,
  fingerprint,
  generateKeyPair,
  parseIndex,
  readArchive,
  verifyRepoFiles,
  type RepoPackageInput,
} from '@matane-anime/extension-repo';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestSite, exampleExtensionDir, buildTestRepo, loadBuiltExtension } from './index.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const ICON = new Uint8Array(await readFile(join(ROOT, 'extensions/example/icon.png')));

const manifest = (id: string, version = '1.0.0'): RepoPackageInput['manifest'] => ({
  id,
  name: `Extension ${id}`,
  version,
  apiVersion: 1,
  type: 'anime',
  nsfw: false,
  sources: [{ key: 'en', lang: 'en', name: id }],
});
const pkg = (id: string, version?: string): RepoPackageInput => ({
  manifest: manifest(id, version),
  code: `globalThis.__extension = { id: ${JSON.stringify(id)} };`,
  icon: ICON,
});
const A = pkg('alpha');
const B = pkg('beta');

const problemCodes = (files: Map<string, Uint8Array>, trustedKey?: string): string[] =>
  verifyRepoFiles(files, { trustedKey: trustedKey ?? null })
    .map((p) => p.code)
    .sort();
const indexOf = (files: Map<string, Uint8Array>) => parseIndex(files.get('index.json') as Uint8Array);

describe('buildTestRepo', () => {
  it('builds a signed repository that verifies against its own key', () => {
    const repo = buildTestRepo({ extensions: [A, B], name: 'Mine', serial: 4 });
    expect([...repo.files.keys()]).toEqual([
      'alpha-1.0.0.zip',
      'alpha.png',
      'beta-1.0.0.zip',
      'beta.png',
      'index.json',
      'index.json.sig',
    ]);
    expect(problemCodes(repo.files)).toEqual([]);
    expect(problemCodes(repo.files, repo.publicKey)).toEqual([]);
    expect(indexOf(repo.files)).toMatchObject({ name: 'Mine', serial: 4 });
    expect(repo.fingerprint).toBe(fingerprint(repo.publicKey));
    expect(readArchive(repo.files.get('alpha-1.0.0.zip') as Uint8Array).manifest.id).toBe('alpha');
  });

  it('uses a fresh key pair each time unless given one', () => {
    const first = buildTestRepo({ extensions: [A] });
    expect(buildTestRepo({ extensions: [A] }).publicKey).not.toBe(first.publicKey);
    const keyPair = generateKeyPair();
    const given = buildTestRepo({ extensions: [A], keyPair });
    expect(given).toMatchObject({ publicKey: keyPair.publicKey, privateKeyPem: keyPair.privateKeyPem });
    expect(problemCodes(given.files, keyPair.publicKey)).toEqual([]);
  });

  it('writes absolute references with archiveBase', () => {
    const repo = buildTestRepo({ extensions: [A], archiveBase: 'http://127.0.0.1:1/repo/' });
    expect(indexOf(repo.files).extensions[0]).toMatchObject({
      archive: 'http://127.0.0.1:1/repo/alpha-1.0.0.zip',
      icon: 'http://127.0.0.1:1/repo/alpha.png',
    });
    expect(problemCodes(repo.files)).toEqual([]);
  });

  it('leaves out the signature when unsigned, which only a trusted key objects to', () => {
    const repo = buildTestRepo({ extensions: [A], unsigned: true });
    expect(repo.files.has('index.json.sig')).toBe(false);
    expect(problemCodes(repo.files)).toEqual([]);
    expect(problemCodes(repo.files, repo.publicKey)).toEqual(['unsigned']);
  });

  it('signs with another key: valid by itself, the wrong signer for the trusted key', () => {
    const other = generateKeyPair();
    const repo = buildTestRepo({ extensions: [A], signedBy: other });
    expect(problemCodes(repo.files)).toEqual([]);
    expect(problemCodes(repo.files, repo.publicKey)).toEqual(['key_changed']);
    expect(problemCodes(repo.files, other.publicKey)).toEqual([]);
    expect(repo.publicKey).not.toBe(other.publicKey);
  });

  it('detects a wrong archive hash, a wrong size and an oversized archive', () => {
    expect(problemCodes(buildTestRepo({ extensions: [A], badArchiveHash: true }).files)).toEqual(['hash_mismatch']);
    expect(problemCodes(buildTestRepo({ extensions: [A], badSize: true }).files)).toEqual(['size_mismatch']);
    const huge = buildTestRepo({ extensions: [A], oversizedArchive: true });
    expect(huge.files.get('alpha-1.0.0.zip')?.length).toBe(MAX_ARCHIVE_BYTES + 1);
    expect(problemCodes(huge.files)).toEqual(['too_large']);
  });

  it('keeps the signature valid for the lying index, so only the content check can catch it', () => {
    const repo = buildTestRepo({ extensions: [A], badArchiveHash: true });
    expect(verifyRepoFiles(repo.files, { trustedKey: repo.publicKey }).map((p) => p.code)).not.toContain(
      'invalid_signature',
    );
  });

  it('aims the switches at the target extension only', () => {
    const repo = buildTestRepo({ extensions: [A, B], target: 'beta', badArchiveHash: true });
    expect(verifyRepoFiles(repo.files).map((p) => [p.id, p.code])).toEqual([['beta', 'hash_mismatch']]);
    expect(() => buildTestRepo({ extensions: [A], target: 'nope' })).toThrow(/No extension nope/);
  });

  it('writes an index that is not JSON, signed or not', () => {
    const repo = buildTestRepo({ extensions: [A], badIndexJson: true });
    expect(() => JSON.parse(Buffer.from(repo.files.get('index.json') as Uint8Array).toString())).toThrow();
    expect(problemCodes(repo.files, repo.publicKey)).toEqual(['bad_index']);
  });

  it('changes the index after signing', () => {
    const repo = buildTestRepo({ extensions: [A], tamperAfterSigning: true });
    expect(indexOf(repo.files).name).toMatch(/\(changed\)$/);
    expect(problemCodes(repo.files)).toEqual(['invalid_signature']);
  });

  it('publishes a new version of the same extension with another hash', () => {
    const v1 = buildTestRepo({ extensions: [A], keyPair: generateKeyPair() });
    const v2 = buildTestRepo({ extensions: [A, B], versionBump: '1.1.0', serial: 2 });
    const entries = Object.fromEntries(indexOf(v2.files).extensions.map((e) => [e.id, e]));
    expect(entries['alpha']).toMatchObject({ version: '1.1.0', archive: 'alpha-1.1.0.zip' });
    expect(entries['beta']?.version).toBe('1.0.0');
    expect(entries['alpha']?.sha256).not.toBe(indexOf(v1.files).extensions[0]?.sha256);
    const archive = readArchive(v2.files.get('alpha-1.1.0.zip') as Uint8Array);
    expect(archive.manifest.version).toBe('1.1.0');
    expect(Buffer.from(archive.code).toString()).toContain('// version 1.1.0');
    expect(problemCodes(v2.files, v2.publicKey)).toEqual([]);
  });

  it('refuses a duplicate id', () => {
    expect(() => buildTestRepo({ extensions: [A, A] })).toThrow(/unique/);
  });
});

describe('loadBuiltExtension', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'test-repo-'));
  });
  afterEach(async () => rm(dir, { recursive: true, force: true }));

  it('reads dist/ and accepts directories next to ready packages', async () => {
    await mkdir(join(dir, 'dist'));
    await writeFile(join(dir, 'dist/manifest.json'), JSON.stringify(manifest('gamma')));
    await writeFile(join(dir, 'dist/index.js'), 'globalThis.__extension = {};');
    await writeFile(join(dir, 'dist/icon.png'), ICON);
    expect(loadBuiltExtension(dir).manifest.id).toBe('gamma');
    const repo = buildTestRepo({ extensions: [dir, A] });
    expect(indexOf(repo.files).extensions.map((e) => e.id)).toEqual(['alpha', 'gamma']);
    expect(problemCodes(repo.files, repo.publicKey)).toEqual([]);
  });

  it('says to build first', () => {
    expect(() => loadBuiltExtension(dir)).toThrow(/ma-ext build/);
  });

  it.skipIf(!existsSync(join(exampleExtensionDir(), 'dist/index.js')))('defaults to the built example', () => {
    const repo = buildTestRepo();
    expect(indexOf(repo.files).extensions.map((e) => e.id)).toEqual(['example']);
    expect(problemCodes(repo.files, repo.publicKey)).toEqual([]);
  });
});

describe('serving a repository', () => {
  let site: TestSite;
  beforeAll(async () => {
    site = await TestSite.start({ mediaDir: join(ROOT, 'apps/desktop/e2e/fixtures/media') });
  });
  afterAll(async () => site.close());
  beforeEach(() => site.reset());

  it('serves the files under repoUrl with their content types, and 404s for the rest', async () => {
    const repo = buildTestRepo({ extensions: [A] });
    expect(site.repoUrl).toBe(`${site.origin}/repo/`);
    expect((await fetch(`${site.repoUrl}index.json`)).status).toBe(404);
    site.setRepo(repo.files);

    const index = await fetch(`${site.repoUrl}index.json`);
    expect([index.status, index.headers.get('content-type')]).toEqual([200, 'application/json']);
    expect(index.headers.get('cache-control')).toBe('no-store');
    expect(Buffer.from(await index.arrayBuffer()).equals(repo.files.get('index.json') as Uint8Array)).toBe(true);
    expect((await fetch(`${site.repoUrl}index.json.sig`)).headers.get('content-type')).toBe('application/json');
    expect((await fetch(`${site.repoUrl}alpha-1.0.0.zip`)).headers.get('content-type')).toBe('application/zip');
    const icon = await fetch(`${site.repoUrl}alpha.png`);
    expect(icon.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await icon.arrayBuffer()).equals(ICON)).toBe(true);

    for (const missing of ['nope.json', '', 'sub/index.json']) {
      expect((await fetch(`${site.repoUrl}${missing}`)).status).toBe(404);
    }
    expect((await fetch(`${site.repoUrl}index.json`, { method: 'POST' })).status).toBe(405);
  });

  it('answers HEAD without a body, and logs the requests', async () => {
    site.setRepo(buildTestRepo({ extensions: [A] }).files);
    const head = await fetch(`${site.repoUrl}alpha.png`, { method: 'HEAD' });
    expect([head.status, head.headers.get('content-length'), (await head.arrayBuffer()).byteLength]).toEqual([
      200,
      String(ICON.length),
      0,
    ]);
    expect(site.log.at(-1)).toMatchObject({ server: 'site', method: 'HEAD', path: '/repo/alpha.png', status: 200 });
  });

  it('replaces the files on setRepo, and clearRepo and reset take them away', async () => {
    site.setRepo(buildTestRepo({ extensions: [A] }).files);
    expect((await fetch(`${site.repoUrl}alpha.png`)).status).toBe(200);
    site.setRepo(buildTestRepo({ extensions: [B] }).files);
    expect((await fetch(`${site.repoUrl}alpha.png`)).status).toBe(404);
    expect((await fetch(`${site.repoUrl}beta.png`)).status).toBe(200);
    site.clearRepo();
    expect((await fetch(`${site.repoUrl}beta.png`)).status).toBe(404);
    site.setRepo(buildTestRepo({ extensions: [B] }).files);
    site.reset();
    expect((await fetch(`${site.repoUrl}index.json`)).status).toBe(404);
  });

  it('serves a repository that a verifier can fetch whole', async () => {
    const repo = buildTestRepo({ extensions: [A, B], archiveBase: site.repoUrl });
    site.setRepo(repo.files);
    const fetched = new Map<string, Uint8Array>();
    for (const name of repo.files.keys()) {
      fetched.set(name, new Uint8Array(await (await fetch(`${site.repoUrl}${name}`)).arrayBuffer()));
    }
    expect(problemCodes(fetched, repo.publicKey)).toEqual([]);
  });
});
