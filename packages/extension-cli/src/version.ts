import { readFileSync } from 'node:fs';

// Read at run time, not imported: `package.json` sits outside `src`, so a JSON import would break the `dist` emit.
// From `src/`, from the bundle (`dist/cli.js`) and from `dist/version.js` the package folder is one level up.
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

/** The CLI's own version: shown by `--version` and used for the dependency ranges in scaffolded projects. */
export const VERSION: string = pkg.version;
