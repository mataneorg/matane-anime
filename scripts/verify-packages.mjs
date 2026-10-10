#!/usr/bin/env node
// Proves that @matane-anime/extension-{sdk,runtime,cli} work as published packages, without publishing anything:
//
//   1. `pnpm pack` each package (its `prepack` builds it) and check the tarball: only intended files, a manifest
//      with no `workspace:` ranges, and every export target present.
//   2. Install the three tarballs into an empty project (everything else comes from the registry or the pnpm
//      store), import every entry point and type-check against the declarations.
//   3. In that project run `ma-ext create`, `build` and `test` on a scaffolded extension (against a local server)
//      and type-check it.
//      and `ma-ext repo keygen`, `repo build` and `repo verify` on it (the bundle must carry zip and crypto code).
//   4. `npm publish --dry-run` per package when npm is installed (it lists files; it never uploads).
//
// Run with `pnpm verify:packages`. Needs network only for the registry reads of the third-party dependencies.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SCOPE = '@matane-anime';
// Build order: a package is compiled against the dist of the ones before it.
const PACKAGES = ['extension-sdk', 'extension-runtime', 'extension-cli'];
const ALLOWED_FILE = /^package\/(package\.json|README\.md|LICENSE|dist\/.+|bin\/.+)$/;
const STRAY_FILE =
  /(^|\/)(src|test|tests|__tests__)\/|\.(test|spec)\.|\.tsbuildinfo$|\.map$|(^|\/)tsconfig[^/]*\.json$/;

const failures = [];
const summary = [];
const fail = (message) => {
  failures.push(message);
  console.error(`  ✗ ${message}`);
};
const pass = (message) => console.log(`  ✓ ${message}`);
const heading = (title) => console.log(`\n${title}`);
const check = (condition, message) => (condition ? pass(message) : fail(message));

/** Runs a command and resolves with its result; never throws, so a failing step is reported, not fatal. */
function run(command, args, { cwd, env } = {}) {
  return new Promise((done) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', (error) => done({ code: 127, output: `${output}${error.message}` }));
    child.on('close', (code) => done({ code: code ?? 1, output }));
  });
}

/** Like `run`, but a non-zero exit is recorded as a failure with the tail of the output. */
async function must(label, command, args, options) {
  const result = await run(command, args, options);
  if (result.code === 0) pass(label);
  else fail(`${label} (exit ${result.code})\n${indent(result.output.trim().split('\n').slice(-25).join('\n'))}`);
  return result;
}

const indent = (text) => text.replace(/^/gm, '      ');
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const tarList = async (tarball) => (await run('tar', ['-tzf', tarball])).output.split('\n').filter(Boolean).sort();
const tarRead = async (tarball, file) => JSON.parse((await run('tar', ['-xzOf', tarball, file])).output);

/** Every file an `exports` map points at, ignoring the workspace-only `matane-source` condition. */
function exportTargets(value, found = new Set()) {
  if (typeof value === 'string') found.add(value);
  else if (value && typeof value === 'object') {
    for (const [condition, inner] of Object.entries(value))
      if (condition !== 'matane-source') exportTargets(inner, found);
  }
  return found;
}

