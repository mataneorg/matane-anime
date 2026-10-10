# 30. Backup is a zip of the user's data; a restore is staged and applied at the next start

Status: Accepted (2026-10-09). The round trips are tested on temporary directories; the dialogs and the relaunch are only checked by hand at home.

## Context
docs/PRD.md §4: backup and restore are P1 for v1.0. The owner chose to back up **user data only**.

## Decision
- **Contents**: one `.zip` with `manifest.json` (format 1, app version, `schemaVersion` = migrations applied, date, counts), `data.db` and `covers/`. The database copy comes from `VACUUM INTO` and is stripped: `downloads`, `image_cache`, tracker tables, `extension_storage`, browse-only anime, custom covers, `window.state`, `extensions.devFolders` and any setting whose key says password, secret or token ([0028](0028-network-settings.md)). Kept: library, categories, episodes and progress, history, watch sessions, settings, repositories, the list of installed extensions (as references) and their preferences.
- **Own zip code** (`backup/zip.ts`, on `node:zlib`): `fflate` is only a dependency of `extension-repo` and is not importable from the app, and a new dependency would have changed the lockfile. The reader is strict: size caps, no zip64, encryption or duplicate entries, CRC checked, only `manifest.json`, `data.db` and `covers/*` allowed, no path traversal.
- **A live SQLite file is never swapped.** `backup.peek` reads the manifest and stages the file; `backup.import` validates it, stages it under `userData/restore-pending/` and relaunches. `applyPendingRestore` runs at the next start **before** the database opens: safety copy `backups/db/pre-restore-<iso>.db`, swap `data.db` (and drop `-wal`/`-shm`), replace `covers/`, then the normal `runMigrations` brings an older backup forward. A backup with a newer `schemaVersion` than the app is refused. On any failure the staged files move to `restore-failed/` and the current data stays.
- **After a restore**: repository-origin extensions keep their row with `install_dir` and `sha256` cleared, which the registry already shows as "reinstall"; a `downloadFolder` that does not exist is dropped so the default applies; downloads are gone and the episodes show as not downloaded.

## Not done
- The mockup's "last backup" line and "back up automatically" are not built.
- The archive is built in memory (cap 1 GiB, 10 MB per cover).
- `runMigrations` keeps only the three newest `.db` files in `backups/db`, so a fourth restore can prune the oldest safety copy.

## Amendment (2026-10-10)
- **Repository trust is not part of a backup.** `extension_repos.public_key` ("Trust this key") is cleared when a backup is made and again when one is restored, so a file cannot make a repository trusted ([0024](0024-extension-repositories.md)). The repositories themselves are kept, as unverified.
- **The staged database is migrated before the swap** (`applyPendingRestore` takes the migrations folder). A migration that fails moves the backup to `restore-failed/` and leaves the current data as it was; before, it ran after the swap and could stop the app from starting.
- **Retention is per kind**: the copies taken before a migration (`data-…`) and before a restore (`pre-restore-…`) each keep their last 3. One list sorted by name let three safety copies delete the migration copy just made.
