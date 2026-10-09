# Contributing to Matane Anime

Thanks for wanting to help. This page is the short version; the reasoning behind the big choices is in [docs/adr](docs/adr), and the plan is in [docs/PRD.md](docs/PRD.md) (Indonesian). Please read the [code of conduct](CODE_OF_CONDUCT.md) first. Vulnerabilities go to [SECURITY.md](SECURITY.md), not to a public issue.

## Where things belong

- **A bug or an idea for the app**: an issue here, using the templates.
- **A request for a particular site or source**: not here. Matane Anime ships no sources and does not suggest any. A source is an extension, and requests belong to the repository of the extension that provides (or would provide) it. To write one yourself, see [docs/extensions.md](docs/extensions.md).
- **A pull request**: for anything bigger than a fix, open an issue first so the direction can be agreed before you write code.

## Setup

You need **Node 24** (the exact version is in [`.node-version`](.node-version); `devEngines` in `package.json` asks for `^24.21.0`) and **pnpm 12** (`packageManager` pins `pnpm@12.5.1`; with Corepack, `corepack enable` picks it up).

```sh
pnpm install     # also rebuilds better-sqlite3 for Electron and builds the SDK and the CLI
pnpm dev         # starts the app with hot reload
```

## Commands

| Command                             | What it does                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                          | Starts the app with hot reload                                                                            |
| `pnpm lint` / `pnpm format:check`   | ESLint and Prettier (`pnpm format` fixes formatting)                                                      |
| `pnpm typecheck`                    | TypeScript across all packages                                                                            |
| `pnpm test`                         | Unit tests (Vitest, plain Node)                                                                           |
| `pnpm build`                        | Production build into `apps/desktop/out`                                                                  |
| `pnpm e2e`                          | Builds, then runs the Playwright specs against the real app. On headless Linux use `xvfb-run -a pnpm e2e` |
| `pnpm dist` / `pnpm smoke:packaged` | Builds the packaged app (an AppImage on Linux) and checks it                                              |
| `pnpm verify:packages`              | Packs the SDK, runtime and CLI and tests the tarballs in an empty project; publishes nothing              |

Run `pnpm lint`, `pnpm format:check`, `pnpm typecheck` and `pnpm test` before you push. CI runs them, plus the build and the e2e specs.

### Tests versus e2e

- **Unit tests** (`pnpm test`) are Vitest in plain Node, next to the code they test. Put logic in plain modules that do not import `electron`, so it can be tested without launching the app. Most changes need only these.
- **e2e** (`pnpm e2e`) launches the built Electron app with Playwright against the fake site in `packages/test-site`. Use it for flows that cross processes (browse, play, download, install an extension). It is slow and needs a display (or `xvfb-run`), so run the specs that touch your change rather than everything, and let CI run the rest.

## Commits and pull requests

- **Conventional Commits**: `feat: ...`, `fix: ...`, `docs: ...`, `ci: ...`, `refactor: ...`, `test: ...`, `chore: ...`, with an optional scope (`fix(player): ...`). Plain English, imperative, no trailing period needed.
- **No attribution lines** in commit messages or pull request descriptions: no `Co-Authored-By`, no "Generated with" footers, no tool or assistant credits.
- Keep a pull request to one change. Say what it does and how you checked it. A UI change needs a screenshot (Mocha and Latte if colors are involved).

## Code conventions

- **i18n**: every user-visible string goes through i18next and lives in **both** `apps/desktop/src/renderer/src/i18n/locales/en.json` **and** `id.json`. A lint rule rejects string literals in JSX. Dates, numbers and relative times use `Intl`.
- **UI source of truth**: the mockups in [docs/ui](docs/ui) ([ADR 0006](docs/adr/0006-ui-mockups-source-of-truth.md)). Match them; if you need to differ, say why in the pull request.
- **Typed IPC**: renderer and main talk through the contract in `packages/shared` ([ADR 0003](docs/adr/0003-typed-ipc-contract.md)). The renderer has no internet access and no Node.
- **Decisions**: a change that settles an architectural question gets an ADR in `docs/adr/` (next number, same format as the others).
- **Extensions never ship with the app**: nothing in this repository adds, names or points to a real source, repository or key.

## Licensing

The app (`apps/desktop`, `packages/shared`, `packages/test-site`) is **GPL-3.0-only**. The packages extension authors depend on (`extension-sdk`, `extension-runtime`, `extension-cli`, `extension-repo`) are **MIT**, so extensions are not bound by the GPL ([ADR 0002](docs/adr/0002-licensing.md)). By contributing you agree that your change is licensed under the license of the folder it goes into. Code moved between a GPL and an MIT package changes license with it, so that is a deliberate decision, not a side effect.

## Docs site

The documentation site is a [VitePress](https://vitepress.dev) project in `apps/docs`, the workspace package `@matane-anime/docs`. Its scripts are named `docs:*` on purpose so that `pnpm build`, `pnpm typecheck` and `pnpm test` (and CI) never run it.

```sh
pnpm --filter @matane-anime/docs docs:dev       # dev server with hot reload
pnpm --filter @matane-anime/docs docs:build     # static build into apps/docs/.vitepress/dist
pnpm --filter @matane-anime/docs docs:preview   # serve the build
```

The pages are English Markdown in `apps/docs`. The author guides there are adapted from `docs/extensions.md` and `docs/repositories.md`, which stay as the originals in the repository; when you change one, change the other.
