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
2. Set the version in `apps/desktop/package.json` (the current one is `0.1.0-beta.4`). A version with a pre-release part is published as a GitHub **pre-release**, which is the beta channel.
3. Commit, then tag **exactly** `v<version>` and push the tag:

   ```sh
   git tag v0.1.0-beta.1
   git push origin v0.1.0-beta.1
   ```

   The `prepare` job fails the run if the tag does not match `apps/desktop/package.json`, creates the release once (`--generate-notes`, `--prerelease` for a pre-release version), and then three builds run in parallel: Linux (AppImage, deb, rpm), Windows (NSIS and portable) and macOS (dmg for arm64 and x64, from one runner). Each uploads to the release through `electron-builder --publish always` and keeps its installers as workflow artifacts for 14 days. The Linux job then smoke-tests the AppImage (`xvfb-run -a pnpm smoke:packaged`, after the upload: a red job there means pull the release, not that nothing was published).
4. A manual run of the workflow ("Run workflow", `workflow_dispatch`) only builds and keeps artifacts, unless you tick _publish_ (the release is then named after the version in `package.json`).

The release is created as a normal (not draft) release, because the updater only sees published ones: **tagging publishes**. The macOS build is unsigned, so it cannot auto-update; it only tells the user a new version exists (PRD R13). AppImage and NSIS download in the background and install on quit.

### Not verified yet (read this before you tag)

State on 2026-10-11. `release.yml` has run for real: `v0.1.0-beta.4` was published (as a pre-release) with the AppImage, deb, rpm, NSIS installer, portable exe, both dmg builds and `latest.yml`, `latest-linux.yml` and `latest-mac.yml`, and CI (including e2e under xvfb) is green on `main`. What no machine has exercised yet:

- **Installing and running** the Windows (NSIS, portable), macOS (dmg; the unsigned arm64 build may need ad-hoc signing) and Linux deb and rpm builds on clean machines. Only the AppImage has been installed and smoke-tested. Check that `latest.yml` points at the NSIS installer and `latest-linux.yml` at the AppImage.
- **Auto-update end to end**, from one published beta to the next, on AppImage and NSIS. The `PORTABLE_EXECUTABLE_FILE` variable name used to detect the portable build comes from electron-builder's documentation.
- **DoH, proxy, `safeStorage`, backup restore and relaunch** on a real Electron (the home test list at the end of `docs/plans/fase-5-polish-rilis-v1.md`).
- The **three-OS playback spike** is green: run 38082320857 of `spike.yml` (2026-10-11, commit `d766451`) passed on Linux, Windows and macOS. A first run failed on Linux (the `__spike` bridge never appeared within 30 s) and on Windows (the `e2e` script redirected to `/dev/null`, fixed in `d766451`); the Linux failure did not repeat and its cause is unknown. The per-OS numbers for [ADR 0008](adr/0008-media-transport.md) and [0009](adr/0009-codec-support.md) are in the `spike-results-*` artifacts and are not copied into the ADRs yet.
- The Flatpak manifest and the AUR `PKGBUILD` in [docs/packaging](packaging/README.md) are unverified drafts that need a Flathub/AUR submission by you. How each package updates is in that README.
- Windows and macOS builds are unsigned (PRD R13); expect SmartScreen/Gatekeeper warnings.

### Cutting v1.0

Do this only when the list above is green or each open item is written down as an accepted risk.

1. ~~Run **Playback spike**~~ Done, green on all three OSes (see above).
2. ~~Install the latest beta on Windows and macOS, play a video, then update to a newer beta once.~~ Skipped for v1.0 by the maintainer (2026-10-11): accepted risk, to be done on the first v1.0.x.
3. ~~Set `version` in `apps/desktop/package.json` to `1.0.0`~~ Done as `1.0.0-rc.1` first (a pre-release, published as `v1.0.0-rc.1` on 2026-10-11), then `1.0.0-rc.2` (`v1.0.0-rc.2`, the same day) and `1.0.0-rc.3` (`v1.0.0-rc.3`, the same day); set `1.0.0`, and rename the changelog entry, when the candidate holds up. Done, with a `1.0.0` entry in `apps/desktop/src/main/app/changelog.ts` (no pre-release part, so CI publishes a normal release and the stable channel sees it).
4. ~~Drop the beta wording that would be wrong afterwards~~ Done: the notice in `README.md` ("is a **beta**", the latest version), `SECURITY.md` (Supported versions), `apps/docs/index.md` and `apps/docs/guide/getting-started.md` ("Releases are beta"), and the "beta" lines in `docs/PRD.md` §13 and §15.2.
5. ~~Decide the contact address.~~ Done: GitHub private advisories are the one official channel, and `SECURITY.md` and `CODE_OF_CONDUCT.md` say so.
6. `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build`, and `pnpm e2e` at home.
7. Commit, tag exactly `v1.0.0`, push the tag, and watch `release.yml` and the smoke job. Tagging publishes.

## The docs site

The user and author documentation is a VitePress site in `apps/docs` (workspace package `@matane-anime/docs`). It is not part of `pnpm build`, CI or the release workflow. `.github/workflows/docs.yml` builds it on every change to `apps/docs`, and publishes it to GitHub Pages (`https://mataneorg.github.io/matane-anime/`, hence `base` in `apps/docs/.vitepress/config.mts`) when the change is on `main`; it can also be started by hand from the Actions tab ("Run workflow"). It needs Settings, Pages, Source set to "GitHub Actions". Build it by hand with `pnpm --filter @matane-anime/docs docs:build` (output in `apps/docs/.vitepress/dist`), or run `docs:dev` while writing. Before a release, re-read the pages for features that changed. The two author guides there are copies of `docs/extensions.md` and `docs/repositories.md`; keep them in step.
