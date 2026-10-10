# 24. Extension repositories: a signed index, a key the user trusts

Status: Accepted (2026-10-09)

## Context
Phase 4 lets users add extension repositories and install from them (docs/PRD.md EXT-5…EXT-9). The app ships no repository, extension or key and never suggests one (EXT-7), and an extension is untrusted code ([PRD §10.2](../PRD.md)). The PRD fixes the pieces (`index.json`, `index.json.sig`, ed25519, a zip per extension, limits) but not their formats.

## Decision
The format lives in `packages/extension-repo` (MIT, pure, no Electron): the CLI writes repositories with it, the app checks them with it and the test site serves them with it.

- **A repository is static files**: `index.json`, `index.json.sig`, `<id>-<version>.zip` and `<id>.png`. `index.json` has `format: 1`, a name, a `serial`, `generatedAt` and one entry per extension (id, name, version, `apiVersion`, optional `minAppVersion`, `nsfw`, languages, sources, `archive`, `sha256`, `size`, `icon`, `iconSha256`, `iconSize`). Archive and icon references are relative to the index URL or absolute http(s) URLs. Limits: index 2 MB, archive 20 MB, icon 512 KB, bundle 2 MB.
- **Keys are `ed25519:<64 hex>`** (the raw 32 bytes); the display form is `ed25519:7f3a…c91e`. The signature file is JSON, `{ alg, key, sig }`, and the signature covers the **exact bytes** of `index.json`: there is no canonical form to get wrong. The app stores those bytes (a leading BOM included) and the signature text, and recomputes the trust it shows from them.
- **Trust is the user's choice, not the index's** (EXT-6). `classifyRepo` gives `unsigned` (no signature file), `invalid` (it does not verify; refused everywhere), `unverified` (valid, but the key is not trusted), `trusted` (valid and equal to the key the user chose) or `key-changed`. The key a repository announces (`signing_key`) never grants trust; only `public_key` does, set by "Trust this key". An unverified repository can be added after a warning, and installing from it warns every time.
- **A trusted repository is held to its key**: on refresh an unsigned, invalid or other-key index is refused, the old index stays and `last_error` says why; the way back is to remove and add the repository again. Unverified and unsigned repositories may change key or stop signing, but a broken signature is refused for all.
- **Anti-rollback**: every refresh compares `serial`; a lower one is refused for every repository (equal is fine). `ma-ext repo build` raises it each time. An extension is only updated to a strictly newer version from the repository its copy came from.
- **The archive is exactly three files**: `manifest.json`, `index.js`, `icon.png`, built deterministically (fixed timestamps and order, so the same input gives the same hash). The reader does not use fflate's `unzipSync`, which accepted a zip that declares a small size and inflates to 50 MB: it reads the central directory itself, checks declared sizes before inflating, aborts inflation past them, refuses encrypted entries, duplicate or odd names, directories and zip-slip paths, and requires the local header name to equal the central one. `fflate` 0.8.3 is the pinned dependency.
- **`verifyPackage` compares the archive with its index entry**: size, SHA-256, and the manifest (id, version, `apiVersion`, `nsfw`, sources, languages as a set; versions are strict semver). `apiVersion` above the app's is refused as "needs a newer app", and a prerelease app does not satisfy `minAppVersion` of the same release.
- **A separate network path**: `RepoFetcher` uses its own session (`persist:repos`), not an extension's fetcher: http and https on every hop, a 20 s timeout, a running byte cap (index 2 MB, archive the smaller of the entry size and 20 MB, icon the smaller of its size and 512 KB) with an early refusal on `content-length`, and typed errors. It sits behind a `RepoHttp` interface, so tests use an in-memory fake. DoH and proxy for it come with phase 5 (R8).

## Not done
- No PNG signature or CRC check on the icon; integrity rests on the SHA-256 of the whole archive and the exact size checks.
- CPU spent inflating a highly compressed archive is bounded by the archive size (20 MB) only; the hash is checked first.
- The real `RepoFetcher` has no unit test (it needs Electron); it is covered by the e2e.

## Amendment (2026-10-10): trust is not carried by files or by silent updates
- **Updates**: `update` and "Update all" only act on a `trusted` repository. An unverified or unsigned one can change key or stop signing without notice, so its updates go through `prepareInstall` and the dialog (with the warning), like an install. "Update all" skips them.
- **Backups**: a restore clears `public_key` of every repository ([0030](0030-backup-restore.md)). The repository stays, as unverified; trusting it again is one click. Otherwise a backup file could make a repository trusted without the dialog.

## Consequences
- A repository is hosted on any static host and checked with `ma-ext repo verify`.
- Rotating a key means every user removes and adds the repository again, on purpose.
