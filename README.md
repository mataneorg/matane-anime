# Matane Anime

A desktop app for watching anime from sources you choose, with a library, watch progress, downloads and new-episode alerts. Built with Electron, React and TypeScript; styled with Catppuccin.

> **Status: beta-ready (phase 4 done).** You can browse sources, search all of them at once, keep anime in a library with categories, watch in the player with server fallback, resume where you left off, see your history, and move an anime to another source without losing progress. Episodes can be downloaded (HLS and MP4, a persistent queue, a size limit) and watched offline, the app checks the library for new episodes on a schedule and lists them under Updates, and a beta AppImage can be built. Extensions come from **repositories** you add yourself: a repository has a signed index (Ed25519), you decide whether to trust its key, extensions install atomically with their hash checked, update from the same repository and uninstall without touching your library; content-language and 18+ filters are enforced in the app, and developer mode loads an extension straight from a folder. Authors build and publish a repository with `ma-ext repo`. The app ships no repository, extension or key. The SDK, runtime and CLI are ready to publish on npm but **are not published yet**. See [docs/PRD.md](docs/PRD.md) (Indonesian) for the plan.

Matane Anime does not host, distribute or index any video. It ships with no sources; extensions are written and added by the user, who is responsible for what they use them for.

## Getting started

Requirements: Node 24 (see `.node-version`) and pnpm 12.

```sh
pnpm install     # also rebuilds better-sqlite3 for Electron
pnpm dev         # starts the app with hot reload
```

| Command                           | What it does                                                                                                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint` / `pnpm format:check` | ESLint and Prettier (`pnpm format` fixes)                                                                                                                                         |
| `pnpm typecheck`                  | TypeScript across all packages                                                                                                                                                    |
| `pnpm test`                       | Unit tests (Vitest, plain Node)                                                                                                                                                   |
| `pnpm build`                      | Production build into `apps/desktop/out`                                                                                                                                          |
| `pnpm e2e`                        | Builds, then runs the Playwright specs against the real app. On headless Linux use `xvfb-run -a pnpm e2e`                                                                         |
| `pnpm dist`                       | Builds the packaged app (an AppImage on Linux) into `apps/desktop/release`; `pnpm smoke:packaged` checks it                                                                       |
| `pnpm verify:packages`            | Packs the SDK, runtime and CLI, installs the tarballs in an empty project and builds and tests an extension there; publishes nothing (needs network for third-party dependencies) |

## Layout

```
apps/desktop            Electron app (main, extension host, preload, renderer)
packages/shared         Domain types, IPC contract, theme constants
packages/extension-sdk  The contract extensions implement (MIT)
packages/extension-runtime  The QuickJS sandbox (MIT)
packages/extension-cli  ma-ext: create, build, test, bench, repo keygen|build|verify (MIT)
packages/extension-repo The extension repository format: keys, signatures, index, archives (MIT; bundled into the CLI and the app, not published on its own)
packages/test-site      A fake anime site on loopback, for tests and for writing extensions
extensions/example      An extension for the fake site; not shipped
docs/                   PRD, extension guide, repositories, releasing, architecture decisions (adr/), UI mockups (ui/)
```

## Extensions

Matane Anime ships no sources, repositories or keys and does not suggest any. There are two ways to get an extension in:

- **From a repository.** Under **Extensions → Add repository** you paste the address of a repository someone published (a static folder with a signed `index.json`). You see its key's fingerprint and choose whether to trust it, then install, update and uninstall extensions from the same page. The 18+ filter (_Show 18+ sources_) and the content-language filter are in Settings. Running a repository is described in [docs/repositories.md](docs/repositories.md).
- **From a folder, in developer mode.** Turn on **Settings → Advanced → Developer mode**, then **Extensions → Load from folder** and pick a folder built with `ma-ext build`. The app reloads it when you rebuild. A dev folder wins over an installed extension with the same id.

You write an extension for a site as described in [docs/extensions.md](docs/extensions.md). To try the app without a real site: `pnpm --filter @matane-anime/test-site serve`, build `extensions/example`, load it as a dev folder and set its _Site address_ preference to the address the server prints. Add `--repo` to the `serve` command to also serve a repository of the example, and add that address under Add repository. Publishing the npm packages and cutting a beta are manual steps for the maintainer: [docs/releasing.md](docs/releasing.md).

## Playback spike

`/dev/spike` (development only, or `MATANE_SPIKE=1`) plays test streams through the `anime://` proxy and records first-frame time, seek time and codec support. The `Playback spike` GitHub workflow runs it on Linux, Windows and macOS. Results and decisions: [ADR 0008](docs/adr/0008-media-transport.md) and [ADR 0009](docs/adr/0009-codec-support.md). Test media is generated by `pnpm --filter @matane-anime/desktop fixtures` (needs ffmpeg) and is committed.

## License

The app is GPL-3.0-only. `packages/extension-sdk` is MIT. See [LICENSE](LICENSE).
