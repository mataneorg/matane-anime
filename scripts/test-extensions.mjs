#!/usr/bin/env node
// Runs the tests and the type check of the extensions in `extensions/`.
//
// They are not in the pnpm workspace (docs/adr/0013, 0037), so `pnpm test` and `pnpm typecheck` never reach them.
// Each one only needs the three @matane-anime packages in its node_modules, which is a link to this checkout, so
// that is what this script sets up before it runs vitest and tsc from the root install. Live tests (`LIVE=1`)
// are skipped: CI must not call the real sites.
//
// Run with `pnpm test:extensions [name…]`. The exit code is non-zero when any extension fails.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, symlink } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const EXTENSIONS = join(ROOT, 'extensions');
const PACKAGES = ['extension-cli', 'extension-runtime', 'extension-sdk'];
const VITEST = join(ROOT, 'node_modules/vitest/vitest.mjs');
const TSC = join(ROOT, 'node_modules/typescript/bin/tsc');
// Several of the tests measure wall-clock time (a dead server must not be waited for; synchronous code is cut at
// 2 s), so a machine with every core busy fails them for no reason: keep the parallelism low.
const PARALLEL = Number(process.env.EXT_PARALLEL ?? 2);

/** Left out, with the reason. `example` is a workspace package: `pnpm test` already covers it. */
const EXCLUDED = {
  example: 'part of the pnpm workspace; `pnpm test` runs it',
  otakudesu: 'its tests need saved pages of the real site, which are not in the repository',
};

function run(args, cwd) {
  const env = { ...process.env, CI: 'true' };
  delete env.LIVE;
  return new Promise((done) => {
    const child = spawn(process.execPath, args, { cwd, env });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', (error) => done({ ok: false, output: output + String(error) }));
    child.on('close', (code) => done({ ok: code === 0, output }));
  });
}

/** `node_modules/@matane-anime/<package>` -> this checkout's package, the way a local install links it. */
async function linkPackages(dir) {
  for (const name of PACKAGES) {
    const link = join(dir, 'node_modules/@matane-anime', name);
    if (existsSync(link)) continue;
    await mkdir(dirname(link), { recursive: true });
    await symlink(relative(dirname(link), join(ROOT, 'packages', name)), link, 'dir');
  }
}

async function check(name) {
  const dir = join(EXTENSIONS, name);
  await linkPackages(dir);
  const steps = [
    ['tests', [VITEST, 'run']],
    ['types', [TSC, '-p', 'tsconfig.json', '--noEmit']],
  ];
  for (const [step, args] of steps) {
    const result = await run(args, dir);
    if (!result.ok) return { name, ok: false, step, output: result.output };
  }
  return { name, ok: true };
}

async function main() {
  for (const file of [VITEST, TSC]) {
    if (!existsSync(file)) {
      console.error(`${relative(ROOT, file)} is missing: run \`pnpm install\` first.`);
      process.exit(2);
    }
  }
  const wanted = process.argv.slice(2);
  const all = (await readdir(EXTENSIONS, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && existsSync(join(EXTENSIONS, entry.name, 'package.json')))
    .map((entry) => entry.name)
    .sort();
  const unknown = wanted.filter((name) => !all.includes(name));
  if (unknown.length > 0) {
    console.error(`No such extension: ${unknown.join(', ')}`);
    process.exit(2);
  }
  const names = (wanted.length > 0 ? wanted : all).filter((name) => {
    if (!(name in EXCLUDED)) return true;
    console.log(`- ${name}: skipped, ${EXCLUDED[name]}`);
    return false;
  });

  const results = [];
  const queue = [...names];
  const worker = async () => {
    for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
      const result = await check(name);
      results.push(result);
      console.log(result.ok ? `✓ ${name}` : `✗ ${name} (${result.step} failed)`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, names.length) }, worker));

  // What failed while others were running gets one more try on its own; only a failure alone counts.
  const crowded = results.filter((result) => !result.ok);
  const flaky = [];
  for (const result of crowded) {
    const again = await check(result.name);
    if (again.ok) {
      flaky.push(result.name);
      results[results.indexOf(result)] = again;
      console.log(`~ ${result.name} passed on its own (it failed while other extensions were running)`);
    } else {
      results[results.indexOf(result)] = again;
    }
  }
  if (flaky.length > 0)
    console.warn(`\nTimings are sensitive to load; passed only on a second try: ${flaky.join(', ')}`);

  const failed = results.filter((result) => !result.ok).sort((a, b) => a.name.localeCompare(b.name));
  for (const result of failed)
    console.error(`\n===== ${result.name}: ${result.step} =====\n${result.output.trimEnd()}`);
  console.log(`\n${results.length - failed.length} of ${results.length} extensions pass.`);
  process.exit(failed.length > 0 ? 1 : 0);
}

await main();
