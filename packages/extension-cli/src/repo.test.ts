import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { generateKeyPair, signIndex, type RepoProblem } from '@matane-anime/extension-repo';
import { afterEach, describe, expect, it } from 'vitest';
import { buildExtension } from './build';
import { buildRepo, keygen, verifyRepo } from './repo';

const ROOT = resolve(import.meta.dirname, '../../..');
const ICON = join(ROOT, 'extensions/example/icon.png');
// Inside this package so `@matane-anime/extension-sdk` resolves from node_modules above it.
const SCRATCH = join(import.meta.dirname, '../node_modules/.cache/cli-tests');

const dirs: string[] = [];
const servers: Server[] = [];
async function tempDir(): Promise<string> {
  await mkdir(SCRATCH, { recursive: true });
  const dir = await mkdtemp(join(SCRATCH, 'repo-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise((done) => server.close(done).closeAllConnections());
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** A built extension (`dist/` with bundle, manifest and icon) in a scratch directory. */
async function builtExtension(id: string, options: { version?: string; icon?: boolean; build?: boolean } = {}) {
  const dir = join(await tempDir(), id);
  await mkdir(join(dir, 'src'), { recursive: true });
  const manifest = {
    id,
    name: `Ext ${id}`,
    version: options.version ?? '1.0.0',
    apiVersion: 1,
    type: 'anime',
    sources: [{ key: 'en', lang: 'en', name: id }],
  };
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(dir, 'src/index.ts'), 'export default { createSource: () => ({}) };');
  if (options.icon !== false) await copyFile(ICON, join(dir, 'icon.png'));
  if (options.build !== false) await buildExtension(dir);
  return dir;
}

async function keyFiles() {
  const out = await tempDir();
  const { privateKeyPath, publicKey } = await keygen(out);
  return { pem: privateKeyPath, publicKey };
}

async function readRepo(dir: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  for (const name of await readdir(dir)) files.set(name, await readFile(join(dir, name)));
  return files;
}
function flipByte(bytes: Buffer): void {
  const at = bytes.length >> 1;
  bytes.writeUInt8(bytes.readUInt8(at) ^ 0xff, at);
}
const codes = (problems: RepoProblem[]): string[] => problems.map((p) => p.code);

describe('repo keygen', () => {
  it('writes a private key readable only by the owner and a public key, and never overwrites', async () => {
    const out = join(await tempDir(), 'keys');
    const result = await keygen(out);
    expect(await readFile(result.publicKeyPath, 'utf8')).toBe(`${result.publicKey}\n`);
    expect(result.publicKey).toMatch(/^ed25519:[0-9a-f]{64}$/);
    expect(result.fingerprint).toMatch(/^ed25519:[0-9a-f]{4}…[0-9a-f]{4}$/);
    expect(await readFile(result.privateKeyPath, 'utf8')).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    if (process.platform !== 'win32') {
      expect((await stat(result.privateKeyPath)).mode & 0o777).toBe(0o600);
    }
    const before = await readFile(result.privateKeyPath, 'utf8');
    await expect(keygen(out)).rejects.toThrow(/already exists/);
    expect(await readFile(result.privateKeyPath, 'utf8')).toBe(before);
  });

  it('refuses when only the public key exists', async () => {
    const out = await tempDir();
    await writeFile(join(out, 'repo-key.pub'), 'x');
    await expect(keygen(out)).rejects.toThrow(/repo-key\.pub already exists/);
    await expect(readFile(join(out, 'repo-key.pem'))).rejects.toThrow();
  });
});

describe('repo build and verify', () => {
  it('builds a signed repository that verifies, against its own key too', async () => {
    const ext = await builtExtension('alpha');
    const { pem, publicKey } = await keyFiles();
    const out = join(await tempDir(), 'repo');
    const result = await buildRepo([ext], { out, name: 'Test repo', key: pem });
    expect(result).toMatchObject({ serial: 1, publicKey, extensions: [{ id: 'alpha', version: '1.0.0' }] });
    expect([...(await readRepo(out)).keys()]).toEqual(['alpha-1.0.0.zip', 'alpha.png', 'index.json', 'index.json.sig']);

    const plain = await verifyRepo(out);
    expect(plain).toMatchObject({ ok: true, name: 'Test repo', serial: 1, signature: 'unverified', keyChecked: false });
    expect(plain.announcedKey).toBe(publicKey);
    expect(plain.warnings.join()).toMatch(/No --key given/);
    expect(await verifyRepo(out, { key: publicKey })).toMatchObject({
      ok: true,
      signature: 'trusted',
      keyChecked: true,
    });
  });

  it('builds several extensions and lists exactly the ones given, keeping unrelated files', async () => {
    const [a, b] = [await builtExtension('alpha'), await builtExtension('beta')];
    const { pem } = await keyFiles();
    const out = await tempDir();
    await writeFile(join(out, 'README.txt'), 'mine');
    await buildRepo([a, b], { out, name: 'R', key: pem });
    expect((await verifyRepo(out)).extensions.map((e) => e.id)).toEqual(['alpha', 'beta']);
    await buildRepo([b], { out, name: 'R', key: pem });
    const report = await verifyRepo(out);
    expect(report.extensions.map((e) => e.id)).toEqual(['beta']);
    expect(report.ok).toBe(true);
    expect(await readFile(join(out, 'README.txt'), 'utf8')).toBe('mine');
    expect(await readdir(out)).toContain('alpha-1.0.0.zip');
  });

  it('raises the serial from the previous index, or takes --serial', async () => {
    const ext = await builtExtension('alpha');
    const { pem } = await keyFiles();
    const out = await tempDir();
    expect((await buildRepo([ext], { out, name: 'R', key: pem })).serial).toBe(1);
    expect((await buildRepo([ext], { out, name: 'R', key: pem })).serial).toBe(2);
    expect((await verifyRepo(out)).serial).toBe(2);
    expect((await buildRepo([ext], { out, name: 'R', key: pem, serial: 10 })).serial).toBe(10);
    const lower = await buildRepo([ext], { out, name: 'R', key: pem, serial: 3 });
    expect(lower.serial).toBe(3);
    expect(lower.warnings.join()).toMatch(/lower than the previous 10/);
  });

  it('refuses to guess a serial when the previous index is unreadable', async () => {
    const ext = await builtExtension('alpha');
    const out = await tempDir();
    await writeFile(join(out, 'index.json'), '{ nope');
    await expect(buildRepo([ext], { out, name: 'R', unsigned: true })).rejects.toThrow(/not a valid index/);
    expect((await buildRepo([ext], { out, name: 'R', unsigned: true, serial: 1 })).serial).toBe(1);
  });

  it('needs a key or an explicit --unsigned, and warns about the latter', async () => {
    const ext = await builtExtension('alpha');
    const out = await tempDir();
    await expect(buildRepo([ext], { out, name: 'R' })).rejects.toThrow(/signed by default/);
    const { pem } = await keyFiles();
    await expect(buildRepo([ext], { out, name: 'R', key: pem, unsigned: true })).rejects.toThrow(/not both/);
    const result = await buildRepo([ext], { out, name: 'R', unsigned: true });
    expect(result.publicKey).toBeNull();
    expect(result.warnings.join()).toMatch(/Unverified repository/);
    expect(await readdir(out)).toEqual(['alpha-1.0.0.zip', 'alpha.png', 'index.json']);

    const report = await verifyRepo(out);
    expect(report).toMatchObject({ ok: true, signature: 'unsigned', announcedKey: null });
    expect(report.warnings.join()).toMatch(/not signed/);
    const strict = await verifyRepo(out, { key: (await keyFiles()).publicKey });
    expect(strict.ok).toBe(false);
    expect(codes(strict.problems)).toEqual(['unsigned']);
  });

  it('drops a stale signature when rebuilding unsigned', async () => {
    const ext = await builtExtension('alpha');
    const { pem } = await keyFiles();
    const out = await tempDir();
    await buildRepo([ext], { out, name: 'R', key: pem });
    await buildRepo([ext], { out, name: 'R', unsigned: true });
    expect(await readdir(out)).not.toContain('index.json.sig');
    expect((await verifyRepo(out)).signature).toBe('unsigned');
  });

  it('fails clearly without a built bundle, a stale one, an icon or a usable key', async () => {
    const out = await tempDir();
    const options = { out, name: 'R' };
    const unbuilt = await builtExtension('alpha', { build: false });
    await expect(buildRepo([unbuilt], { ...options, unsigned: true })).rejects.toThrow(
      /no built bundle[^]*ma-ext build/,
    );

    const noIcon = await builtExtension('beta', { icon: false });
    await expect(buildRepo([noIcon], { ...options, unsigned: true })).rejects.toThrow(/no icon[^]*icon\.png/);

    const stale = await builtExtension('gamma');
    await writeFile(
      join(stale, 'manifest.json'),
      JSON.stringify({ ...JSON.parse(await readFile(join(stale, 'manifest.json'), 'utf8')), version: '1.1.0' }),
    );
    await expect(buildRepo([stale], { ...options, unsigned: true })).rejects.toThrow(/stale[^]*1\.0\.0[^]*1\.1\.0/);

    const ok = await builtExtension('delta');
    await expect(buildRepo([ok], { ...options, key: join(out, 'missing.pem') })).rejects.toThrow(/Cannot read the key/);
    await writeFile(join(out, 'bad.pem'), 'not a key');
    await expect(buildRepo([ok], { ...options, key: join(out, 'bad.pem') })).rejects.toThrow(/Ed25519/);
    await expect(buildRepo([], { ...options, unsigned: true })).rejects.toThrow(/at least one/);
    await expect(readdir(out)).resolves.toEqual(['bad.pem']);
  });

  it('rejects a duplicate id and an oversized icon', async () => {
    const out = await tempDir();
    const ext = await builtExtension('alpha');
    await expect(buildRepo([ext, ext], { out, name: 'R', unsigned: true })).rejects.toThrow(/unique/);
    await writeFile(join(ext, 'dist/icon.png'), Buffer.alloc(600 * 1024));
    await expect(buildRepo([ext], { out, name: 'R', unsigned: true })).rejects.toThrow(/icon/);
  });

  it('writes absolute references with --base-url, and verify still finds the files on disk', async () => {
    const ext = await builtExtension('alpha');
    const { pem } = await keyFiles();
    const out = await tempDir();
    await buildRepo([ext], { out, name: 'R', key: pem, baseUrl: 'https://example.invalid/repo/' });
    const index = JSON.parse(await readFile(join(out, 'index.json'), 'utf8')) as {
      extensions: { archive: string; icon: string }[];
    };
    expect(index.extensions[0]).toMatchObject({
      archive: 'https://example.invalid/repo/alpha-1.0.0.zip',
      icon: 'https://example.invalid/repo/alpha.png',
    });
    expect((await verifyRepo(out)).ok).toBe(true);
    await expect(buildRepo([ext], { out, name: 'R', key: pem, baseUrl: 'ftp://x/' })).rejects.toThrow(/http\(s\)/);
  });
});

describe('repo verify catches tampering', () => {
  async function signedRepo() {
    const ext = await builtExtension('alpha');
    const { pem, publicKey } = await keyFiles();
    const out = await tempDir();
    await buildRepo([ext], { out, name: 'R', key: pem });
    return { out, publicKey, pem };
  }

  it('a flipped byte in an archive', async () => {
    const { out } = await signedRepo();
    const path = join(out, 'alpha-1.0.0.zip');
    const bytes = await readFile(path);
    flipByte(bytes);
    await writeFile(path, bytes);
    const report = await verifyRepo(out);
    expect(report.ok).toBe(false);
    expect(report.problems).toMatchObject([{ code: 'hash_mismatch', file: 'alpha-1.0.0.zip', id: 'alpha' }]);
  });

  it('a changed icon, an archive of the wrong size, a missing archive', async () => {
    const { out } = await signedRepo();
    await writeFile(join(out, 'alpha.png'), Buffer.from('not the icon'));
    expect(await verifyRepo(out)).toMatchObject({ problems: [{ code: 'icon_mismatch', file: 'alpha.png' }] });

    await writeFile(
      join(out, 'alpha-1.0.0.zip'),
      Buffer.concat([await readFile(join(out, 'alpha-1.0.0.zip')), Buffer.from('x')]),
    );
    expect(codes((await verifyRepo(out)).problems)).toEqual(['size_mismatch']);

    await rm(join(out, 'alpha-1.0.0.zip'));
    const report = await verifyRepo(out);
    expect(report.problems.find((p) => p.code === 'missing_file')?.message).toMatch(/archive of alpha is missing/);
  });

  it('an edited index.json', async () => {
    const { out } = await signedRepo();
    const index = JSON.parse(await readFile(join(out, 'index.json'), 'utf8')) as { name: string };
    index.name = 'Evil';
    await writeFile(join(out, 'index.json'), JSON.stringify(index, null, 2));
    const report = await verifyRepo(out);
    expect(report.signature).toBe('invalid');
    expect(codes(report.problems)).toEqual(['invalid_signature']);
  });

  it('an index that is not valid, and a missing index', async () => {
    const { out } = await signedRepo();
    await writeFile(join(out, 'index.json'), '{"format":1}');
    expect(codes((await verifyRepo(out)).problems)).toContain('bad_index');
    await rm(join(out, 'index.json'));
    const report = await verifyRepo(out);
    expect(report).toMatchObject({ ok: false, name: null });
    expect(report.problems[0]).toMatchObject({ code: 'missing_file', file: 'index.json' });
    expect((await verifyRepo(join(out, 'nowhere'))).ok).toBe(false);
  });

  it('a signature file from another key', async () => {
    const { out, publicKey } = await signedRepo();
    const other = generateKeyPair();
    await writeFile(
      join(out, 'index.json.sig'),
      signIndex(await readFile(join(out, 'index.json')), other.privateKeyPem),
    );
    // The signature is valid for the other key, so without --key it passes as "someone's" key...
    const unchecked = await verifyRepo(out);
    expect(unchecked.ok).toBe(true);
    expect(unchecked.announcedKey).toBe(other.publicKey);
    // ...and with the real key it is the key that changed.
    const checked = await verifyRepo(out, { key: publicKey });
    expect(checked.signature).toBe('key-changed');
    expect(codes(checked.problems)).toEqual(['key_changed']);

    // A signature that does not belong to the index at all.
    await writeFile(join(out, 'index.json.sig'), signIndex(Buffer.from('other'), other.privateKeyPem));
    expect(codes((await verifyRepo(out)).problems)).toEqual(['invalid_signature']);
    await writeFile(join(out, 'index.json.sig'), 'garbage');
    expect(codes((await verifyRepo(out)).problems)).toEqual(['invalid_signature']);
  });

  it('the wrong --key, and a malformed one', async () => {
    const { out } = await signedRepo();
    const report = await verifyRepo(out, { key: generateKeyPair().publicKey });
    expect(report).toMatchObject({ ok: false, signature: 'key-changed', keyChecked: true });
    expect(codes(report.problems)).toEqual(['key_changed']);
    await expect(verifyRepo(out, { key: 'ed25519:nope' })).rejects.toThrow(/--key/);
  });
});

describe('repo verify over http', () => {
  async function serve(root: string, overrides: Record<string, Buffer | number> = {}): Promise<string> {
    const server = createServer((req, res) => {
      void (async () => {
        const name = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname.replace(/^\/repo\//, ''));
        const override = overrides[name];
        if (typeof override === 'number') return void res.writeHead(override).end();
        const body = override ?? (await readFile(join(root, name)).catch(() => null));
        if (!body) return void res.writeHead(404).end('nope');
        res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(body);
      })();
    });
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/repo/`;
  }

  async function builtRepo() {
    const ext = await builtExtension('alpha');
    const { pem, publicKey } = await keyFiles();
    const out = await tempDir();
    await buildRepo([ext], { out, name: 'R', key: pem });
    return { out, publicKey };
  }

  it('verifies a repository by folder URL or index.json URL', async () => {
    const { out, publicKey } = await builtRepo();
    const url = await serve(out);
    expect(await verifyRepo(url, { key: publicKey })).toMatchObject({ ok: true, signature: 'trusted' });
    expect((await verifyRepo(`${url}index.json`)).ok).toBe(true);
    expect((await verifyRepo(url.slice(0, -1))).ok).toBe(true);
  });

  it('verifies a repository with absolute references served elsewhere', async () => {
    const ext = await builtExtension('alpha');
    const { pem } = await keyFiles();
    const out = await tempDir();
    const url = await serve(out);
    await buildRepo([ext], { out, name: 'R', key: pem, baseUrl: url });
    expect((await verifyRepo(url)).ok).toBe(true);
  });

  it('reports a tampered archive, a missing icon, a server error and an oversized icon', async () => {
    const { out } = await builtRepo();
    const archive = await readFile(join(out, 'alpha-1.0.0.zip'));
    flipByte(archive);
    const tampered = await verifyRepo(await serve(out, { 'alpha-1.0.0.zip': archive }));
    expect(codes(tampered.problems)).toEqual(['hash_mismatch']);

    const noIcon = await verifyRepo(await serve(out, { 'alpha.png': 404 }));
    expect(noIcon.problems).toMatchObject([{ code: 'missing_file', file: 'alpha.png' }]);
    expect(noIcon.problems[0]?.message).toMatch(/HTTP 404/);

    const broken = await verifyRepo(await serve(out, { 'alpha-1.0.0.zip': 500 }));
    expect(broken.problems[0]?.message).toMatch(/HTTP 500/);

    const huge = await verifyRepo(await serve(out, { 'alpha.png': Buffer.alloc(2 * 1024 * 1024) }));
    expect(codes(huge.problems)).toEqual(['too_large']);
  });

  it('reports a signature that is cut off or an index edited in transit', async () => {
    const { out } = await builtRepo();
    const index = (await readFile(join(out, 'index.json'), 'utf8')).replace('"R"', '"Evil"');
    const edited = await verifyRepo(await serve(out, { 'index.json': Buffer.from(index) }));
    expect(codes(edited.problems)).toEqual(['invalid_signature']);
    const failing = await verifyRepo(await serve(out, { 'index.json.sig': 500 }));
    expect(failing.problems[0]?.message).toMatch(/index\.json\.sig.*HTTP 500/);
  });

  it('reports an unreachable server instead of throwing', async () => {
    const report = await verifyRepo('http://127.0.0.1:9/repo/');
    expect(report).toMatchObject({ ok: false, name: null });
    expect(report.problems[0]?.message).toMatch(/could not be fetched/);
  });

  it('treats a repository without a signature as unsigned', async () => {
    const ext = await builtExtension('alpha');
    const out = await tempDir();
    await buildRepo([ext], { out, name: 'R', unsigned: true });
    expect(await verifyRepo(await serve(out))).toMatchObject({ ok: true, signature: 'unsigned' });
  });
});
