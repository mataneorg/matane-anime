# 27. Publishable SDK, runtime and CLI, and `ma-ext repo`

Status: Accepted (2026-10-09)

## Context
Extension authors need the SDK and the CLI from npm (docs/PRD.md §4, EXT-18). Until now the packages were private, exported TypeScript sources and the CLI built itself on every install. The app, its tests and the e2e specs rely on those sources.

## Decision
- **`@matane-anime/extension-{sdk,runtime,cli}` build to `dist`** (JavaScript and declarations; NodeNext, so relative imports end in `.js`), are version 0.1.0, MIT, not private, and have `files`, `engines`, `repository`, `keywords` and `publishConfig.access: public`. The runtime depends on the SDK at the packed version; the CLI publishes only its bin, **inlines** the SDK, the runtime and `@matane-anime/extension-repo` (and `fflate`) in its esbuild bundle and keeps `commander`, `esbuild`, `quickjs-emscripten`, `cheerio` and `zod` as dependencies. Libraries use `^` ranges (exact pins in a library cause duplicate installs); the lockfile still pins the repository's versions. `@matane-anime/extension-repo` stays internal and unpublished.
- **Inside the workspace everything still resolves to `src`** through a custom export condition, `matane-source`, set in `tsconfig.base.json`, the vitest configs, electron-vite and the CLI's esbuild script, so the app and tests need no build of each package. A package's own build clears the condition and compiles against its siblings' `dist`. Extension builds use the SDK's `dist`, as a real user would.
- **No build on install.** The CLI's `prepare` is gone; `prepack` builds each package for `pack` and `publish`. The repository's root `prepare` builds the SDK and CLI `dist` that development needs (the example extension and the e2e specs); a plain, up-to-date `pnpm install` skips lifecycle scripts, so run `pnpm build` after editing the SDK sources.
- **The scaffold takes the CLI's own version** for its dependencies outside a workspace.
- **`scripts/verify-packages.mjs`** (`pnpm verify:packages`) packs the three packages, checks that no packed manifest contains `workspace:`, is private or points at a missing file, installs the tarballs into a clean project, imports every entry in Node ESM, scaffolds, builds and tests an extension, runs `ma-ext repo keygen`, `build` and `verify` from the tarball, and runs `npm publish --dry-run` for each package, failing on stray files. **Nothing is published**, and nothing checks the name `@matane-anime` on npm: the maintainer does that first ([PRD §15.2](../PRD.md)).
- **`ma-ext repo keygen | build | verify`** (EXT-18) wrap `packages/extension-repo`. `keygen` writes a PKCS8 private key with mode 0600, never overwrites, and prints the public key; `build` needs built extensions (it never builds implicitly), requires an icon, signs by default (`--unsigned` is explicit and warns), raises `serial` from the previous index, lists exactly the extensions given, and writes every file atomically; `verify` takes a directory or a URL and, with `--key`, checks who signed it; its exit code is 1 when anything is wrong.

## Consequences
- The test site can build and serve any repository (`buildTestRepo`, with switches for each failure a client must catch), so the e2e never touches a real site.
- A consumer installing with npm or yarn, and Node 22, are not verified.
