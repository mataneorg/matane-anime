// Bundles the CLI (and the workspace packages it uses, which ship TypeScript sources) into dist/cli.js.
// Runs on `pnpm install` (prepare), so `ma-ext` works in a fresh clone.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/cli.ts'],
  outfile: 'dist/cli.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['commander', 'esbuild', 'quickjs-emscripten', 'cheerio', 'zod'],
  logLevel: 'warning',
});
