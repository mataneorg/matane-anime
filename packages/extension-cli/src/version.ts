import pkg from '../package.json' with { type: 'json' };

/** The CLI's own version: shown by `--version` and used for the dependency ranges in scaffolded projects. */
export const VERSION: string = pkg.version;
