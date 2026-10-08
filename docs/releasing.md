# Releasing (for the maintainer)

Two things get released from this repository, and nothing here is automated end to end:

1. **The npm packages** `@matane-anime/extension-sdk`, `@matane-anime/extension-runtime` and `@matane-anime/extension-cli` (MIT). They are _prepared_ but **not published**; publishing is a manual step for the owner. [Publishing the packages (manual)](#publishing-the-packages-manual).
2. **The app** (GPL-3.0), built by `.github/workflows/release.yml` into GitHub Releases. [Cutting an app beta](#cutting-an-app-beta).

`packages/extension-repo` (the repository format library) is `private`: it is bundled into the CLI and the app and is never published on its own (docs/plans/fase-4, decision 13).

## Publishing the packages (manual)

Nobody has published these yet, and **nobody has checked whether the name `@matane-anime` is available** on npm (PRD §15.2). That check is yours to do; nothing in this repository does it for you. Until then the docs say, truthfully, that the packages are not published.

### Before the first publish

1. **Check the scope and names on npmjs.com** (website or `npm view`, as you prefer). You need `@matane-anime` to be a scope or organisation you control, and `extension-sdk`, `extension-runtime` and `extension-cli` to be free under it. If the scope is taken, pick another name and change it everywhere in one go: the three `package.json` files (`name`, and the SDK/runtime dependency ranges), the imports (`@matane-anime/extension-sdk/…` in the app, the CLI, the test site, `extensions/example`, the scaffold template in `packages/extension-cli/src/create.ts`), `scripts/verify-packages.mjs` (`SCOPE`), the READMEs and the docs. Then run the whole suite.
2. **Create the npm organisation/user and log in** (`npm login`; turn on two-factor authentication for publishing).
3. **Make the repository metadata real.** Each package's `homepage`, `bugs` and `repository` point to `https://github.com/SukunDev/matane-anime`, which is a placeholder until that repository exists. Fix them to the real address (they show on the npm page), and keep them consistent with `publish` in `apps/desktop/electron-builder.yml`.
4. **Pick the version.** The three packages are versioned together (`0.1.0` today) and `verify:packages` fails if they differ; the CLI's `--version` and the dependency range in newly scaffolded projects (`^<version>`) come from the CLI's own version. Bump all three `package.json` files (and keep `extension-runtime`'s dependency on the SDK in step, `verify:packages` checks it), commit.
5. **Run the checks.**

   ```sh
   pnpm install
   pnpm lint && pnpm typecheck && pnpm test
   pnpm verify:packages
   ```

   `verify:packages` (`scripts/verify-packages.mjs`) packs each package with `pnpm pack` (its `prepack` builds it), checks that the tarball holds only intended files (`dist/`, `bin/`, `README.md`, `LICENSE`, `package.json`), that the packed manifests are not private and have no `workspace:` ranges, and that every export target exists; installs the three tarballs into an empty project; imports every entry point and type-checks against the declarations (NodeNext and Bundler resolution); runs `ma-ext create`, `build`, `test` (against a local stand-in server) and `repo keygen`/`build`/`verify` from the installed packages; and finally runs `npm publish --dry-run` per package, which lists files and uploads nothing. It publishes nothing, but it **does need network access to the registry** to install the third-party dependencies (and, when `npm` is not installed, to fetch npm for the dry run). It prints `All package checks passed. Nothing was published.` when it is green.

6. **Look at what will be uploaded** once more: `pnpm pack --pack-destination /tmp/out` in each package folder and `tar -tzf` the result, or read the dry-run list.

### Publish

Publish in dependency order, because the runtime depends on the SDK at the exact same version: **sdk → runtime → cli**. Each `prepack` rebuilds the package, and `publishConfig.access` is already `public`, so the scope is published publicly.

```sh
pnpm --filter @matane-anime/extension-sdk     publish --access public
pnpm --filter @matane-anime/extension-runtime publish --access public
pnpm --filter @matane-anime/extension-cli     publish --access public
```

(`pnpm publish` insists on a clean working tree on the main branch and tells you what to fix; add `--otp <code>` if npm asks for a one-time password, and `--dry-run` first if you want a rehearsal.) `pnpm` replaces any `workspace:` ranges with the real version when it packs.

### After publishing

1. **Tag it**: `git tag extension-packages-v0.1.0 && git push origin extension-packages-v0.1.0`. (The `v*` tags belong to the app; `release.yml` runs on them, so use a different prefix for the packages.)
2. **Smoke test as a stranger would**, in an empty directory: `npx @matane-anime/extension-cli create demo --lang en`, `cd demo && npm install && npm run build`.
3. **Update the docs that say "not published yet"**: the quick start in `docs/extensions.md`, the install notes in the READMEs of the SDK, the runtime and the CLI, and the sentence in the root README. Search for "not published" and "not yet published".
4. Record it in the PRD (§15.2) and in the plan's exit gate, which lists the publication as "Belum" (not done yet).

## Cutting an app beta

The decision record is [ADR 0020](adr/0020-beta-packaging.md). The pieces: `apps/desktop/electron-builder.yml` (targets: AppImage x64, NSIS x64, dmg arm64+x64; artifact names `matane-anime-<version>-<os>-<arch>.<ext>`), `.github/workflows/release.yml`, and `AppUpdater` (`apps/desktop/src/main/app/updater.ts`), which looks for updates in GitHub Releases from a packaged build, on the stable or the beta channel.

### Build one locally (Linux)

```sh
pnpm dist              # electron-vite build + an AppImage into apps/desktop/release
pnpm smoke:packaged    # starts the packaged app with MATANE_SMOKE=1: opens the DB, runs migrations,
                       # loads a trivial extension in the host's QuickJS, checks the renderer, prints one JSON line
pnpm --filter @matane-anime/desktop pack:dir   # an unpacked folder instead of an AppImage
```

### Publish a beta through CI

1. Make sure `main` is green (`pnpm lint`, `format:check`, `typecheck`, `test`, `build`, `e2e`; CI runs them).
2. Set the version in `apps/desktop/package.json` (the current one is `0.1.0-beta.1`). A version with a pre-release part is published as a GitHub **pre-release**, which is the beta channel.
3. Commit, then tag **exactly** `v<version>` and push the tag:

   ```sh
   git tag v0.1.0-beta.1
   git push origin v0.1.0-beta.1
   ```

   The `prepare` job fails the run if the tag does not match `apps/desktop/package.json`, creates the release once (`--generate-notes`, `--prerelease` for a pre-release version), and then three builds run in parallel: Linux (AppImage), Windows (NSIS) and macOS (dmg for arm64 and x64, from one runner). Each uploads to the release through `electron-builder --publish always` and keeps its installers as workflow artifacts for 14 days. The Linux job then smoke-tests the AppImage (`xvfb-run -a pnpm smoke:packaged`, after the upload: a red job there means pull the release, not that nothing was published).
4. A manual run of the workflow ("Run workflow", `workflow_dispatch`) only builds and keeps artifacts, unless you tick _publish_ (the release is then named after the version in `package.json`).

The release is created as a normal (not draft) release, because the updater only sees published ones: **tagging publishes**. The macOS build is unsigned, so it cannot auto-update; it only tells the user a new version exists (PRD R13). AppImage and NSIS download in the background and install on quit.

### Not verified yet (read this before you tag)

From ADR 0020 and the files themselves; none of this has been exercised:

- **`release.yml` itself.** It was written before the GitHub repository existed and has never run. Only the Linux AppImage was built and smoke-tested, locally.
- **Placeholders.** `publish.owner`/`repo` in `electron-builder.yml` and `RELEASES_URL` in `apps/desktop/src/main/app/updater.ts` say `SukunDev/matane-anime`, marked TODO. They must match the real repository, and each other.
- **NSIS (Windows) and dmg (macOS) builds**, an unsigned arm64 macOS build (it may need ad-hoc signing), and **auto-update end to end** (from one published beta to the next).
- The **three-OS playback spike** (`spike.yml`, [ADR 0008](adr/0008-media-transport.md), [0009](adr/0009-codec-support.md)) must be green before a public beta.
- Windows and macOS builds are unsigned (PRD R13); expect SmartScreen/Gatekeeper warnings.

A sensible first run once the repository exists: a `workflow_dispatch` build without _publish_, download the three artifacts and try them, then tag.
