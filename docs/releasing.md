# Releasing (for the maintainer)

Two things get released from this repository, and nothing here is automated end to end:

1. **The npm packages** `@matane-anime/extension-sdk`, `@matane-anime/extension-runtime` and `@matane-anime/extension-cli` (MIT). They are published to npm by `.github/workflows/publish-sdk.yml` (tag `sdk-v<version>`); `0.1.0` was the first release. [Publishing the packages (manual)](#publishing-the-packages-manual).
2. **The app** (GPL-3.0), built by `.github/workflows/release.yml` into GitHub Releases. [Cutting an app beta](#cutting-an-app-beta).

`packages/extension-repo` (the repository format library) is `private`: it is bundled into the CLI and the app and is never published on its own (docs/plans/fase-4, decision 13).

## Publishing the packages (manual)

`0.1.0` is out, so the scope and the names are taken (by you). The checklist below is what to do for the next version, or if the scope ever has to change.

### Before the first publish

1. **Check the scope and names on npmjs.com** (website or `npm view`, as you prefer). You need `@matane-anime` to be a scope or organisation you control, and `extension-sdk`, `extension-runtime` and `extension-cli` to be free under it. If the scope is taken, pick another name and change it everywhere in one go: the three `package.json` files (`name`, and the SDK/runtime dependency ranges), the imports (`@matane-anime/extension-sdk/…` in the app, the CLI, the test site, `extensions/example`, the scaffold template in `packages/extension-cli/src/create.ts`), `scripts/verify-packages.mjs` (`SCOPE`), the READMEs and the docs. Then run the whole suite.
2. **Create the npm organisation/user and log in** (`npm login`; turn on two-factor authentication for publishing).
3. **Check the repository metadata.** Each package's `homepage`, `bugs` and `repository` point to `https://github.com/mataneorg/matane-anime`. They show on the npm page, so keep them consistent with `publish` in `apps/desktop/electron-builder.yml`.
4. **Pick the version.** The three packages are versioned together (`0.1.0` today) and `verify:packages` fails if they differ; the CLI's `--version` and the dependency range in newly scaffolded projects (`^<version>`) come from the CLI's own version. Bump all three `package.json` files (and keep `extension-runtime`'s dependency on the SDK in step, `verify:packages` checks it), commit.
5. **Run the checks.**

   ```sh
   pnpm install
   pnpm lint && pnpm typecheck && pnpm test
   pnpm verify:packages
   ```

   `verify:packages` (`scripts/verify-packages.mjs`) packs each package with `pnpm pack` (its `prepack` builds it), checks that the tarball holds only intended files (`dist/`, `bin/`, `README.md`, `LICENSE`, `package.json`), that the packed manifests are not private and have no `workspace:` ranges, and that every export target exists; installs the three tarballs into an empty project; imports every entry point and type-checks against the declarations (NodeNext and Bundler resolution); runs `ma-ext create`, `build`, `test` (against a local stand-in server) and `repo keygen`/`build`/`verify` from the installed packages; and finally runs `npm publish --dry-run` per package, which lists files and uploads nothing. It publishes nothing, but it **does need network access to the registry** to install the third-party dependencies (and, when `npm` is not installed, to fetch npm for the dry run). It prints `All package checks passed. Nothing was published.` when it is green.

6. **Look at what will be uploaded** once more: `pnpm pack --pack-destination /tmp/out` in each package folder and `tar -tzf` the result, or read the dry-run list.

### Publish through CI

`.github/workflows/publish-sdk.yml` publishes the three packages when you push a tag `sdk-v<version>` (for example `sdk-v0.1.0`; the `v*` tags belong to the app). It checks that the tag and the three `package.json` versions agree, runs typecheck, test and `verify:packages`, then publishes with npm provenance. It needs the `NPM_TOKEN` secret and waits in the `npm-publish` environment, so add a required reviewer there. A manual run from `main` can publish only the SDK. Provenance needs a public repository. The manual commands below do the same by hand.

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

The decision record is [ADR 0020](adr/0020-beta-packaging.md). The pieces: `apps/desktop/electron-builder.yml` (targets: AppImage, deb and rpm on Linux x64; NSIS and portable on Windows x64; dmg arm64+x64; artifact names `matane-anime-<version>-<os>-<arch>.<ext>`, the portable one ends in `-portable.exe`), `.github/workflows/release.yml`, and `AppUpdater` (`apps/desktop/src/main/app/updater.ts`), which looks for updates in GitHub Releases from a packaged build, on the stable or the beta channel.

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

   The `prepare` job fails the run if the tag does not match `apps/desktop/package.json`, creates the release once (`--generate-notes`, `--prerelease` for a pre-release version), and then three builds run in parallel: Linux (AppImage, deb, rpm), Windows (NSIS and portable) and macOS (dmg for arm64 and x64, from one runner). Each uploads to the release through `electron-builder --publish always` and keeps its installers as workflow artifacts for 14 days. The Linux job then smoke-tests the AppImage (`xvfb-run -a pnpm smoke:packaged`, after the upload: a red job there means pull the release, not that nothing was published).
4. A manual run of the workflow ("Run workflow", `workflow_dispatch`) only builds and keeps artifacts, unless you tick _publish_ (the release is then named after the version in `package.json`).

The release is created as a normal (not draft) release, because the updater only sees published ones: **tagging publishes**. The macOS build is unsigned, so it cannot auto-update; it only tells the user a new version exists (PRD R13). AppImage and NSIS download in the background and install on quit.

### Not verified yet (read this before you tag)

From ADR 0020 and the files themselves; none of this has been exercised:

- **`release.yml` itself.** It was written before the GitHub repository existed and has never run. Only the Linux AppImage was built and smoke-tested, locally.
- **Repository address.** `publish.owner`/`repo` in `electron-builder.yml` and `RELEASES_URL` in `apps/desktop/src/main/app/updater.ts` say `mataneorg/matane-anime`. They must match the real repository, and each other; the first real release is the proof.
- **The extra packages** (Windows portable, Linux deb and rpm; Fase 5, milestone 5f): never built. After the first CI run check that `latest.yml` points at the NSIS installer and `latest-linux.yml` at the AppImage, and install the deb and rpm on clean machines. The Flatpak manifest and the AUR `PKGBUILD` in [docs/packaging](packaging/README.md) are unverified drafts that need a Flathub/AUR submission by you. How each package updates is in that README.
- **NSIS (Windows) and dmg (macOS) builds**, an unsigned arm64 macOS build (it may need ad-hoc signing), and **auto-update end to end** (from one published beta to the next).
- The **three-OS playback spike** (`spike.yml`, [ADR 0008](adr/0008-media-transport.md), [0009](adr/0009-codec-support.md)) must be green before a public beta.
- Windows and macOS builds are unsigned (PRD R13); expect SmartScreen/Gatekeeper warnings.

A sensible first run once the repository exists: a `workflow_dispatch` build without _publish_, download the three artifacts and try them, then tag.

## The docs site

The user and author documentation is a VitePress site in `apps/docs` (workspace package `@matane-anime/docs`). It is not part of `pnpm build`, CI or the release workflow. `.github/workflows/docs.yml` builds it on every change to `apps/docs`, and publishes it to GitHub Pages (`https://mataneorg.github.io/matane-anime/`, hence `base` in `apps/docs/.vitepress/config.mts`) when the change is on `main`; it can also be started by hand from the Actions tab ("Run workflow"). It needs Settings, Pages, Source set to "GitHub Actions". Build it by hand with `pnpm --filter @matane-anime/docs docs:build` (output in `apps/docs/.vitepress/dist`), or run `docs:dev` while writing. Before a release, re-read the pages for features that changed. The two author guides there are copies of `docs/extensions.md` and `docs/repositories.md`; keep them in step.
