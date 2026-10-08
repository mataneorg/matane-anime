# 26. An origin-aware registry, and visibility filters in the main process

Status: Accepted (2026-10-09)

## Context
[0013](0013-extensions-from-folders.md) loaded extensions only from folders and said phase 4 would add a second origin next to it. A developer's folder and an installed copy can have the same id, extensions can be 18+ or in a language the user did not choose, and `migrateUrl` has to run when an extension changes version (docs/PRD.md EXT-9, EXT-15, EXT-16).

## Decision
- **Records have an origin and a key**: a dev record is keyed by its folder, an installed one by its id; `ExtensionInfo` carries `origin`, `repoId`, `repoName`, `trust`, `updateAvailable` and `shadowed`. At start the registry loads the dev folders, then the rows with origin `repo` from their install folder (a row without one is an error record "files are missing"). Only dev records are polled for changes (hot reload, EXT-10).
- **One id, one origin, dev over repo (EXT-9).** A dev folder that loads with the id of an installed extension wins: the installed record is `shadowed` (its row untouched, its code not in the sandbox) and is reloaded, and integrity-checked again, when the folder is removed or fails to load. Two dev folders with one id are still refused. An id installed from another repository, or provided by a dev folder, blocks `prepareInstall`; an extension whose repository was removed can be taken over by installing it from another one.
- **18+ and languages are enforced in main** (EXT-15). `sources.list` and `extensions.available` hide sources of 18+ extensions unless `showNsfw` is on and sources whose language is not in `contentLanguages` (empty means all, `multi` always passes, `pt` matches `pt-BR`, case-insensitive); `sources.browse`, `sources.resolveUrl` and `sources.filters` return `forbidden` for an 18+ source while it is off. `extensions.list` (Installed) and updates are never filtered, so everything stays removable. The renderer's own filters are redundant and harmless. Library, history and downloads are not filtered.
- **`migrateUrl` (EXT-16)** runs right after an install or update through `UpdateService.migrateExtension`, serialised with the scheduled check's own migration, and the scheduled check refreshes the repositories first when online. The scope is anime in the library, in the history or with downloads, and their episodes. The first sighting of a version only records the baseline; a failure does not advance it, so the next run retries. A hot reload of a dev folder does not trigger it; the next check does.
- **Developer mode** (`devMode`, EXT-10) only gates the UI for loading folders and the extended log; `extensions.loadDevFolder` is unchanged.

## Consequences
- This extends [0013](0013-extensions-from-folders.md): the folder origin is now one of two.
- Screens that read `sources.list` for names (library source filter, global search, migration) no longer see hidden sources.
