# 20. Beta packaging with electron-builder, and an update check against GitHub Releases

Status: Accepted (2026-10-09)

## Context
Phase 3 ends with a beta (docs/PRD.md §12, G6): an AppImage, an NSIS installer and dmg images, with auto-update through GitHub Releases on a stable and a beta channel. The app has native modules (`better-sqlite3`), a second entry that must ship (`extension-host.js`, forked as a utility process), SQL migrations read from disk, and a pnpm workspace with symlinked `node_modules`.

## Decision
- **Pins** (added to [0007](0007-toolchain-pins.md)): `electron-builder` 26.15.3 (dev dependency) and `electron-updater` 6.8.9 (runtime dependency).
- **`apps/desktop/electron-builder.yml`**: `appId` `dev.sukun.matane-anime`, `productName` "Matane Anime", targets AppImage, NSIS and dmg (arm64 and x64). The artifact name has no spaces (`matane-anime-<version>-<os>-<arch>`) because GitHub renames assets with spaces, and `extraMetadata.name` keeps the updater cache folder tidy. The user data folder stays "Matane Anime".
- **What is packed** is an explicit `files` list: `out/` (including `main/extension-host.js`), `drizzle/` (migrations are read from `app.getAppPath()/drizzle`), `resources/` and `package.json`. Nothing under `extensions/` or `e2e/` ships: the app repository does not ship or reference any extension ([0013](0013-extensions-from-folders.md)). The workspace packages are already bundled by electron-vite, so they and the WASM of the unused QuickJS variants are left out.
- **Native module**: `better-sqlite3` 13 ships N-API prebuilds for every platform, so `npmRebuild` is off, the binary is unpacked from the asar (`asarUnpack`), CI needs no compiler and one macOS runner can build both architectures. The repository's `postinstall` (`electron-rebuild`) is kept for development. QuickJS loads its WASM from inside the asar, in the utility process, without unpacking.
- **pnpm**: no hoisting was needed. electron-builder resolves the symlinked tree, and the explicit `files` list does the rest.
- **`AppUpdater`** (`main/app/updater.ts`, dependencies injected, unit tested): inactive unless `app.isPackaged`; checks 15 s after start and every 6 h; the channel comes from the `updateChannel` setting (beta sets `allowPrerelease` and the `beta` channel, stable the `latest` one; never a downgrade). AppImage and NSIS download and install on quit. **macOS is not signed, so it cannot auto-update: it only reports the new version and the release URL** (R13), and so does a Linux build outside an AppImage. Errors become a status, never an exception, and only the first line of an error is logged, because electron-updater errors embed whole HTTP responses with cookies. The only outbound traffic besides the sources is this check ([PRD §10.3](../PRD.md)).
- **`.github/workflows/release.yml`** builds the three platforms on a `v*` tag (a `-beta` tag publishes a pre-release; the tag must match the package version). The app version is `0.1.0-beta.1`.
- **Smoke test of the packaged app** (`scripts/smoke-packaged.mjs`): with `MATANE_SMOKE=1` (read only by `isSmokeRun()`, inert otherwise) the app opens its database and applies the migrations, loads a trivial extension into the host's QuickJS, checks that the renderer mounted, prints one JSON line and quits. It caught a packaging mistake (a QuickJS variant module excluded by accident) the first time it ran.

## Not verified yet
NSIS and dmg builds, an unsigned arm64 macOS build (it may need ad-hoc signing), auto-update end to end, and `release.yml` itself: there is no GitHub repository yet, so the publish owner and repository are placeholders marked TODO (and `RELEASES_URL` in `updater.ts` must match them). The three-OS playback spike ([0008](0008-media-transport.md), [0009](0009-codec-support.md)) must also be green before a public beta.

## Consequences
- A packaged app can be built and checked on Linux with `pnpm --filter ./apps/desktop dist` and `smoke:packaged`.
- `pnpm pack` is pnpm's own command, so the unpacked build script is `pack:dir`.
