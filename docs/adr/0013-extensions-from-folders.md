# 13. Phase 1 loads extensions from folders only, and ships none

Status: Accepted (2026-10-07)

## Context
Repositories, signatures and updates are phase 4 (docs/PRD.md EXT-5…9). Phase 1 still needs a way to run an extension and an edit-and-try loop for its author. The app ships **no extension, repository or key** (EXT-7).

## Decision
- The only origin is a **folder the user picks** (Extensions → Load from folder, or Settings → Advanced). It may hold a built extension (`dist/`, or `manifest.json` + `index.js`) as `ma-ext build` writes it. The folder paths are kept in the settings and loaded again at start.
- A folder that fails to load (nothing built, a manifest that is not valid, a bundle the sandbox cannot load, an id already loaded from elsewhere) **stays in the list with the reason**.
- Bundles are checked about once a second (modification times) and reloaded when `ma-ext build` rewrites them; a loaded extension is first run in the sandbox, so a broken bundle is reported at load time, not on the first browse.
- A manifest with `type` other than `anime` is refused, so a Matane (manga) extension is not installed by mistake.
- Each source is recorded in `sources` as `<extensionId>/<key>`, **without a foreign key to the extension**, so library entries keep their reference when an extension is removed; the UI shows such a source as "extension not installed".
- Test extensions live in the repository (`extensions/example`, `apps/desktop/e2e/fixtures/extensions/probe`), are never bundled, and talk to a fake site (`packages/test-site`). The first real extension is written outside this repository.

## Consequences
- Phase 4 adds a second origin (a repository, with signature checks) next to the folder one; the registry already separates the two.
- Extensions are not published yet: `@matane-anime/extension-sdk` and the CLI are workspace packages, so outside authors link them until phase 4.

## Update (phase 4)
The folder origin is now one of two: installed extensions have their own origin, and a dev folder wins over an installed copy with the same id. See [0024](0024-extension-repositories.md) to [0027](0027-publishable-packages.md).