async function packPackages(workDir) {
  heading('1. Pack the packages');
  const tarballs = {};
  const manifests = {};
  const versions = new Set();
  for (const name of PACKAGES) {
    const dir = join(ROOT, 'packages', name);
    const source = await readJson(join(dir, 'package.json'));
    versions.add(source.version);
    check(source.private !== true, `${source.name}: not private`);
    check(source.license === 'MIT', `${source.name}: MIT license`);

    const packed = await must(`${source.name}: pnpm pack`, 'pnpm', ['pack', '--pack-destination', workDir], {
      cwd: dir,
    });
    const tarball = packed.output
      .split('\n')
      .find((line) => line.trim().endsWith('.tgz'))
      ?.trim();
    if (!tarball || !existsSync(tarball)) {
      fail(`${source.name}: pnpm pack did not report a tarball`);
      continue;
    }
    tarballs[name] = tarball;

    const files = await tarList(tarball);
    const stray = files.filter((file) => !ALLOWED_FILE.test(file) || STRAY_FILE.test(file));
    check(stray.length === 0, `${source.name}: only intended files (${files.length} files)`);
    for (const file of stray) console.error(`      unexpected: ${file}`);
    console.log(indent(files.map((file) => file.replace(/^package\//, '')).join('\n')));
    summary.push({ name: source.name, files: files.length });

    const manifest = await tarRead(tarball, 'package/package.json');
    manifests[name] = manifest;
    check(
      !JSON.stringify(manifest).includes('workspace:'),
      `${source.name}: no workspace: ranges in the packed manifest`,
    );
    check(manifest.private !== true, `${source.name}: packed manifest is not private`);
    check(manifest.publishConfig?.access === 'public', `${source.name}: publishConfig.access is public`);
    check(Boolean(manifest.repository?.url && manifest.engines?.node), `${source.name}: repository and engines set`);
    const missing = [
      ...exportTargets(manifest.exports),
      manifest.main,
      manifest.types,
      ...Object.values(manifest.bin ?? {}),
    ]
      .filter(Boolean)
      .filter((target) => !files.includes(`package/${target.replace(/^\.\//, '')}`));
    check(missing.length === 0, `${source.name}: every export/main/types/bin target is in the tarball`);
    for (const target of missing) console.error(`      missing: ${target}`);
  }
  check(versions.size === 1, `the three packages share one version (${[...versions].join(', ')})`);
  const [version] = versions;
  const sdkDependency = manifests['extension-runtime']?.dependencies?.[`${SCOPE}/extension-sdk`];
  check(sdkDependency === version, `extension-runtime depends on extension-sdk ${sdkDependency ?? '(nothing)'}`);
  return { tarballs, version };
}

/** pnpm 12 reads overrides and build approvals from pnpm-workspace.yaml, not package.json. */
const pnpmSettings = (tarballs) =>
  `allowBuilds:\n  esbuild: true\noverrides:\n${PACKAGES.map((name) => `  '${SCOPE}/${name}': file:${tarballs[name]}`).join('\n')}\n`;

async function installConsumer(dir, tarballs, rootManifest) {
  heading('2. Install the tarballs into an empty project');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'consumer',
        private: true,
        type: 'module',
        dependencies: Object.fromEntries(PACKAGES.map((name) => [`${SCOPE}/${name}`, `file:${tarballs[name]}`])),
        devDependencies: {
          '@types/node': rootManifest.devDependencies['@types/node'],
          typescript: rootManifest.devDependencies.typescript,
        },
      },
      null,
      2,
    ),
  );
  await writeFile(join(dir, 'pnpm-workspace.yaml'), pnpmSettings(tarballs));
  const install = await must('pnpm install', 'pnpm', ['install', '--prefer-offline'], { cwd: dir });
  if (install.code !== 0) return false;

  const imports = [
    `${SCOPE}/extension-sdk`,
    `${SCOPE}/extension-sdk/manifest`,
    `${SCOPE}/extension-sdk/globals`,
    `${SCOPE}/extension-runtime`,
    `${SCOPE}/extension-runtime/client`,
    `${SCOPE}/extension-cli`,
    `${SCOPE}/extension-cli/run`,
  ];
  await writeFile(
    join(dir, 'imports.mjs'),
    `for (const id of ${JSON.stringify(imports)}) { await import(id); console.log('imported', id); }\n`,
  );
  const imported = await must('every entry point imports in Node (ESM)', 'node', ['imports.mjs'], { cwd: dir });
  check(
    imported.code !== 0 || imports.every((id) => imported.output.includes(`imported ${id}`)),
    'all entry points reported',
  );

  // Declarations: resolve like a consumer on NodeNext and on Bundler, with the dist `.d.ts` files only.
  await writeFile(
    join(dir, 'consumer.ts'),
    `import '${SCOPE}/extension-sdk/globals';
import { NotFoundError, defineExtension } from '${SCOPE}/extension-sdk';
import { API_VERSION, manifestSchema } from '${SCOPE}/extension-sdk/manifest';
import { ExtensionRuntime, SourceClient } from '${SCOPE}/extension-runtime';
import { SourceClient as ClientOnly } from '${SCOPE}/extension-runtime/client';
import { buildExtension } from '${SCOPE}/extension-cli';
import { loadSource } from '${SCOPE}/extension-cli/run';

export const extension = defineExtension({ createSource: () => ({ baseUrl: '', async getStreams() { throw new NotFoundError('x'); } }) as never });
export const parse = (value: unknown) => manifestSchema.parse(value);
export const version: number = API_VERSION;
export const makeClient = (runtime: ExtensionRuntime) => SourceClient.forRuntime(runtime, 'en');
export const same: typeof SourceClient = ClientOnly;
export const fetchGlobal = () => http.get('https://example.com');
export const build = (dir: string) => buildExtension(dir, { write: false });
export const load = (dir: string) => loadSource(dir, { prefs: [] });
`,
  );
  for (const resolution of ['NodeNext', 'Bundler']) {
    const module = resolution === 'NodeNext' ? 'NodeNext' : 'ESNext';
    await must(
      `declarations type-check (moduleResolution ${resolution})`,
      join(dir, 'node_modules/.bin/tsc'),
      [
        '--noEmit',
        '--strict',
        '--skipLibCheck',
        'false',
        '--target',
        'ES2022',
        '--lib',
        'ES2023',
        '--module',
        module,
        '--moduleResolution',
        resolution,
        'consumer.ts',
      ],
      { cwd: dir },
    );
  }
  return true;
}

/** A stand-in for the site the scaffold's TODOs point at: one listing with one card. */
function startSite() {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end(
      request.url?.startsWith('/popular')
        ? '<div class="card"><a href="/anime/demo"></a><span class="title">Demo Anime</span></div>'
        : '<html></html>',
    );
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

/** The scaffold needs an icon to go into a repository; then keygen → build → verify with the installed binary. */
async function repositoryRoundTrip(bin, demo) {
  await copyFile(join(ROOT, 'extensions/example/icon.png'), join(demo, 'icon.png'));
  await must('ma-ext build (with an icon)', bin, ['build'], { cwd: demo });
  await must('ma-ext repo keygen', bin, ['repo', 'keygen', '--out', 'keys'], { cwd: demo });
  const publicKey = (await readFile(join(demo, 'keys/repo-key.pub'), 'utf8')).trim();
  await must(
    'ma-ext repo build',
    bin,
    ['repo', 'build', '.', '--out', 'repo', '--name', 'Demo repository', '--key', 'keys/repo-key.pem'],
    { cwd: demo },
  );
  for (const file of ['index.json', 'index.json.sig', 'demo-0.1.0.zip', 'demo.png']) {
    check(existsSync(join(demo, 'repo', file)), `repo/${file} exists`);
  }
  const verified = await must('ma-ext repo verify --key', bin, ['repo', 'verify', 'repo', '--key', publicKey], {
    cwd: demo,
  });
  check(verified.output.includes('is consistent'), 'ma-ext repo verify reports a consistent repository');
  const tampered = join(demo, 'repo/demo.png');
  await writeFile(tampered, 'not the icon');
  const rejected = await run(bin, ['repo', 'verify', 'repo'], { cwd: demo });
  check(rejected.code === 1, 'ma-ext repo verify exits 1 for a tampered icon');
}

async function scaffoldProject(workDir, consumerDir, tarballs, version, rootManifest) {
  heading('3. Scaffold, build and test an extension from the installed packages');
  const maExt = join(consumerDir, 'node_modules/.bin/ma-ext');
  const versionOutput = await must('ma-ext --version', maExt, ['--version'], { cwd: workDir });
  check(versionOutput.output.trim() === version, `ma-ext reports ${version}`);
  await must('ma-ext create demo --name Demo --lang en', maExt, ['create', 'demo', '--name', 'Demo', '--lang', 'en'], {
    cwd: workDir,
  });
  const demo = join(workDir, 'demo');
  const manifest = await readJson(join(demo, 'package.json')).catch(() => undefined);
  check(
    manifest?.devDependencies?.[`${SCOPE}/extension-sdk`] === `^${version}`,
    `scaffold depends on the SDK ^${version}`,
  );
  check(
    manifest?.devDependencies?.[`${SCOPE}/extension-cli`] === `^${version}`,
    `scaffold depends on the CLI ^${version}`,
  );
  if (!manifest) return;

  // The scaffold's TODOs: point it at the local site. Everything else stays as generated.
  const server = await startSite();
  try {
    const entry = join(demo, 'src/index.ts');
    await writeFile(
      entry,
      (await readFile(entry, 'utf8')).replace("'https://example.com'", `'http://127.0.0.1:${server.address().port}'`),
    );
    // Not on the registry yet: resolve the packages to the tarballs, as the registry would.
    manifest.devDependencies.typescript = rootManifest.devDependencies.typescript;
    manifest.devDependencies['@types/node'] = rootManifest.devDependencies['@types/node'];
    await writeFile(join(demo, 'package.json'), JSON.stringify(manifest, null, 2));
    await writeFile(join(demo, 'pnpm-workspace.yaml'), pnpmSettings(tarballs));
    const install = await must('pnpm install in the scaffold', 'pnpm', ['install', '--prefer-offline'], { cwd: demo });
    if (install.code !== 0) return;

    const bin = join(demo, 'node_modules/.bin/ma-ext');
    await must('ma-ext build', bin, ['build'], { cwd: demo });
    for (const file of ['dist/index.js', 'dist/manifest.json']) check(existsSync(join(demo, file)), `${file} exists`);
    const tested = await must('ma-ext test', bin, ['test'], { cwd: demo });
    check(tested.output.includes('All steps passed.'), 'ma-ext test reports all steps passed');
    await repositoryRoundTrip(bin, demo);
    await must(
      'tsc --noEmit on the scaffold',
      join(demo, 'node_modules/.bin/tsc'),
      ['--noEmit', '-p', 'tsconfig.json'],
      { cwd: demo },
    );
  } finally {
    server.close();
  }
}

async function dryRunPublish() {
  heading('4. npm publish --dry-run');
  // pnpm installs Node without npm, so fall back to a pinned npm from the registry (a read, nothing is uploaded).
  const npm = (await run('npm', ['--version'])).code === 0 ? ['npm'] : ['pnpm', 'dlx', 'npm@11'];
  for (const name of PACKAGES) {
    const dir = join(ROOT, 'packages', name);
    const result = await run(npm[0], [...npm.slice(1), 'publish', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: dir,
    });
    let report;
    try {
      const parsed = JSON.parse(result.output.slice(result.output.indexOf('{'), result.output.lastIndexOf('}') + 1));
      // npm 11 keys the report by package name; older versions print it directly.
      report = parsed.files ? parsed : parsed[`${SCOPE}/${name}`];
      if (!report?.files) throw new Error('no file list');
    } catch {
      fail(`${SCOPE}/${name}: npm publish --dry-run printed no report\n${indent(result.output.slice(-1500))}`);
      continue;
    }
    const files = report.files.map((file) => `package/${file.path}`);
    const stray = files.filter((file) => !ALLOWED_FILE.test(file) || STRAY_FILE.test(file));
    check(
      result.code === 0 && stray.length === 0,
      `${SCOPE}/${name}: dry run lists only intended files (${files.length})`,
    );
    for (const file of stray) console.error(`      unexpected: ${file}`);
  }
}

async function main() {
  const rootManifest = await readJson(join(ROOT, 'package.json'));
  const workDir = await mkdtemp(join(tmpdir(), 'ma-verify-'));
  console.log(`Working in ${workDir}`);
  try {
    const { tarballs, version } = await packPackages(workDir);
    if (failures.length === 0) {
      const consumerDir = join(workDir, 'consumer');
      if (await installConsumer(consumerDir, tarballs, rootManifest)) {
        const projectsDir = join(workDir, 'projects');
        await mkdir(projectsDir);
        await scaffoldProject(projectsDir, consumerDir, tarballs, version, rootManifest);
      }
    }
    await dryRunPublish();
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }

  heading('Summary');
  for (const row of summary) console.log(`  ${row.name}: ${row.files} files in the tarball`);
  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed:`);
    for (const message of failures) console.error(`  - ${message.split('\n')[0]}`);
    process.exit(1);
  }
  console.log('\nAll package checks passed. Nothing was published.');
}

await main();
