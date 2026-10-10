// Builds the package in two parts.
//   1. `tsc -p tsconfig.build.json` writes the library entries (`dist/index.js`, `dist/run.js` and what they reach) with
//      declarations. They import `@matane-anime/extension-runtime` and `extension-sdk` from the registry, like any consumer.
//   2. esbuild bundles the command line into dist/cli.js. The sibling runtime and sdk packages are inlined from their
//      TypeScript sources (the `matane-source` export condition), so this part needs no other package to be built
//      first, which is what lets the root `prepare` script (and `prepack`) produce `ma-ext` on a fresh clone.
//      Everything else stays a dependency.
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { build } from 'esbuild';

rmSync('dist', { recursive: true, force: true });

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const types = spawnSync(pnpm, ['exec', 'tsc', '-p', 'tsconfig.build.json'], { stdio: 'inherit' });
if (types.status !== 0) process.exit(types.status ?? 1);

await build({
  entryPoints: ['src/cli.ts'],
  outfile: 'dist/cli.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  conditions: ['matane-source'],
  external: ['commander', 'esbuild', 'quickjs-emscripten', 'cheerio', 'zod'],
  logLevel: 'warning',
});
