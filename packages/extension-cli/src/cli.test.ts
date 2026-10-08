import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TestSite } from '@matane-anime/test-site';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { percentile } from './bench';
import { BuildError, buildExtension } from './build';
import { scaffold } from './create';
import { runTest } from './test-command';
import { VERSION } from './version';

const ROOT = resolve(import.meta.dirname, '../../..');
const EXAMPLE = join(ROOT, 'extensions/example');
// Inside this package so `@matane-anime/extension-sdk` resolves from node_modules above it.
const SCRATCH = join(import.meta.dirname, '../node_modules/.cache/cli-tests');

const dirs: string[] = [];
async function scratch(files: Record<string, string>): Promise<string> {
  await mkdir(SCRATCH, { recursive: true });
  const dir = await mkdtemp(join(SCRATCH, 'ext-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(dir, name, '..'), { recursive: true });
    await writeFile(join(dir, name), content);
  }
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const manifest = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    id: 'tmp',
    name: 'Tmp',
    version: '1.0.0',
    apiVersion: 1,
    type: 'anime',
    sources: [{ key: 'en', lang: 'en', name: 'Tmp' }],
    ...overrides,
  });
const entry = 'export default { createSource: () => ({}) };';

describe('build', () => {
  it('bundles the example extension and checks it loads', async () => {
    const result = await buildExtension(EXAMPLE, { write: false });
    expect(result.manifest.id).toBe('example');
    expect(result.manifest.sources.map((s) => s.key)).toEqual(['en', 'id']);
    expect(result.code).toContain('globalThis.__extension = __bundle.default');
    expect(result.code).not.toMatch(/\brequire\s*\(/);
  });

  it('explains a manifest for another app', async () => {
    const dir = await scratch({ 'manifest.json': manifest({ type: 'manga' }), 'src/index.ts': entry });
    await expect(buildExtension(dir, { write: false })).rejects.toThrow(/only runs extensions with type "anime"/);
  });

  it('refuses an apiVersion from the future, a missing entry and a bundle that needs require()', async () => {
    const future = await scratch({ 'manifest.json': manifest({ apiVersion: 99 }), 'src/index.ts': entry });
    await expect(buildExtension(future, { write: false })).rejects.toThrow(/newer than this tool/);
    const empty = await scratch({ 'manifest.json': manifest() });
    await expect(buildExtension(empty, { write: false })).rejects.toThrow(/No entry file/);
    const needsRequire = await scratch({
      'manifest.json': manifest(),
      'src/index.ts': `export default { createSource: () => ({ x: () => require('fs') }) };`,
    });
    await expect(buildExtension(needsRequire, { write: false })).rejects.toBeInstanceOf(BuildError);
  });

  it('refuses an entry that does not export an extension', async () => {
    const dir = await scratch({ 'manifest.json': manifest(), 'src/index.ts': 'export const nothing = 1;' });
    await expect(buildExtension(dir, { write: false })).rejects.toThrow(/does not load in the sandbox/);
  });

  it('scaffolds an extension that builds', async () => {
    await mkdir(SCRATCH, { recursive: true });
    const base = await mkdtemp(join(SCRATCH, 'create-'));
    dirs.push(base);
    const target = await scaffold({ id: 'my-site', dir: join(base, 'my-site'), lang: 'id' });
    const result = await buildExtension(target, { write: false });
    expect(result.manifest).toMatchObject({ id: 'my-site', type: 'anime', sources: [{ key: 'id', lang: 'id' }] });
    await expect(scaffold({ id: 'my-site', dir: target })).rejects.toThrow(/already exists/);
    await expect(scaffold({ id: 'Bad_Id', dir: join(base, 'bad') })).rejects.toThrow(/id/);
  });
});

describe('scaffold dependencies', () => {
  const devDependencies = async (target: string): Promise<Record<string, string>> =>
    (JSON.parse(await readFile(join(target, 'package.json'), 'utf8')) as { devDependencies: Record<string, string> })
      .devDependencies;

  it("links the workspace packages inside the repository and this CLI's version outside it", async () => {
    await mkdir(SCRATCH, { recursive: true });
    const inside = await mkdtemp(join(SCRATCH, 'link-'));
    const outside = await mkdtemp(join(tmpdir(), 'ma-ext-link-'));
    dirs.push(inside, outside);

    const linked = { '@matane-anime/extension-cli': 'workspace:*', '@matane-anime/extension-sdk': 'workspace:*' };
    expect(await devDependencies(await scaffold({ id: 'a', dir: join(inside, 'a') }))).toEqual(linked);

    const published = { '@matane-anime/extension-cli': `^${VERSION}`, '@matane-anime/extension-sdk': `^${VERSION}` };
    expect(await devDependencies(await scaffold({ id: 'a', dir: join(outside, 'a') }))).toEqual(published);
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('test command', () => {
  let site: TestSite;
  beforeAll(async () => {
    site = await TestSite.start({ mediaDir: join(ROOT, 'apps/desktop/e2e/fixtures/media') });
  });
  afterAll(async () => site.close());

  it('runs the whole chain against the fake site and exits 0', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const code = await runTest(EXAMPLE, { pref: [`baseUrl=${site.origin}`], query: 'sky' });
    const output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    log.mockRestore();
    expect(output).toContain('getStreams(Episode 12)');
    expect(output).toContain('Server A 720p');
    expect(code).toBe(0);
  });

  it('exits non-zero and says what failed when the site is down', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const code = await runTest(EXAMPLE, { pref: ['baseUrl=http://127.0.0.1:9'] });
    const output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    log.mockRestore();
    expect(code).toBe(1);
    expect(output).toMatch(/NetworkError/);
  });
});

describe('percentile', () => {
  it('uses the nearest rank', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
    expect(percentile([], 50)).toBe(0);
  });
});
