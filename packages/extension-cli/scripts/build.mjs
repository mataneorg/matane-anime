// Bundles the CLI into dist/cli.js. The sibling extension-runtime and extension-sdk packages are inlined from their
// TypeScript sources (the `matane-source` export condition), so this needs no other package to be built first, which
// is what lets the root `prepare` script (and `prepack`) run it on a fresh clone. Everything else stays a dependency.
import { rmSync } from 'node:fs';
import { build } from 'esbuild';

rmSync('dist', { recursive: true, force: true });

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
